"""Client-side desktop app.

Runs on the client's machine so they can see their protection status and
restore their own files when Kovyr isn't there. Key custody is the
client's: the vault passphrase is typed at unlock time, held only in
memory, and never written anywhere by this app.

Reads config.json next to the executable (written during the engagement):
    {
      "client": "Acme Dental",
      "paths": ["C:\\ClientData"],
      "state": "C:\\Kovyr\\state.json",
      "html": "C:\\Kovyr\\latest-report.html",
      "vault": "C:\\KovyrVault"
    }
"""

from __future__ import annotations

import argparse
import json
import sys
import threading
import webbrowser
from pathlib import Path

from . import __version__, crypto, monitor as monitor_mod, report as report_mod, scanner
from .util import human_size, mirror_path, now_stamp
from .vault import Vault, VaultError

NAVY = "#1e3a5f"
NAVY_LIGHT = "#4a7ab2"
SURFACE = "#f5f7fa"
TEXT = "#1c2733"
MUTED = "#5a6b7b"
GOOD = "#1a7f4e"
BAD = "#b3261e"


def default_config_path() -> Path:
    if getattr(sys, "frozen", False):  # PyInstaller bundle
        return Path(sys.executable).parent / "config.json"
    return Path.cwd() / "config.json"


def load_config(path: Path) -> dict:
    config = json.loads(path.read_text())
    if not isinstance(config.get("paths"), list) or not config["paths"]:
        raise ValueError("config 'paths' must be a non-empty list")
    if not config.get("state"):
        raise ValueError("config must set 'state'")
    return config


def status_summary(history: list[dict]) -> dict:
    """Pure status derivation from monitor history, for display."""
    if not history:
        return {"configured": False}
    current = history[-1]
    drift = monitor_mod.diff(history[-2] if len(history) > 1 else None,
                             current)
    return {
        "configured": True,
        "last_run": current.get("timestamp", "unknown"),
        "files": current["files_scanned"],
        "bytes": current["bytes_scanned"],
        "duplicates": current["duplicate_files"],
        "exposure": current["wasted_bytes"],
        "new_groups": len(drift.new_groups),
        "clean": current["duplicate_files"] == 0 and not drift.has_new,
    }


class App:
    def __init__(self, root, config: dict | None, config_error: str | None):
        self.root = root
        self.config = config
        self.config_error = config_error
        self.vault: Vault | None = None
        self._build()
        self.refresh_status()

    # ---------- layout ----------

    def _build(self) -> None:
        import tkinter as tk
        from tkinter import ttk

        self.tk = tk
        self.ttk = ttk
        root = self.root
        root.title("Kovyr Vault")
        root.geometry("760x560")
        root.configure(bg="white")

        header = tk.Frame(root, bg=NAVY, padx=20, pady=14)
        header.pack(fill="x")
        tk.Label(header, text="KOVYR  ·  DATA PROTECTION", fg="#9fc0e8",
                 bg=NAVY, font=("Segoe UI", 9, "bold")).pack(anchor="w")
        tk.Label(header, text="Your data, protected", fg="white", bg=NAVY,
                 font=("Segoe UI", 16, "bold")).pack(anchor="w")

        style = ttk.Style(root)
        try:
            style.theme_use("clam")
        except self.tk.TclError:
            pass
        style.configure("TNotebook", background="white", borderwidth=0)
        style.configure("TNotebook.Tab", padding=(16, 8),
                        font=("Segoe UI", 10))

        notebook = ttk.Notebook(root)
        notebook.pack(fill="both", expand=True, padx=12, pady=12)
        self.status_tab = tk.Frame(notebook, bg="white", padx=16, pady=16)
        self.vault_tab = tk.Frame(notebook, bg="white", padx=16, pady=16)
        notebook.add(self.status_tab, text="  Protection status  ")
        notebook.add(self.vault_tab, text="  My encrypted files  ")

        self._build_status_tab()
        self._build_vault_tab()

        footer = tk.Label(root, text=f"Kovyr Vault v{__version__} — your "
                          "passphrase is never stored by this app",
                          fg=MUTED, bg="white", font=("Segoe UI", 8))
        footer.pack(pady=(0, 8))

    def _build_status_tab(self) -> None:
        tk = self.tk
        tab = self.status_tab

        self.headline = tk.Label(tab, text="", bg="white",
                                 font=("Segoe UI", 14, "bold"))
        self.headline.pack(anchor="w")
        self.subline = tk.Label(tab, text="", fg=MUTED, bg="white",
                                font=("Segoe UI", 10), justify="left")
        self.subline.pack(anchor="w", pady=(2, 14))

        tiles = tk.Frame(tab, bg="white")
        tiles.pack(fill="x")
        self.tile_vars = {}
        for key, label in (("files", "Files watched"),
                           ("dupes", "Redundant copies"),
                           ("exposure", "Excess exposure")):
            frame = tk.Frame(tiles, bg=SURFACE, padx=14, pady=10,
                             highlightbackground="#e2e8f0",
                             highlightthickness=1)
            frame.pack(side="left", padx=(0, 10), fill="x", expand=True)
            tk.Label(frame, text=label.upper(), fg=MUTED, bg=SURFACE,
                     font=("Segoe UI", 8, "bold")).pack(anchor="w")
            var = tk.StringVar(value="—")
            tk.Label(frame, textvariable=var, fg=TEXT, bg=SURFACE,
                     font=("Segoe UI", 16, "bold")).pack(anchor="w")
            self.tile_vars[key] = var

        buttons = tk.Frame(tab, bg="white")
        buttons.pack(anchor="w", pady=(18, 0))
        self.check_btn = tk.Button(buttons, text="Run check now",
                                   command=self.run_check, bg=NAVY,
                                   fg="white", padx=14, pady=6,
                                   font=("Segoe UI", 10, "bold"),
                                   relief="flat", cursor="hand2")
        self.check_btn.pack(side="left", padx=(0, 10))
        tk.Button(buttons, text="Open full report",
                  command=self.open_report, padx=14, pady=6,
                  font=("Segoe UI", 10), relief="groove",
                  cursor="hand2").pack(side="left")

        self.activity = tk.Label(tab, text="", fg=MUTED, bg="white",
                                 font=("Segoe UI", 9), justify="left")
        self.activity.pack(anchor="w", pady=(14, 0))

    def _build_vault_tab(self) -> None:
        tk = self.tk
        ttk = self.ttk
        tab = self.vault_tab

        self.unlock_frame = tk.Frame(tab, bg="white")
        self.unlock_frame.pack(anchor="w", fill="x")
        tk.Label(self.unlock_frame, text="Enter your passphrase to view "
                 "and restore your encrypted files.", bg="white",
                 font=("Segoe UI", 10)).pack(anchor="w")
        tk.Label(self.unlock_frame, text="Only you know this passphrase. "
                 "It is never stored, and Kovyr cannot recover it for you.",
                 fg=MUTED, bg="white",
                 font=("Segoe UI", 9)).pack(anchor="w", pady=(2, 8))
        row = tk.Frame(self.unlock_frame, bg="white")
        row.pack(anchor="w")
        self.pass_entry = tk.Entry(row, show="•", width=32,
                                   font=("Segoe UI", 11))
        self.pass_entry.pack(side="left", padx=(0, 10))
        self.pass_entry.bind("<Return>", lambda _e: self.unlock())
        self.unlock_btn = tk.Button(row, text="Unlock", command=self.unlock,
                                    bg=NAVY, fg="white", padx=14, pady=4,
                                    font=("Segoe UI", 10, "bold"),
                                    relief="flat", cursor="hand2")
        self.unlock_btn.pack(side="left")
        self.unlock_msg = tk.Label(self.unlock_frame, text="", fg=BAD,
                                   bg="white", font=("Segoe UI", 9))
        self.unlock_msg.pack(anchor="w", pady=(6, 0))

        self.files_frame = tk.Frame(tab, bg="white")
        columns = ("size",)
        self.tree = ttk.Treeview(self.files_frame, columns=columns,
                                 selectmode="extended")
        self.tree.heading("#0", text="File")
        self.tree.heading("size", text="Size")
        self.tree.column("#0", width=470)
        self.tree.column("size", width=90, anchor="e")
        scroll = ttk.Scrollbar(self.files_frame, orient="vertical",
                               command=self.tree.yview)
        self.tree.configure(yscrollcommand=scroll.set)
        self.tree.pack(side="left", fill="both", expand=True)
        scroll.pack(side="left", fill="y")

        self.vault_buttons = tk.Frame(tab, bg="white")
        tk.Button(self.vault_buttons, text="Restore selected…",
                  command=self.restore_selected, bg=NAVY, fg="white",
                  padx=14, pady=5, font=("Segoe UI", 10, "bold"),
                  relief="flat", cursor="hand2").pack(side="left",
                                                      padx=(0, 10))
        tk.Button(self.vault_buttons, text="Lock", command=self.lock,
                  padx=14, pady=5, font=("Segoe UI", 10),
                  relief="groove", cursor="hand2").pack(side="left")

    # ---------- status tab behavior ----------

    def refresh_status(self) -> None:
        if self.config is None:
            self.headline.config(text="Not configured yet", fg=MUTED)
            self.subline.config(
                text=(self.config_error or "config.json not found") +
                "\nAsk Kovyr to complete setup on this machine.")
            return
        try:
            history = monitor_mod.load_history(Path(self.config["state"]))
        except (OSError, ValueError, KeyError) as exc:
            history = []
            self.activity.config(text=f"Could not read history: {exc}")
        summary = status_summary(history)
        if not summary["configured"]:
            self.headline.config(text="No checks recorded yet", fg=MUTED)
            self.subline.config(text="Click “Run check now” to record "
                                "the first snapshot.")
            return
        if summary["clean"]:
            self.headline.config(text="✓ Protected", fg=GOOD)
        elif summary["new_groups"]:
            self.headline.config(
                text=f"⚠ {summary['new_groups']} new duplicate "
                "group(s) found", fg=BAD)
        else:
            self.headline.config(
                text=f"⚠ {summary['duplicates']} redundant copies "
                "present", fg=BAD)
        self.subline.config(text=f"Last check: {summary['last_run']}")
        self.tile_vars["files"].set(f"{summary['files']:,}")
        self.tile_vars["dupes"].set(f"{summary['duplicates']:,}")
        self.tile_vars["exposure"].set(human_size(summary["exposure"]))

    def run_check(self) -> None:
        if self.config is None:
            return
        self.check_btn.config(state="disabled")
        self.activity.config(text="Checking…")
        threading.Thread(target=self._run_check_worker, daemon=True).start()

    def _run_check_worker(self) -> None:
        try:
            result = scanner.scan(
                [Path(p) for p in self.config["paths"]])
            _snap, drift, history = monitor_mod.record_run(
                Path(self.config["state"]), result, now_stamp())
            if self.config.get("html"):
                ctx = {
                    "client": self.config.get("client"),
                    "generated": now_stamp(),
                    "version": __version__,
                    "history": history,
                    "new_groups": drift.new_groups,
                    "resolved_groups": drift.resolved_groups,
                }
                Path(self.config["html"]).write_text(
                    report_mod.render_monitor_report(ctx), encoding="utf-8")
            message = "Check complete."
        except Exception as exc:  # surfaced in the UI, not a crash
            message = f"Check failed: {exc}"
        self.root.after(0, self._run_check_done, message)

    def _run_check_done(self, message: str) -> None:
        self.check_btn.config(state="normal")
        self.activity.config(text=message)
        self.refresh_status()

    def open_report(self) -> None:
        html = (self.config or {}).get("html")
        if html and Path(html).exists():
            webbrowser.open(Path(html).resolve().as_uri())
        else:
            self.activity.config(
                text="No report yet — run a check first.")

    # ---------- vault tab behavior ----------

    def unlock(self) -> None:
        vault_path = (self.config or {}).get("vault")
        if not vault_path:
            self.unlock_msg.config(
                text="No vault is configured on this machine.")
            return
        passphrase = self.pass_entry.get()
        if not passphrase:
            self.unlock_msg.config(text="Enter your passphrase.")
            return
        self.unlock_btn.config(state="disabled")
        self.unlock_msg.config(text="Unlocking…", fg=MUTED)
        threading.Thread(target=self._unlock_worker,
                         args=(vault_path, passphrase), daemon=True).start()

    def _unlock_worker(self, vault_path: str, passphrase: str) -> None:
        try:
            vault = Vault.open(Path(vault_path), passphrase)
            error = None
        except crypto.WrongPassphrase:
            vault, error = None, "That passphrase is not correct."
        except (VaultError, OSError) as exc:
            vault, error = None, str(exc)
        self.root.after(0, self._unlock_done, vault, error)

    def _unlock_done(self, vault, error) -> None:
        self.unlock_btn.config(state="normal")
        if error:
            self.unlock_msg.config(text=error, fg=BAD)
            return
        self.vault = vault
        self.pass_entry.delete(0, "end")
        self.unlock_msg.config(text="")
        self.unlock_frame.pack_forget()
        self.files_frame.pack(fill="both", expand=True)
        self.vault_buttons.pack(anchor="w", pady=(10, 0))
        self.tree.delete(*self.tree.get_children())
        for name, entry in sorted(vault.list_files().items()):
            self.tree.insert("", "end", iid=name, text=name,
                             values=(human_size(entry.size),))

    def lock(self) -> None:
        self.vault = None
        self.files_frame.pack_forget()
        self.vault_buttons.pack_forget()
        self.unlock_frame.pack(anchor="w", fill="x")

    def restore_selected(self) -> None:
        from tkinter import filedialog, messagebox

        if self.vault is None:
            return
        names = self.tree.selection()
        if not names:
            messagebox.showinfo("Kovyr Vault",
                                "Select one or more files first.")
            return
        dest = filedialog.askdirectory(title="Restore into folder")
        if not dest:
            return
        restored, failed = 0, []
        for name in names:
            try:
                self.vault.restore_file(name, mirror_path(Path(dest), name))
                restored += 1
            except Exception as exc:
                failed.append(f"{name}: {exc}")
        message = f"Restored {restored} file(s) to {dest}."
        if failed:
            message += "\n\nProblems:\n" + "\n".join(failed)
        messagebox.showinfo("Kovyr Vault", message)


def run_app(config_path: Path | None = None, selftest: bool = False) -> int:
    import tkinter as tk

    path = config_path or default_config_path()
    config, error = None, None
    try:
        config = load_config(path)
    except FileNotFoundError:
        error = f"No configuration found at {path}."
    except (ValueError, json.JSONDecodeError, OSError) as exc:
        error = f"Configuration problem in {path}: {exc}"

    root = tk.Tk()
    app = App(root, config, error)
    if selftest:
        root.update_idletasks()
        root.update()
        root.destroy()
        print("gui selftest ok")
        return 0
    del app
    root.mainloop()
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="kovyr-vault-app")
    parser.add_argument("--config", help="path to config.json")
    parser.add_argument("--selftest", action="store_true",
                        help=argparse.SUPPRESS)
    args = parser.parse_args(argv)
    return run_app(Path(args.config) if args.config else None,
                   selftest=args.selftest)


if __name__ == "__main__":
    sys.exit(main())
