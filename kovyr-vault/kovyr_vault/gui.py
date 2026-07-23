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
import os
import subprocess
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


def app_support_config_path() -> Path:
    """The per-user config location that works regardless of where the
    app itself was installed (DMG drag-install, setup wizard, etc.)."""
    if sys.platform == "darwin":
        return (Path.home() / "Library" / "Application Support" / "Kovyr"
                / "config.json")
    if os.name == "nt":
        base = os.environ.get("APPDATA")
        if base:
            return Path(base) / "Kovyr" / "config.json"
    return Path.home() / ".config" / "kovyr" / "config.json"


def _beside_executable_config() -> Path:
    exe_dir = Path(sys.executable).parent
    # In a macOS .app the executable is buried in Contents/MacOS —
    # prefer a config sitting next to the .app bundle itself.
    for ancestor in exe_dir.parents:
        if ancestor.suffix == ".app":
            beside_app = ancestor.parent / "config.json"
            if beside_app.exists() or not (exe_dir / "config.json").exists():
                return beside_app
            break
    return exe_dir / "config.json"


def default_config_path() -> Path:
    """First existing config wins: beside the app, then the per-user
    app-data folder, then the working directory. With none present,
    keep the historical default (beside the app) so the error message
    points somewhere sensible."""
    candidates = []
    if getattr(sys, "frozen", False):  # PyInstaller bundle
        candidates.append(_beside_executable_config())
    candidates.append(app_support_config_path())
    if not getattr(sys, "frozen", False):
        candidates.append(Path.cwd() / "config.json")
    for candidate in candidates:
        if candidate.exists():
            return candidate
    return candidates[0]


def load_config(path: Path) -> dict:
    config = json.loads(path.read_text())
    if not isinstance(config.get("paths"), list) or not config["paths"]:
        raise ValueError("config 'paths' must be a non-empty list")
    if not config.get("state"):
        raise ValueError("config must set 'state'")
    return config


DEFAULT_BASE = Path.home() / "Kovyr"


def build_default_config(client: str, paths: list[str],
                         base: Path | None = None) -> dict:
    """A complete config from just a client name and folder list —
    state, report, and vault locations get sensible per-user defaults."""
    base = base or DEFAULT_BASE
    return {
        "client": client or "Client",
        "paths": list(paths),
        "state": str(base / "state.json"),
        "html": str(base / "latest-report.html"),
        "vault": str(base / "vault"),
    }


def save_config(path: Path, config: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(config, indent=2))


def plan_restore_targets(names: list[str], dest: Path) -> dict[str, Path]:
    """Decide where each restored file lands.

    A single file goes straight into the chosen folder under its own
    name. If that would collide with an existing file — or when several
    files are restored at once (which can carry same-named files from
    different folders) — the original path is mirrored underneath dest
    so nothing ever overwrites anything.
    """
    if len(names) == 1:
        flat = dest / Path(names[0]).name
        if not flat.exists():
            return {names[0]: flat}
    return {name: mirror_path(dest, name) for name in names}


def reveal_in_file_manager(path: Path) -> None:
    """Open the platform file manager with the restored file selected."""
    try:
        if sys.platform == "darwin":
            subprocess.Popen(["open", "-R", str(path)])
        elif os.name == "nt":
            subprocess.Popen(["explorer", f"/select,{path}"])
        else:
            target = path if path.is_dir() else path.parent
            webbrowser.open(target.as_uri())
    except OSError:
        pass  # a failed reveal should never break the restore itself


def status_summary(history: list[dict]) -> dict:
    """Pure status derivation from monitor history, for display."""
    if not history:
        return {"configured": False}
    current = history[-1]
    drift = monitor_mod.diff(history[-2] if len(history) > 1 else None,
                             current)
    alerts = list(current.get("canary_alerts") or [])
    if current.get("new_failed_unlocks"):
        alerts.append(f"{current['new_failed_unlocks']} failed vault "
                      f"unlock attempts since last check")
    return {
        "configured": True,
        "last_run": current.get("timestamp", "unknown"),
        "files": current["files_scanned"],
        "bytes": current["bytes_scanned"],
        "duplicates": current["duplicate_files"],
        "exposure": current["wasted_bytes"],
        "new_groups": len(drift.new_groups),
        "alerts": alerts,
        "clean": (current["duplicate_files"] == 0 and not drift.has_new
                  and not alerts),
    }


class App:
    def __init__(self, root, config: dict | None, config_error: str | None,
                 config_path: Path | None = None):
        self.root = root
        self.config = config
        self.config_error = config_error
        # Where Save writes: the file we loaded from, else the per-user
        # app-data location (works for DMG/installer installs).
        self.save_path = (config_path if (config_path and config)
                          else app_support_config_path())
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
        self.notebook = notebook
        self.status_tab = tk.Frame(notebook, bg="white", padx=16, pady=16)
        self.vault_tab = tk.Frame(notebook, bg="white", padx=16, pady=16)
        self.settings_tab = tk.Frame(notebook, bg="white", padx=16, pady=16)
        notebook.add(self.status_tab, text="  Protection status  ")
        notebook.add(self.vault_tab, text="  My encrypted files  ")
        notebook.add(self.settings_tab, text="  Settings  ")

        self._build_status_tab()
        self._build_vault_tab()
        self._build_settings_tab()
        if self.config is None:
            notebook.select(self.settings_tab)  # first run lands on setup

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

    def _build_settings_tab(self) -> None:
        tk = self.tk
        tab = self.settings_tab

        tk.Label(tab, text="Watched folders", bg="white",
                 font=("Segoe UI", 11, "bold")).pack(anchor="w")
        tk.Label(tab, text="Kovyr scans and protects these folders, "
                 "including everything inside them.", fg=MUTED, bg="white",
                 font=("Segoe UI", 9)).pack(anchor="w", pady=(0, 6))

        folders = tk.Frame(tab, bg="white")
        folders.pack(fill="x")
        self.folders_list = tk.Listbox(folders, height=6,
                                       font=("Segoe UI", 10),
                                       selectmode="extended")
        self.folders_list.pack(side="left", fill="x", expand=True)
        btns = tk.Frame(folders, bg="white")
        btns.pack(side="left", padx=(10, 0), anchor="n")
        tk.Button(btns, text="Add folder…", command=self.add_folder,
                  padx=10, pady=3, relief="groove",
                  cursor="hand2").pack(fill="x", pady=(0, 6))
        tk.Button(btns, text="Remove selected", command=self.remove_folder,
                  padx=10, pady=3, relief="groove",
                  cursor="hand2").pack(fill="x")

        row = tk.Frame(tab, bg="white")
        row.pack(anchor="w", pady=(14, 0))
        tk.Label(row, text="Name on reports:", bg="white",
                 font=("Segoe UI", 10)).pack(side="left")
        self.client_entry = tk.Entry(row, width=28, font=("Segoe UI", 10))
        self.client_entry.pack(side="left", padx=8)

        self.vault_status = tk.Label(tab, text="", bg="white", fg=MUTED,
                                     font=("Segoe UI", 9), justify="left")
        self.vault_status.pack(anchor="w", pady=(14, 0))
        self.create_vault_btn = tk.Button(
            tab, text="Create vault…", command=self.create_vault_dialog,
            padx=10, pady=3, relief="groove", cursor="hand2")

        tk.Button(tab, text="Save settings", command=self.save_settings,
                  bg=NAVY, fg="white", padx=14, pady=6,
                  font=("Segoe UI", 10, "bold"), relief="flat",
                  cursor="hand2").pack(anchor="w", pady=(18, 0))
        self.settings_msg = tk.Label(tab, text="", bg="white", fg=MUTED,
                                     font=("Segoe UI", 9))
        self.settings_msg.pack(anchor="w", pady=(6, 0))

        self._load_settings_fields()

    def _load_settings_fields(self) -> None:
        self.folders_list.delete(0, "end")
        for p in (self.config or {}).get("paths", []):
            self.folders_list.insert("end", p)
        self.client_entry.delete(0, "end")
        self.client_entry.insert(0, (self.config or {}).get("client", ""))
        self._refresh_vault_status()

    def _vault_path(self) -> Path:
        return Path((self.config or {}).get("vault")
                    or (DEFAULT_BASE / "vault"))

    def _refresh_vault_status(self) -> None:
        vault_path = self._vault_path()
        if (vault_path / "vault.json").exists():
            self.vault_status.config(
                text=f"✓ Encrypted vault ready at {vault_path}", fg=GOOD)
            self.create_vault_btn.pack_forget()
        else:
            self.vault_status.config(
                text=f"No vault yet (will be created at {vault_path}). "
                "The vault is where files are encrypted.", fg=MUTED)
            self.create_vault_btn.pack(anchor="w", pady=(6, 0))

    def add_folder(self) -> None:
        from tkinter import filedialog
        folder = filedialog.askdirectory(title="Choose a folder to watch")
        if folder and folder not in self.folders_list.get(0, "end"):
            self.folders_list.insert("end", folder)

    def remove_folder(self) -> None:
        for index in reversed(self.folders_list.curselection()):
            self.folders_list.delete(index)

    def save_settings(self) -> None:
        paths = list(self.folders_list.get(0, "end"))
        if not paths:
            self.settings_msg.config(
                text="Add at least one folder to watch.", fg=BAD)
            return
        client = self.client_entry.get().strip()
        if self.config:
            self.config["paths"] = paths
            self.config["client"] = client or self.config.get("client")
        else:
            self.config = build_default_config(client, paths)
        try:
            save_config(self.save_path, self.config)
        except OSError as exc:
            self.settings_msg.config(text=f"Could not save: {exc}", fg=BAD)
            return
        self.config_error = None
        self.settings_msg.config(
            text=f"Saved to {self.save_path}", fg=GOOD)
        self._refresh_vault_status()
        self.refresh_status()

    def create_vault_dialog(self) -> None:
        tk = self.tk
        from tkinter import messagebox

        vault_path = self._vault_path()
        if (vault_path / "vault.json").exists():
            self._refresh_vault_status()
            return

        dlg = tk.Toplevel(self.root)
        dlg.title("Create vault")
        dlg.configure(bg="white", padx=18, pady=16)
        dlg.transient(self.root)
        dlg.grab_set()
        tk.Label(dlg, text="Choose the vault passphrase", bg="white",
                 font=("Segoe UI", 12, "bold")).pack(anchor="w")
        tk.Label(dlg, text="Only you will know it. It is never stored, "
                 "and there is NO way to recover it —\na lost passphrase "
                 "means the encrypted files are gone forever.\nSave it in "
                 "a password manager now.", bg="white", fg=MUTED,
                 justify="left", font=("Segoe UI", 9)).pack(
                     anchor="w", pady=(4, 10))
        p1 = tk.Entry(dlg, show="•", width=30, font=("Segoe UI", 11))
        p2 = tk.Entry(dlg, show="•", width=30, font=("Segoe UI", 11))
        tk.Label(dlg, text="Passphrase:", bg="white",
                 font=("Segoe UI", 9)).pack(anchor="w")
        p1.pack(anchor="w", pady=(0, 6))
        tk.Label(dlg, text="Confirm:", bg="white",
                 font=("Segoe UI", 9)).pack(anchor="w")
        p2.pack(anchor="w", pady=(0, 10))
        msg = tk.Label(dlg, text="", bg="white", fg=BAD,
                       font=("Segoe UI", 9))
        msg.pack(anchor="w")

        def do_create() -> None:
            phrase, confirm = p1.get(), p2.get()
            if not phrase:
                msg.config(text="Passphrase must not be empty.")
                return
            if phrase != confirm:
                msg.config(text="Passphrases do not match.")
                return
            try:
                Vault.create(vault_path, phrase)
            except (VaultError, OSError) as exc:
                msg.config(text=str(exc))
                return
            dlg.destroy()
            self._refresh_vault_status()
            messagebox.showinfo(
                "Kovyr Vault",
                "Vault created. Write the passphrase into a password "
                "manager now — it cannot be recovered.")

        tk.Button(dlg, text="Create vault", command=do_create, bg=NAVY,
                  fg="white", padx=14, pady=5,
                  font=("Segoe UI", 10, "bold"), relief="flat",
                  cursor="hand2").pack(anchor="w", pady=(8, 0))
        p1.focus_set()

    # ---------- status tab behavior ----------

    def refresh_status(self) -> None:
        if self.config is None:
            self.headline.config(text="Not set up yet", fg=MUTED)
            self.subline.config(
                text="Open the Settings tab to choose the folders to "
                "protect and create your vault.")
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
        elif summary["alerts"]:
            self.headline.config(
                text="⚠ Attention needed — contact Kovyr", fg=BAD)
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
            vault_path = self.config.get("vault")
            _snap, drift, history = monitor_mod.record_run(
                Path(self.config["state"]), result, now_stamp(),
                vault=Path(vault_path) if vault_path else None)
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
        names = list(self.tree.selection())
        if not names:
            messagebox.showinfo("Kovyr Vault",
                                "Select one or more files first.")
            return
        dest = filedialog.askdirectory(title="Restore into folder")
        if not dest:
            return
        targets = plan_restore_targets(names, Path(dest))
        restored: list[Path] = []
        failed: list[str] = []
        for name, target in targets.items():
            try:
                self.vault.restore_file(name, target)
                restored.append(target)
            except Exception as exc:
                failed.append(f"{name}: {exc}")

        lines = [f"{t.name}  →  {t}" for t in restored[:8]]
        if len(restored) > 8:
            lines.append(f"…and {len(restored) - 8} more")
        if restored:
            message = "Restored a copy of:\n" + "\n".join(lines)
            message += ("\n\nThe encrypted originals remain safe in "
                        "the vault.")
        else:
            message = "Nothing was restored."
        if failed:
            message += "\n\nProblems:\n" + "\n".join(failed)

        if restored:
            if messagebox.askyesno(
                    "Kovyr Vault",
                    message + "\n\nShow the restored file in "
                    "Finder / File Explorer?"):
                reveal_in_file_manager(restored[0])
        else:
            messagebox.showinfo("Kovyr Vault", message)


def run_app(config_path: Path | None = None, selftest: bool = False) -> int:
    import tkinter as tk

    path = config_path or default_config_path()
    config, error = None, None
    try:
        config = load_config(path)
    except FileNotFoundError:
        error = (f"No configuration found at {path} "
                 f"(also looked in {app_support_config_path().parent}).")
    except (ValueError, json.JSONDecodeError, OSError) as exc:
        error = f"Configuration problem in {path}: {exc}"

    root = tk.Tk()
    app = App(root, config, error, config_path=path)
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
