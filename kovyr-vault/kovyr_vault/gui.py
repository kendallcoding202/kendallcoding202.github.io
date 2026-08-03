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
import shutil
import subprocess
import sys
import threading
import webbrowser
from pathlib import Path

from . import __version__, crypto, monitor as monitor_mod, notify as notify_mod, protect_folder as protect_mod, quarantine as quarantine_mod, report as report_mod, scanner
from .util import human_size, mirror_path, now_stamp
from .vault import generate_keyfile, Vault, VaultError

NAVY = "#1e3a5f"
NAVY_LIGHT = "#4a7ab2"
SURFACE = "#f5f7fa"
TEXT = "#1c2733"
MUTED = "#5a6b7b"
GOOD = "#1a7f4e"
BAD = "#b3261e"
BORDER = "#dbe2ea"
CANVAS = "#f0f3f7"  # window backdrop behind the white content area
# Soft status tints for banner fills — light enough that dark text stays
# legible on them, saturated enough to read as green/amber at a glance.
GOOD_BG = "#eaf5ef"
BAD_BG = "#fdeeec"
HAIRLINE = "#eef2f6"  # lighter than BORDER, for inside-panel separators


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
        "quarantine": str(base / "quarantine"),
        "protected": [],
    }


UPDATE_API = ("https://api.github.com/repos/kendallcoding202/"
              "kendallcoding202.github.io/releases/latest")

# Where "Open Kovyr dashboard" sends the client. Overridable per client
# with a "dashboard_url" key in config.json. Note this is handed to the
# system browser — the app itself opens no connection, so this does not
# change what Kovyr Vault transmits (which is nothing).
KOVYR_SITE = "https://kovyr.com"


def version_tuple(text: str) -> tuple[int, ...]:
    import re
    numbers = re.findall(r"\d+", text)
    return tuple(int(n) for n in numbers) if numbers else (0,)


def is_newer_version(remote: str, local: str) -> bool:
    return version_tuple(remote) > version_tuple(local)


def keeper_and_redundant(paths: list[str]) -> tuple[str, list[str]]:
    """Which copy survives a duplicate group (shortest path wins,
    alphabetical tie-break — matches the CLI's 'first' policy) and
    which copies are redundant."""
    keeper = min(paths, key=lambda p: (len(p), p))
    return keeper, [p for p in paths if p != keeper]


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
    awaiting = current.get("awaiting_encryption") or 0
    return {
        "configured": True,
        "last_run": current.get("timestamp", "unknown"),
        "files": current["files_scanned"],
        "bytes": current["bytes_scanned"],
        "duplicates": current["duplicate_files"],
        "exposure": current["wasted_bytes"],
        "new_groups": len(drift.new_groups),
        "alerts": alerts,
        "awaiting": awaiting,
        "clean": (current["duplicate_files"] == 0 and not drift.has_new
                  and not alerts and not awaiting),
    }


def resolve_dashboard_url(config: dict | None) -> str:
    """Which URL the dashboard button opens: a per-client `dashboard_url`
    from config, else the default site. Anything that is not an https URL
    is refused and falls back — a typo'd or tampered config must never
    hand the browser a file:// path or a plain-http endpoint."""
    url = str((config or {}).get("dashboard_url") or "").strip()
    return url if url.startswith("https://") else KOVYR_SITE


def status_detail(summary: dict) -> str:
    """Plain-English 'what's going on' text — the client should never see a
    bare 'Attention needed' with no reason. Mirrors the headline's priority
    order. Pure function so it's testable without a display."""
    if not summary.get("configured"):
        return ("No protection check has run yet. Click “Run check now” to "
                "scan your watched folders and record the first snapshot.")
    if summary["alerts"]:
        lines = ["The last check flagged unusual activity:"]
        lines += [f"  •  {a}" for a in summary["alerts"]]
        lines.append("")
        lines.append(
            "This usually means a fast-changing folder — source code, a Git "
            "repository, or a system/build folder — is being watched, where "
            "normal edits and commits look like a mass rewrite. If you added "
            "one, remove it from the watched folders in Settings and re-run "
            "the check. If you did NOT expect this, it can also signal "
            "ransomware or tampering — contact Kovyr before making changes.")
        return "\n".join(lines)
    if summary["awaiting"]:
        n = summary["awaiting"]
        return (f"{n:,} file(s) are waiting in a locked folder to be "
                "encrypted. Open the “My encrypted files” tab, enter your "
                "passphrase, and click “Encrypt waiting files”.")
    if summary["new_groups"]:
        return (f"{summary['new_groups']} new duplicate group(s) appeared "
                "since the last check. Open the Duplicates tab to review and "
                "quarantine the extra copies — nothing is deleted "
                "automatically, and one copy is always kept.")
    if summary["duplicates"]:
        n = summary["duplicates"]
        return (f"{n:,} redundant cop{'y' if n == 1 else 'ies'} found across "
                "your watched folders. Open the Duplicates tab to review and "
                "quarantine them. Nothing is deleted automatically; one copy "
                "of each file is always kept.")
    return ("Everything looks normal — no duplicates, no unusual activity, "
            "and your files are protected. Nothing needs your attention "
            "right now.")


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
        self._pending_receipt: str | None = None
        self._build()
        self.refresh_status()
        # macOS delivers double-clicked documents via an Apple Event.
        try:
            self.root.createcommand("::tk::mac::OpenDocument",
                                    self._open_documents)
        except Exception:
            pass  # non-mac platforms pass the path via argv instead
        # A Dock-icon click sends Reopen; without this handler Tk won't
        # restore a minimized/hidden window on macOS.
        try:
            self.root.createcommand("::tk::mac::ReopenApplication",
                                    self._reopen)
        except Exception:
            pass

    def _reopen(self) -> None:
        try:
            self.root.deiconify()
            self.root.lift()
            self.root.focus_force()
        except Exception:
            pass

    def _primary_button(self, parent, text, command):
        """A navy 'primary' button drawn as a colored label — tk.Button
        ignores background color on macOS (drawing the native light face),
        which made white button text unreadable. A Label fills the navy on
        every platform. Exposes .set_enabled() for the two that toggle."""
        tk = self.tk
        NAVY_HOVER = "#16283f"
        DISABLED_BG = "#9aa7b4"
        lbl = tk.Label(parent, text=text, bg=NAVY, fg="white", padx=14,
                       pady=6, font=("Segoe UI", 10, "bold"),
                       cursor="hand2")
        st = {"on": True}

        def click(_e=None):
            if st["on"]:
                command()

        lbl.bind("<Button-1>", click)
        lbl.bind("<Enter>", lambda e: st["on"] and lbl.config(bg=NAVY_HOVER))
        lbl.bind("<Leave>", lambda e: lbl.config(
            bg=NAVY if st["on"] else DISABLED_BG))

        def set_enabled(on: bool) -> None:
            st["on"] = on
            lbl.config(bg=NAVY if on else DISABLED_BG,
                       fg="white" if on else "#e6ebf1",
                       cursor="hand2" if on else "arrow")

        lbl.set_enabled = set_enabled
        return lbl

    def _secondary_button(self, parent, text, command):
        """A light 'secondary' button — bordered, navy text. The border is a
        1px colored Frame wrapping a white Label: macOS Aqua does not draw
        highlightthickness on a (non-focusable) Label, so the box would be
        invisible there. A filled Frame renders on every platform. Returns
        the border Frame, which supports pack()/pack_forget() like a widget."""
        tk = self.tk
        HOVER = "#eef2f7"
        border = tk.Frame(parent, bg=BORDER, cursor="hand2")
        lbl = tk.Label(border, text=text, bg="white", fg=NAVY, padx=13,
                       pady=6, font=("Segoe UI", 10), cursor="hand2")
        lbl.pack(fill="both", expand=True, padx=1, pady=1)
        for widget in (border, lbl):
            widget.bind("<Button-1>", lambda _e: command())
        border.bind("<Enter>", lambda e: lbl.config(bg=HOVER))
        border.bind("<Leave>", lambda e: lbl.config(bg="white"))
        return border

    def _open_documents(self, *paths) -> None:
        for path in paths:
            self.handle_receipt(str(path))
            break

    def handle_receipt(self, receipt: str) -> None:
        """A .kovyr receipt was opened: jump to the vault and target
        the file it stands for."""
        original = str(protect_mod.original_from_receipt(Path(receipt)))
        self._pending_receipt = original
        self.notebook.select(self.vault_tab)
        if self.vault is None:
            self.unlock_msg.config(
                text=f"Unlock to retrieve: {Path(original).name}",
                fg=MUTED)
        else:
            self._select_pending_receipt()

    def _select_pending_receipt(self) -> None:
        if not self._pending_receipt:
            return
        if self.tree.exists(self._pending_receipt):
            self.tree.selection_set([self._pending_receipt])
            self.tree.see(self._pending_receipt)
        self._pending_receipt = None

    # ---------- layout ----------

    def _build(self) -> None:
        import tkinter as tk
        from tkinter import ttk

        self.tk = tk
        self.ttk = ttk
        root = self.root
        root.title("Kovyr Vault")
        root.geometry("900x720")
        root.minsize(820, 620)
        root.configure(bg=CANVAS)

        header = tk.Frame(root, bg=NAVY, padx=24, pady=16)
        header.pack(fill="x")
        tk.Label(header, text="KOVYR", fg="white", bg=NAVY,
                 font=("Segoe UI", 15, "bold")).pack(side="left")
        tk.Label(header, text="Data Protection", fg="#9fc0e8", bg=NAVY,
                 font=("Segoe UI", 11)).pack(side="left", padx=(10, 0),
                                             pady=(4, 0))
        self.header_client = tk.Label(
            header, text="", fg="#c7d8ec", bg=NAVY,
            font=("Segoe UI", 10))
        self.header_client.pack(side="right", pady=(4, 0))

        style = ttk.Style(root)
        try:
            style.theme_use("clam")
        except self.tk.TclError:
            pass
        style.configure("TNotebook", background=CANVAS, borderwidth=0)
        style.configure("TNotebook.Tab", padding=(18, 9),
                        font=("Segoe UI", 10), background=CANVAS,
                        foreground=MUTED, borderwidth=0)
        style.map("TNotebook.Tab",
                  background=[("selected", "white")],
                  foreground=[("selected", NAVY)],
                  expand=[("selected", (0, 0, 0, 0))])
        # Explicit colors so macOS/Windows dark mode can't invert the
        # app's white surfaces out from under the text.
        style.configure("Treeview", background="white",
                        fieldbackground="white", foreground=TEXT,
                        rowheight=26, borderwidth=0)
        style.configure("Treeview.Heading", foreground=MUTED,
                        background=SURFACE, relief="flat", padding=(6, 5),
                        font=("Segoe UI", 9, "bold"))
        style.map("Treeview.Heading", background=[("active", SURFACE)])
        # A soft selection instead of the OS default (which can be an
        # unreadable saturated blue depending on platform/theme).
        style.map("Treeview",
                  background=[("selected", "#dbe7f3")],
                  foreground=[("selected", NAVY)])
        style.configure("Vertical.TScrollbar", background=SURFACE,
                        troughcolor="white", borderwidth=0, arrowsize=12)

        notebook = ttk.Notebook(root)
        notebook.pack(fill="both", expand=True, padx=16, pady=(12, 0))
        self.notebook = notebook
        self.status_tab = tk.Frame(notebook, bg="white", padx=26, pady=24)
        self.vault_tab = tk.Frame(notebook, bg="white", padx=26, pady=22)
        self.dupes_tab = tk.Frame(notebook, bg="white", padx=26, pady=22)
        self.settings_tab = tk.Frame(notebook, bg="white", padx=26, pady=22)
        notebook.add(self.status_tab, text="  Protection status  ")
        notebook.add(self.vault_tab, text="  My encrypted files  ")
        notebook.add(self.dupes_tab, text="  Duplicates  ")
        notebook.add(self.settings_tab, text="  Settings  ")

        self._build_status_tab()
        self._build_vault_tab()
        self._build_dupes_tab()
        self._build_settings_tab()
        if self.config is None:
            notebook.select(self.settings_tab)  # first run lands on setup

        footer = tk.Label(root, text=f"Kovyr Vault v{__version__}   ·   "
                          "your passphrase is never stored by this app",
                          fg=MUTED, bg=CANVAS, font=("Segoe UI", 8))
        footer.pack(pady=(6, 8))
        client = (self.config or {}).get("client")
        if client:
            self.header_client.config(text=client)

    def _build_status_tab(self) -> None:
        tk = self.tk
        tab = self.status_tab

        # Status banner: a tinted card with a colored spine, so the overall
        # state reads at a glance before any text is parsed.
        self.banner = tk.Frame(tab, bg=SURFACE)
        self.banner.pack(fill="x")
        self.banner_spine = tk.Frame(self.banner, bg=MUTED, width=4)
        self.banner_spine.pack(side="left", fill="y")
        banner_body = tk.Frame(self.banner, bg=SURFACE, padx=16, pady=13)
        banner_body.pack(side="left", fill="both", expand=True)
        self.banner_body = banner_body
        self.headline = tk.Label(banner_body, text="", bg=SURFACE, fg=TEXT,
                                 font=("Segoe UI", 15, "bold"),
                                 justify="left", wraplength=740)
        self.headline.pack(anchor="w")
        self.subline = tk.Label(banner_body, text="", fg=MUTED, bg=SURFACE,
                                font=("Segoe UI", 10), justify="left")
        self.subline.pack(anchor="w", pady=(2, 0))

        tiles = tk.Frame(tab, bg="white")
        tiles.pack(fill="x", pady=(16, 0))
        self.tile_vars = {}
        specs = (("files", "Files watched"), ("dupes", "Redundant copies"),
                 ("exposure", "Excess exposure"))
        for col, (key, label) in enumerate(specs):
            tiles.columnconfigure(col, weight=1, uniform="tile")
            frame = tk.Frame(tiles, bg="white", padx=16, pady=14,
                             highlightbackground=BORDER, highlightthickness=1)
            frame.grid(row=0, column=col, sticky="ew",
                       padx=(0 if col == 0 else 5,
                             0 if col == len(specs) - 1 else 5))
            tk.Label(frame, text=label.upper(), fg=MUTED, bg="white",
                     font=("Segoe UI", 8, "bold")).pack(anchor="w")
            var = tk.StringVar(value="—")
            tk.Label(frame, textvariable=var, fg=NAVY, bg="white",
                     font=("Segoe UI", 24, "bold")).pack(anchor="w",
                                                         pady=(6, 0))
            self.tile_vars[key] = var

        # Baseline device-security checklist: the technical, machine-level
        # controls Kovyr can verify read-only (disk encryption, firewall,
        # auto screen lock, and — on Windows — antivirus). Policy/human
        # controls stay on the manual assessment.
        posture = tk.Frame(tab, bg="white", padx=16, pady=13,
                           highlightbackground=BORDER, highlightthickness=1)
        posture.pack(fill="x", pady=(10, 0))
        tk.Label(posture, text="DEVICE SECURITY", fg=MUTED, bg="white",
                 font=("Segoe UI", 8, "bold")).pack(anchor="w")
        self.posture_box = tk.Frame(posture, bg="white")
        self.posture_box.pack(fill="x", pady=(7, 0))
        tk.Label(self.posture_box, text="Checking…", fg=MUTED, bg="white",
                 font=("Segoe UI", 10)).pack(anchor="w")
        self._start_posture_check()

        # A plain-English "what's going on" panel so a status like
        # "Attention needed" always explains itself instead of leaving the
        # client guessing. Tinted (not white) so it reads as explanatory
        # copy rather than another data panel.
        detail = tk.Frame(tab, bg=SURFACE, padx=16, pady=13,
                          highlightbackground=BORDER, highlightthickness=1)
        detail.pack(fill="x", pady=(10, 0))
        self.detail_title = tk.Label(detail, text="WHAT'S GOING ON",
                                     fg=NAVY, bg=SURFACE,
                                     font=("Segoe UI", 8, "bold"))
        self.detail_title.pack(anchor="w")
        self.detail_text = tk.Label(detail, text="", fg=TEXT, bg=SURFACE,
                                    font=("Segoe UI", 10), justify="left",
                                    wraplength=750)
        self.detail_text.pack(anchor="w", pady=(5, 0))

        buttons = tk.Frame(tab, bg="white")
        buttons.pack(anchor="w", pady=(18, 0))
        self.check_btn = self._primary_button(
            buttons, "Run check now", self.run_check)
        self.check_btn.pack(side="left", padx=(0, 10))
        self._secondary_button(buttons, "Open full report",
                               self.open_report).pack(side="left", padx=(0, 10))
        self._secondary_button(buttons, "Scan for sensitive files",
                               self.scan_sensitive).pack(side="left")

        self.activity = tk.Label(tab, text="", fg=MUTED, bg="white",
                                 font=("Segoe UI", 9), justify="left",
                                 wraplength=760)
        self.activity.pack(anchor="w", pady=(12, 0))

    def _build_vault_tab(self) -> None:
        tk = self.tk
        ttk = self.ttk
        tab = self.vault_tab

        self.unlock_frame = tk.Frame(tab, bg="white")
        self.unlock_frame.pack(anchor="w", fill="x")
        tk.Label(self.unlock_frame, text="Enter your passphrase to view "
                 "and restore your encrypted files.", bg="white",
                 fg=TEXT, font=("Segoe UI", 10)).pack(anchor="w")
        tk.Label(self.unlock_frame, text="Only you know this passphrase. "
                 "It is never stored, and Kovyr cannot recover it for you.",
                 fg=MUTED, bg="white",
                 font=("Segoe UI", 9)).pack(anchor="w", pady=(2, 8))
        row = tk.Frame(self.unlock_frame, bg="white")
        row.pack(anchor="w")
        self.pass_entry = tk.Entry(row, show="•", width=32,
                                   font=("Segoe UI", 11), bg="white",
                                   fg=TEXT, insertbackground=TEXT,
                                   relief="flat", borderwidth=0,
                                   highlightthickness=1,
                                   highlightbackground=BORDER,
                                   highlightcolor=NAVY_LIGHT)
        self.pass_entry.pack(side="left", padx=(0, 10))
        self.pass_entry.bind("<Return>", lambda _e: self.unlock())
        self.unlock_btn = self._primary_button(row, "Unlock", self.unlock)
        self.unlock_btn.pack(side="left")
        self.unlock_msg = tk.Label(self.unlock_frame, text="", fg=BAD,
                                   bg="white", font=("Segoe UI", 9))
        self.unlock_msg.pack(anchor="w", pady=(6, 0))

        self.files_frame = tk.Frame(tab, bg="white")
        vault_head = tk.Frame(self.files_frame, bg="white")
        vault_head.pack(fill="x", pady=(0, 8))
        tk.Label(vault_head, text="Your encrypted files", bg="white", fg=TEXT,
                 font=("Segoe UI", 12, "bold")).pack(side="left")
        self.vault_summary = tk.Label(vault_head, text="", bg="white",
                                      fg=MUTED, font=("Segoe UI", 9))
        self.vault_summary.pack(side="right")
        tree_row = tk.Frame(self.files_frame, bg="white",
                            highlightbackground=BORDER, highlightthickness=1)
        tree_row.pack(fill="both", expand=True)
        columns = ("size",)
        self.tree = ttk.Treeview(tree_row, columns=columns,
                                 selectmode="extended")
        self.tree.heading("#0", text="File")
        self.tree.heading("size", text="Size")
        self.tree.column("#0", width=470)
        self.tree.column("size", width=90, anchor="e")
        scroll = ttk.Scrollbar(tree_row, orient="vertical",
                               command=self.tree.yview)
        self.tree.configure(yscrollcommand=scroll.set)
        self.tree.pack(side="left", fill="both", expand=True)
        scroll.pack(side="left", fill="y")

        self.vault_buttons = tk.Frame(tab, bg="white")
        self._primary_button(self.vault_buttons, "Restore selected…",
                             self.restore_selected).pack(side="left",
                                                         padx=(0, 10))
        self._secondary_button(self.vault_buttons, "Encrypt waiting files…",
                               self.sweep_protected).pack(side="left",
                                                          padx=(0, 10))
        self._secondary_button(self.vault_buttons, "Back up vault…",
                               self.backup_vault).pack(side="left",
                                                       padx=(0, 10))
        self._secondary_button(self.vault_buttons, "Lock",
                               self.lock).pack(side="left")
        self.vault_msg = tk.Label(self.vault_buttons, text="", fg=MUTED,
                                  bg="white", font=("Segoe UI", 9))
        self.vault_msg.pack(side="left", padx=(12, 0))
        self._sweeping = False
        self._backing_up = False

    def backup_vault(self) -> None:
        from tkinter import filedialog
        from . import backup as backup_mod
        if self._backing_up or self.vault is None:
            return
        dest = filedialog.askdirectory(
            title="Choose a backup location (USB drive, external disk)")
        if not dest:
            return
        vault_root = self.vault.root
        self._backing_up = True
        self.vault_msg.config(text="Backing up…")

        def progress(done: int, total: int) -> None:
            self.root.after(0, lambda: self.vault_msg.config(
                text=f"Backing up… {done:,} of {total:,}"))

        def worker() -> None:
            try:
                result = backup_mod.backup(
                    vault_root, Path(dest), on_progress=progress)
                err = None
            except Exception as exc:
                result, err = None, str(exc)
            self.root.after(0, done, result, err)

        def done(result, err) -> None:
            from tkinter import messagebox
            self._backing_up = False
            self.vault_msg.config(text="")
            if err:
                messagebox.showinfo("Kovyr Vault", f"Backup failed: {err}")
                return
            msg = (f"Backed up to {dest}: {result.copied:,} file(s) "
                   f"copied, {result.skipped:,} already current.")
            if result.errors:
                msg += f"  ({len(result.errors)} problem(s).)"
            messagebox.showinfo("Kovyr Vault", msg)

        threading.Thread(target=worker, daemon=True).start()

    # ---------- duplicates tab ----------

    def _qdir(self) -> Path:
        return Path((self.config or {}).get("quarantine")
                    or (DEFAULT_BASE / "quarantine"))

    def _build_dupes_tab(self) -> None:
        tk = self.tk
        ttk = self.ttk
        tab = self.dupes_tab

        header = tk.Frame(tab, bg="white")
        header.pack(fill="x")
        tk.Label(header, text="Duplicate copies from the last check",
                 bg="white", fg=TEXT,
                 font=("Segoe UI", 12, "bold")).pack(side="left")
        self._secondary_button(header, "Refresh",
                               self.refresh_dupes).pack(side="right")

        self.dupes_tree = ttk.Treeview(tab, columns=("size",),
                                       selectmode="extended", height=7)
        self.dupes_tree.heading("#0", text="File")
        self.dupes_tree.heading("size", text="Size")
        self.dupes_tree.column("#0", width=540)
        self.dupes_tree.column("size", width=80, anchor="e")
        self.dupes_tree.pack(fill="both", expand=True, pady=(6, 0))

        row = tk.Frame(tab, bg="white")
        row.pack(anchor="w", pady=(10, 0), fill="x")
        self._secondary_button(row, "Select all copies",
                               self.select_all_dupes).pack(side="left",
                                                           padx=(0, 8))
        self._secondary_button(row, "Clear selection",
                               self.clear_dupe_selection).pack(side="left",
                                                               padx=(0, 8))
        self._primary_button(row, "Quarantine selected…",
                             self.quarantine_selected).pack(side="left")
        tk.Label(tab, text="Nothing is deleted — quarantined files can "
                 "be restored from the list below.", fg=MUTED, bg="white",
                 font=("Segoe UI", 8)).pack(anchor="w", pady=(6, 0))

        tk.Label(tab, text="Quarantine", bg="white", fg=TEXT,
                 font=("Segoe UI", 12, "bold")).pack(anchor="w",
                                                     pady=(18, 0))
        self.quarantine_tree = ttk.Treeview(tab, columns=("age",),
                                            selectmode="extended", height=4)
        self.quarantine_tree.heading("#0", text="Original location")
        self.quarantine_tree.heading("age", text="Days held")
        self.quarantine_tree.column("#0", width=540)
        self.quarantine_tree.column("age", width=80, anchor="e")
        self.quarantine_tree.pack(fill="x", pady=(6, 0))

        qrow = tk.Frame(tab, bg="white")
        qrow.pack(anchor="w", pady=(8, 0))
        self._secondary_button(qrow, "Restore selected",
                               self.restore_quarantined).pack(side="left",
                                                              padx=(0, 8))
        self._secondary_button(qrow, "Empty quarantine…",
                               self.empty_quarantine).pack(side="left")
        self.dupes_msg = tk.Label(tab, text="", bg="white", fg=MUTED,
                                  font=("Segoe UI", 9))
        self.dupes_msg.pack(anchor="w", pady=(8, 0))

        self.refresh_dupes()

    def _latest_groups(self) -> list[dict]:
        if not self.config:
            return []
        try:
            history = monitor_mod.load_history(Path(self.config["state"]))
        except (OSError, ValueError, KeyError):
            return []
        if not history:
            return []
        return history[-1].get("groups") or []

    DUPES_ROW_CAP = 6000

    def refresh_dupes(self) -> None:
        self.dupes_tree.delete(*self.dupes_tree.get_children())
        groups = self._latest_groups()
        rows = 0
        shown_groups = 0
        for index, group in enumerate(groups):
            paths = group.get("paths") or []
            if len(paths) < 2:
                continue
            if rows >= self.DUPES_ROW_CAP:
                self.dupes_tree.insert(
                    "", "end", iid="::dupes-overflow::",
                    text=f"… more groups not shown (list capped at "
                    f"{self.DUPES_ROW_CAP:,} rows to stay responsive — "
                    "quarantine these first, then Refresh)",
                    values=("",))
                break
            keeper, redundant = keeper_and_redundant(paths)
            parent = self.dupes_tree.insert(
                "", "end", iid=f"group::{index}",
                text=f"{len(paths)} copies — keeping: {keeper}",
                values=(human_size(group.get("size", 0)),), open=True)
            for path in redundant:
                self.dupes_tree.insert(
                    parent, "end", iid=f"copy::{path}", text=path,
                    values=(human_size(group.get("size", 0)),))
            rows += 1 + len(redundant)
            shown_groups += 1
        if not groups:
            self.dupes_msg.config(
                text="No duplicates in the last check — run a check "
                "from the Protection status tab to refresh.")
        else:
            self.dupes_msg.config(text="")
        self.refresh_quarantine()

    def select_all_dupes(self) -> None:
        copies = [iid
                  for parent in self.dupes_tree.get_children("")
                  for iid in self.dupes_tree.get_children(parent)]
        self.dupes_tree.selection_set(copies)
        if copies:
            self.dupes_msg.config(
                text=f"Selected all {len(copies)} redundant copies — "
                "one copy of each file is kept and cannot be selected.")
        else:
            self.dupes_msg.config(
                text="No duplicates to select — run a check first.")

    def clear_dupe_selection(self) -> None:
        self.dupes_tree.selection_set([])
        self.dupes_msg.config(text="")

    def quarantine_selected(self) -> None:
        from tkinter import messagebox
        if getattr(self, "_dupes_busy", False):
            return
        paths = [iid[len("copy::"):] for iid in self.dupes_tree.selection()
                 if iid.startswith("copy::")]
        if not paths:
            self.dupes_msg.config(
                text="Select one or more copies first (the indented "
                "rows — the kept copy can't be quarantined).")
            return
        if not messagebox.askyesno(
                "Kovyr Vault",
                f"Move {len(paths):,} redundant cop"
                f"{'y' if len(paths) == 1 else 'ies'} to quarantine?\n\n"
                "Nothing is deleted. Each file can be restored to its "
                "original location from the Quarantine list."):
            return
        qdir = self._qdir()
        self._dupes_busy = True

        def progress(done: int, total: int) -> None:
            self.root.after(0, lambda: self.dupes_msg.config(
                text=f"Quarantining {done:,} of {total:,}…"))

        def worker() -> None:
            added, errors = quarantine_mod.add_many(
                qdir, [Path(p) for p in paths], on_progress=progress)
            self.root.after(0, finish, len(added), errors)

        def finish(moved: int, failed: list[str]) -> None:
            self._dupes_busy = False
            message = (f"Quarantined {moved:,} cop"
                       f"{'y' if moved == 1 else 'ies'}. "
                       "Run a check to update the status tiles.")
            if failed:
                message += f"  ({len(failed)} could not be moved.)"
            self.dupes_msg.config(text=message)
            self.refresh_dupes()

        threading.Thread(target=worker, daemon=True).start()

    def refresh_quarantine(self) -> None:
        self.quarantine_tree.delete(*self.quarantine_tree.get_children())
        self._quarantine_items = {
            item.stored: item for item in quarantine_mod.items(self._qdir())
        }
        for item in self._quarantine_items.values():
            self.quarantine_tree.insert(
                "", "end", iid=item.stored, text=item.original,
                values=(f"{int(item.age_days())}",))

    def restore_quarantined(self) -> None:
        if getattr(self, "_dupes_busy", False):
            return
        selected = self.quarantine_tree.selection()
        items = [self._quarantine_items[s] for s in selected
                 if s in self._quarantine_items]
        if not items:
            self.dupes_msg.config(
                text="Select quarantined files to restore first.")
            return
        qdir = self._qdir()
        self._dupes_busy = True

        def progress(done: int, total: int) -> None:
            self.root.after(0, lambda: self.dupes_msg.config(
                text=f"Restoring {done:,} of {total:,}…"))

        def worker() -> None:
            restored, errors = quarantine_mod.restore_many(
                qdir, items, on_progress=progress)
            self.root.after(0, finish, restored, errors)

        def finish(restored: int, failed: list[str]) -> None:
            self._dupes_busy = False
            message = (f"Restored {restored:,} file(s) to their "
                       "original location.")
            if failed:
                message += (f"  {len(failed)} problem(s): "
                            + "; ".join(failed[:3]))
            self.dupes_msg.config(text=message)
            self.refresh_quarantine()

        threading.Thread(target=worker, daemon=True).start()

    def empty_quarantine(self) -> None:
        from tkinter import messagebox
        entries = quarantine_mod.items(self._qdir())
        if not entries:
            self.dupes_msg.config(text="Quarantine is empty.")
            return
        eligible = quarantine_mod.eligible_for_purge(entries)
        if not eligible:
            oldest = max(int(entry.age_days()) for entry in entries)
            messagebox.showinfo(
                "Kovyr Vault",
                f"Nothing can be deleted yet. Files stay restorable for "
                f"{quarantine_mod.RETENTION_DAYS} days — the oldest has "
                f"been held {oldest} day(s).")
            return
        if not messagebox.askyesno(
                "Kovyr Vault",
                f"Securely erase {len(eligible)} file(s) held longer "
                f"than {quarantine_mod.RETENTION_DAYS} days?\n\n"
                "Each file is overwritten before deletion so it can't be "
                "recovered. THIS CANNOT BE UNDONE."):
            return
        removed = quarantine_mod.purge_eligible(self._qdir())
        self.dupes_msg.config(
            text=f"Securely erased {len(removed)} file(s); "
            f"{len(entries) - len(removed)} newer file(s) remain held.")
        self.refresh_quarantine()

    def _build_settings_tab(self) -> None:
        tk = self.tk
        tab = self.settings_tab

        tk.Label(tab, text="Two kinds of folders: everyday folders we "
                 "watch, locked folders we encrypt. Move a file into a "
                 "locked folder to archive it securely.", fg=MUTED,
                 bg="white", font=("Segoe UI", 9),
                 justify="left", wraplength=780).pack(anchor="w",
                                                      pady=(0, 10))

        tk.Label(tab, text="Everyday folders — watched, not encrypted",
                 fg=TEXT, bg="white",
                 font=("Segoe UI", 11, "bold")).pack(anchor="w")
        tk.Label(tab, text="For files in active use. Scanned for "
                 "duplicates and unusual changes (all subfolders); "
                 "files stay normal and editable.", fg=MUTED, bg="white",
                 font=("Segoe UI", 9), justify="left",
                 wraplength=780).pack(anchor="w", pady=(0, 6))

        folders = tk.Frame(tab, bg="white")
        folders.pack(fill="x")
        # relief="flat" + a 1px highlight ring: the Tk default sunken
        # border renders as a harsh dark box on both platforms.
        self.folders_list = tk.Listbox(folders, height=4,
                                       font=("Segoe UI", 10),
                                       bg="white", fg=TEXT,
                                       relief="flat", borderwidth=0,
                                       highlightthickness=1,
                                       highlightbackground=BORDER,
                                       highlightcolor=NAVY_LIGHT,
                                       selectbackground=SURFACE,
                                       selectforeground=NAVY,
                                       activestyle="none",
                                       selectmode="extended")
        self.folders_list.pack(side="left", fill="x", expand=True)
        btns = tk.Frame(folders, bg="white")
        btns.pack(side="left", padx=(10, 0), anchor="n")
        self._secondary_button(btns, "Add folder…",
                               self.add_folder).pack(fill="x", pady=(0, 6))
        self._secondary_button(btns, "Remove selected",
                               self.remove_folder).pack(fill="x")

        tk.Label(tab, text="Locked folders — encrypted into the vault",
                 fg=TEXT, bg="white",
                 font=("Segoe UI", 11, "bold")).pack(anchor="w",
                                                     pady=(14, 0))
        tk.Label(tab, text="For files you're storing, not using. Files "
                 "saved here (any subfolder) are encrypted when you "
                 "unlock and sweep — each is replaced by a small "
                 ".kovyr receipt.", fg=MUTED, bg="white",
                 font=("Segoe UI", 9), justify="left",
                 wraplength=780).pack(anchor="w", pady=(0, 6))
        pfolders = tk.Frame(tab, bg="white")
        pfolders.pack(fill="x")
        self.protected_list = tk.Listbox(pfolders, height=3,
                                         font=("Segoe UI", 10),
                                         bg="white", fg=TEXT,
                                         relief="flat", borderwidth=0,
                                         highlightthickness=1,
                                         highlightbackground=BORDER,
                                         highlightcolor=NAVY_LIGHT,
                                         selectbackground=SURFACE,
                                         selectforeground=NAVY,
                                         activestyle="none",
                                         selectmode="extended")
        self.protected_list.pack(side="left", fill="x", expand=True)
        pbtns = tk.Frame(pfolders, bg="white")
        pbtns.pack(side="left", padx=(10, 0), anchor="n")
        self._secondary_button(pbtns, "Add folder…",
                               self.add_protected_folder).pack(
                                   fill="x", pady=(0, 6))
        self._secondary_button(pbtns, "Remove selected",
                               self.remove_protected_folder).pack(fill="x")

        row = tk.Frame(tab, bg="white")
        row.pack(anchor="w", pady=(14, 0))
        tk.Label(row, text="Name on reports:", bg="white", fg=TEXT,
                 font=("Segoe UI", 10)).pack(side="left")
        self.client_entry = tk.Entry(row, width=28, font=("Segoe UI", 10),
                                     bg="white", fg=TEXT,
                                     insertbackground=TEXT,
                                     relief="flat", borderwidth=0,
                                   highlightthickness=1,
                                   highlightbackground=BORDER,
                                   highlightcolor=NAVY_LIGHT)
        self.client_entry.pack(side="left", padx=8)

        self.vault_status = tk.Label(tab, text="", bg="white", fg=MUTED,
                                     font=("Segoe UI", 9), justify="left",
                                     wraplength=780)
        self.vault_status.pack(anchor="w", pady=(14, 0))
        self.create_vault_btn = self._secondary_button(
            tab, "Create vault…", self.create_vault_dialog)

        actions = tk.Frame(tab, bg="white")
        actions.pack(anchor="w", pady=(18, 0))
        self._primary_button(actions, "Save settings",
                             self.save_settings).pack(side="left",
                                                      padx=(0, 10))
        self._secondary_button(actions, "Check for updates",
                               self.check_updates).pack(side="left",
                                                        padx=(0, 10))
        self._secondary_button(actions, "Open Kovyr dashboard",
                               self.open_dashboard).pack(side="left")
        self.settings_msg = tk.Label(tab, text="", bg="white", fg=MUTED,
                                     font=("Segoe UI", 9))
        self.settings_msg.pack(anchor="w", pady=(6, 0))

        self._load_settings_fields()

    def _load_settings_fields(self) -> None:
        self.folders_list.delete(0, "end")
        for p in (self.config or {}).get("paths", []):
            self.folders_list.insert("end", p)
        self.protected_list.delete(0, "end")
        for p in (self.config or {}).get("protected", []):
            self.protected_list.insert("end", p)
        self.client_entry.delete(0, "end")
        self.client_entry.insert(0, (self.config or {}).get("client", ""))
        self._refresh_vault_status()

    def add_protected_folder(self) -> None:
        from tkinter import filedialog
        folder = filedialog.askdirectory(
            title="Choose a folder whose contents get encrypted")
        if folder and folder not in self.protected_list.get(0, "end"):
            self.protected_list.insert("end", folder)

    def remove_protected_folder(self) -> None:
        for index in reversed(self.protected_list.curselection()):
            self.protected_list.delete(index)

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
                text="Add at least one monitored folder.", fg=BAD)
            return
        protected = list(self.protected_list.get(0, "end"))
        client = self.client_entry.get().strip()
        if self.config:
            self.config["paths"] = paths
            self.config["protected"] = protected
            self.config["client"] = client or self.config.get("client")
        else:
            self.config = build_default_config(client, paths)
            self.config["protected"] = protected
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

    def dashboard_url(self) -> str:
        return resolve_dashboard_url(self.config)

    def open_dashboard(self) -> None:
        """Open the Kovyr dashboard in the system browser. The app makes
        no connection of its own — it hands the URL to the browser."""
        url = self.dashboard_url()
        try:
            webbrowser.open(url)
            self.settings_msg.config(
                text=f"Opened {url} in your browser.", fg=MUTED)
        except Exception:
            self.settings_msg.config(
                text=f"Couldn't open a browser. Go to {url} manually.",
                fg=BAD)

    def check_updates(self) -> None:
        import ssl
        import urllib.request
        self.settings_msg.config(text="Checking for updates…", fg=MUTED)

        def worker() -> None:
            try:
                # Frozen apps ship without the OS trust store; certifi
                # provides the CA bundle so TLS verification works.
                try:
                    import certifi
                    context = ssl.create_default_context(
                        cafile=certifi.where())
                except ImportError:
                    context = ssl.create_default_context()
                # Constant, https-only endpoint — never user-controlled.
                if not UPDATE_API.startswith("https://"):
                    raise ValueError("update endpoint must be https")
                req = urllib.request.Request(UPDATE_API)
                with urllib.request.urlopen(  # noqa: S310 (constant https URL)
                        req, timeout=10, context=context) as resp:
                    data = json.load(resp)
                tag = data.get("tag_name", "")
                url = data.get("html_url", "")
                self._release_assets = data.get("assets") or []
                self.root.after(0, self._updates_done, tag, url,
                                is_newer_version(tag, __version__), None)
            except Exception as exc:
                self._release_assets = []
                self.root.after(0, self._updates_done, "", "", False,
                                str(exc))

        threading.Thread(target=worker, daemon=True).start()

    def _updates_done(self, tag: str, url: str, newer: bool,
                      error: str | None) -> None:
        from tkinter import messagebox
        if error:
            self.settings_msg.config(
                text=f"Could not check for updates: {error}", fg=BAD)
            return
        if not newer:
            self.settings_msg.config(
                text=f"You're up to date (v{__version__}).", fg=GOOD)
            return
        self.settings_msg.config(text="", fg=MUTED)

        from . import updater
        asset = updater.pick_asset(getattr(self, "_release_assets", []))
        bundle = updater.current_app_bundle()
        # One-click only where we can actually verify what we downloaded:
        # a signed macOS bundle. Everywhere else, hand off to the browser.
        if updater.supported() and asset and bundle:
            if messagebox.askyesno(
                    "Kovyr Vault",
                    f"A newer version is available ({tag}).\n\n"
                    "Download and install it now? Kovyr Vault will "
                    "restart when it's done."):
                self._install_update(asset, bundle)
            return
        if messagebox.askyesno(
                "Kovyr Vault",
                f"A newer version is available ({tag}).\n\n"
                "Open the download page?"):
            webbrowser.open(url)

    def _install_update(self, asset_url: str, bundle) -> None:
        """Download, verify and install a new version, then relaunch.
        Everything happens off the UI thread; the verification gate lives
        in updater.verify_update and is never bypassed here."""
        import tempfile
        from . import updater
        if getattr(self, "_updating", False):
            return
        self._updating = True
        self.settings_msg.config(text="Downloading update…", fg=MUTED)

        def progress(got: int, total: int) -> None:
            pct = f"{got * 100 // total}%" if total else human_size(got)
            self.root.after(0, lambda: self.settings_msg.config(
                text=f"Downloading update… {pct}", fg=MUTED))

        def worker() -> None:
            tmpdir = Path(tempfile.mkdtemp(prefix="kovyr-update-"))
            mount = None
            try:
                dmg = updater.download(asset_url, tmpdir / "update.dmg",
                                       on_progress=progress)
                self.root.after(0, lambda: self.settings_msg.config(
                    text="Verifying the download…", fg=MUTED))
                mount = updater.attach_dmg(dmg)
                new_app = updater.app_in_mount(mount)
                if new_app is None:
                    raise updater.UpdateError(
                        "the disk image didn't contain the app")
                updater.verify_update(new_app, bundle)
                self.root.after(0, lambda: self.settings_msg.config(
                    text="Installing…", fg=MUTED))
                updater.replace_bundle(new_app, bundle)
            except updater.UpdateError as exc:
                self.root.after(0, self._update_failed, str(exc))
                return
            except Exception as exc:                       # noqa: BLE001
                self.root.after(0, self._update_failed, str(exc))
                return
            finally:
                if mount is not None:
                    updater.detach_dmg(mount)
                shutil.rmtree(tmpdir, ignore_errors=True)
            self.root.after(0, self._update_installed, bundle)

        threading.Thread(target=worker, daemon=True).start()

    def _update_failed(self, message: str) -> None:
        from tkinter import messagebox
        self._updating = False
        self.settings_msg.config(text="Update failed.", fg=BAD)
        messagebox.showwarning(
            "Kovyr Vault",
            f"The update could not be installed:\n\n{message}\n\n"
            "Your current version is unchanged and still works. You can "
            "download the new version manually from the Kovyr releases "
            "page.")

    def _update_installed(self, bundle) -> None:
        from tkinter import messagebox
        from . import updater
        self._updating = False
        self.settings_msg.config(text="Update installed.", fg=GOOD)
        messagebox.showinfo(
            "Kovyr Vault",
            "The update is installed. Kovyr Vault will now restart.")
        updater.relaunch(bundle)
        self.root.after(200, self.root.destroy)

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
                 fg=TEXT, font=("Segoe UI", 12, "bold")).pack(anchor="w")
        tk.Label(dlg, text="Only you will know it. It is never stored, "
                 "and there is NO way to recover it —\na lost passphrase "
                 "means the encrypted files are gone forever.\nSave it in "
                 "a password manager now.", bg="white", fg=MUTED,
                 justify="left", font=("Segoe UI", 9)).pack(
                     anchor="w", pady=(4, 10))
        p1 = tk.Entry(dlg, show="•", width=30, font=("Segoe UI", 11),
                      bg="white", fg=TEXT, insertbackground=TEXT,
                      relief="flat", borderwidth=0,
                                   highlightthickness=1,
                                   highlightbackground=BORDER,
                                   highlightcolor=NAVY_LIGHT)
        p2 = tk.Entry(dlg, show="•", width=30, font=("Segoe UI", 11),
                      bg="white", fg=TEXT, insertbackground=TEXT,
                      relief="flat", borderwidth=0,
                                   highlightthickness=1,
                                   highlightbackground=BORDER,
                                   highlightcolor=NAVY_LIGHT)
        tk.Label(dlg, text="Passphrase:", bg="white", fg=TEXT,
                 font=("Segoe UI", 9)).pack(anchor="w")
        p1.pack(anchor="w", pady=(0, 6))
        tk.Label(dlg, text="Confirm:", bg="white", fg=TEXT,
                 font=("Segoe UI", 9)).pack(anchor="w")
        p2.pack(anchor="w", pady=(0, 10))

        use_keyfile = tk.BooleanVar(value=False)
        tk.Checkbutton(
            dlg, text="Also require a keyfile (two-factor)",
            variable=use_keyfile, bg="white", fg=TEXT,
            selectcolor="white", activebackground="white",
            font=("Segoe UI", 9)).pack(anchor="w")
        tk.Label(dlg, text="Adds a second factor: a small file kept on a "
                 "USB drive, needed\nalongside the passphrase. Stronger — "
                 "but losing the keyfile also\nlocks the vault forever.",
                 bg="white", fg=MUTED, justify="left",
                 font=("Segoe UI", 8)).pack(anchor="w", pady=(0, 8))
        msg = tk.Label(dlg, text="", bg="white", fg=BAD,
                       font=("Segoe UI", 9))
        msg.pack(anchor="w")

        def do_create() -> None:
            from tkinter import filedialog
            phrase, confirm = p1.get(), p2.get()
            if not phrase:
                msg.config(text="Passphrase must not be empty.")
                return
            if phrase != confirm:
                msg.config(text="Passphrases do not match.")
                return
            keyfile_path = None
            if use_keyfile.get():
                dest = filedialog.asksaveasfilename(
                    title="Save the new keyfile (e.g. on a USB drive)",
                    defaultextension=".kovyrkey",
                    initialfile="vault.kovyrkey")
                if not dest:
                    msg.config(text="Choose where to save the keyfile.")
                    return
                try:
                    keyfile_path = generate_keyfile(Path(dest))
                except (VaultError, OSError) as exc:
                    msg.config(text=str(exc))
                    return
            try:
                Vault.create(vault_path, phrase, keyfile=keyfile_path)
            except (VaultError, OSError) as exc:
                msg.config(text=str(exc))
                return
            dlg.destroy()
            self._refresh_vault_status()
            note = ("Vault created. Write the passphrase into a password "
                    "manager now — it cannot be recovered.")
            if keyfile_path:
                note += (f"\n\nKeyfile saved to {keyfile_path}. Keep it on "
                         "its own device and back it up — it is the second "
                         "factor and cannot be regenerated.")
            messagebox.showinfo("Kovyr Vault", note)

        self._primary_button(dlg, "Create vault", do_create).pack(
            anchor="w", pady=(8, 0))
        p1.focus_set()

    # ---------- status tab behavior ----------

    def _start_posture_check(self) -> None:
        """Run the baseline device-security checks off the UI thread — the
        OS tools are fast but shelling out shouldn't ever stall the window."""
        from . import posture

        def worker() -> None:
            try:
                checks = posture.check_all()
            except Exception:  # never let a status check crash the app
                checks = None
            self.root.after(0, lambda: self._show_posture(checks))

        threading.Thread(target=worker, daemon=True).start()

    def _show_posture(self, checks) -> None:
        tk = self.tk
        for child in self.posture_box.winfo_children():
            child.destroy()
        if not checks:
            tk.Label(self.posture_box, text="Couldn't run device checks.",
                     fg=MUTED, bg="white", font=("Segoe UI", 10)).pack(
                         anchor="w")
            return
        for i, c in enumerate(checks):
            if i:  # hairline between rows, not above the first
                tk.Frame(self.posture_box, bg=HAIRLINE, height=1).pack(
                    fill="x", pady=1)
            # "–" = doesn't apply on this platform (expected, not a gap);
            # "?" = applies but we couldn't determine it (worth a look).
            if c.status is True:
                mark, color = "✓", GOOD
            elif c.status is False:
                mark, color = "⚠", BAD
            elif not getattr(c, "applicable", True):
                mark, color = "–", MUTED
            else:
                mark, color = "?", MUTED
            row = tk.Frame(self.posture_box, bg="white")
            row.pack(fill="x", pady=3)
            tk.Label(row, text=mark, fg=color, bg="white", width=2,
                     font=("Segoe UI", 11, "bold")).pack(side="left",
                                                         anchor="n")
            name = tk.Label(row, bg="white", font=("Segoe UI", 10, "bold"),
                            text=c.name, fg=TEXT)
            name.pack(side="left", anchor="n")
            txt = tk.Label(row, bg="white", justify="left", wraplength=610,
                           font=("Segoe UI", 10),
                           text=f"  {c.detail}",
                           fg=(BAD if c.status is False else MUTED))
            txt.pack(side="left", anchor="w")

    def scan_sensitive(self) -> None:
        """Scan the watched folders for unencrypted sensitive data (SSNs,
        card numbers), off the UI thread. Local only; counts only."""
        if getattr(self, "_scanning_sensitive", False) or not self.config:
            return
        from . import sensitive
        paths = [Path(p) for p in self.config.get("paths", [])]
        if not paths:
            self.activity.config(text="No watched folders to scan — add "
                                 "folders in Settings first.")
            return
        vault = self._vault_path()
        self._scanning_sensitive = True
        self.activity.config(text="Scanning for unencrypted sensitive files…")

        def worker() -> None:
            try:
                report = sensitive.scan_paths(paths, exclude=[vault])
            except Exception:
                report = None
            self.root.after(0, self._sensitive_done, report)

        threading.Thread(target=worker, daemon=True).start()

    def _sensitive_done(self, report) -> None:
        from tkinter import messagebox
        from . import sensitive
        self._scanning_sensitive = False
        if report is None:
            self.activity.config(text="Couldn't complete the sensitive-data "
                                 "scan.")
            return
        coverage = sensitive.coverage_note(report.read, report.skipped)
        if not report.findings:
            self.activity.config(text=coverage, fg=MUTED)
            messagebox.showinfo(
                "Kovyr Vault",
                "No unencrypted SSNs or card numbers found in your watched "
                f"folders.\n\n{coverage}")
            return
        s = sensitive.summarize(report)
        self.activity.config(
            text=f"⚠ {s['files']} file(s) hold unencrypted sensitive data — "
            "consider moving them into the vault.", fg=BAD)
        self._show_sensitive_results(report.findings, s, coverage)

    def _show_sensitive_results(self, findings, summary,
                                coverage: str = "") -> None:
        tk = self.tk
        ttk = self.ttk
        win = tk.Toplevel(self.root)
        win.title("Unencrypted sensitive files")
        win.configure(bg="white")
        win.geometry("640x420")
        tk.Label(win, text="Unencrypted sensitive files", bg="white", fg=TEXT,
                 font=("Segoe UI", 13, "bold")).pack(anchor="w",
                                                     padx=16, pady=(14, 0))
        tk.Label(win, bg="white", fg=MUTED, justify="left", wraplength=600,
                 font=("Segoe UI", 9),
                 text=f"{summary['ssns']} SSN(s) and {summary['cards']} card "
                 f"number(s) across {summary['files']} file(s), sitting "
                 "outside the vault. Only counts are shown — the actual "
                 "numbers are never recorded or sent anywhere.").pack(
                     anchor="w", padx=16, pady=(2, 8))
        tree = ttk.Treeview(win, columns=("ssn", "card"),
                            selectmode="browse")
        tree.heading("#0", text="File")
        tree.heading("ssn", text="SSNs")
        tree.heading("card", text="Cards")
        tree.column("#0", width=440)
        tree.column("ssn", width=70, anchor="e")
        tree.column("card", width=70, anchor="e")
        for f in findings:
            tree.insert("", "end", text=f.path,
                        values=(f.ssn or "", f.card or ""))
        tree.pack(fill="both", expand=True, padx=16, pady=(0, 8))
        if coverage:
            tk.Label(win, bg="white", fg=MUTED, justify="left",
                     wraplength=600, font=("Segoe UI", 9),
                     text=coverage).pack(anchor="w", padx=16, pady=(0, 4))
        tk.Label(win, bg="white", fg=MUTED, justify="left", wraplength=600,
                 font=("Segoe UI", 9),
                 text="To protect these, move them into a Locked folder (see "
                 "Settings) and run a sweep, or restore them into the vault.").pack(
                     anchor="w", padx=16, pady=(0, 12))

    def _set_banner(self, state: str) -> None:
        """Tint the status banner by state: good / bad / neutral. The
        colored spine makes the overall state readable at a glance."""
        fills = {"good": (GOOD, GOOD_BG), "bad": (BAD, BAD_BG),
                 "neutral": (MUTED, SURFACE)}
        spine, bg = fills.get(state, fills["neutral"])
        self.banner_spine.config(bg=spine)
        for widget in (self.banner, self.banner_body, self.headline,
                       self.subline):
            widget.config(bg=bg)

    def refresh_status(self) -> None:
        if self.config is None:
            self._set_banner("neutral")
            self.headline.config(text="Not set up yet", fg=TEXT)
            self.subline.config(
                text="Open the Settings tab to choose the folders to "
                "protect and create your vault.")
            self.detail_text.config(
                text="Kovyr Vault isn't set up on this machine yet. Open "
                "the Settings tab to choose the folders to watch and to "
                "create your encrypted vault.")
            return
        try:
            history = monitor_mod.load_history(Path(self.config["state"]))
        except (OSError, ValueError, KeyError) as exc:
            history = []
            self.activity.config(text=f"Could not read history: {exc}")
        summary = status_summary(history)
        if not summary["configured"]:
            self._set_banner("neutral")
            self.headline.config(text="No checks recorded yet", fg=TEXT)
            self.subline.config(text="Click “Run check now” to record "
                                "the first snapshot.")
            self.detail_text.config(
                text="No protection check has run yet. Click “Run check "
                "now” to scan your watched folders and record the first "
                "snapshot.")
            return
        if summary["clean"]:
            self._set_banner("good")
            self.headline.config(text="✓ Protected", fg=GOOD)
        elif summary["alerts"]:
            self._set_banner("bad")
            self.headline.config(
                text="⚠ Attention needed — see details below", fg=BAD)
        elif summary["awaiting"]:
            self._set_banner("bad")
            self.headline.config(
                text=f"⚠ {summary['awaiting']} file(s) awaiting "
                "encryption — unlock the vault to sweep them", fg=BAD)
        elif summary["new_groups"]:
            self._set_banner("bad")
            self.headline.config(
                text=f"⚠ {summary['new_groups']} new duplicate "
                "group(s) found", fg=BAD)
        else:
            n = summary['duplicates']
            self._set_banner("bad")
            self.headline.config(
                text=f"⚠ {n:,} redundant cop{'y' if n == 1 else 'ies'} "
                "present", fg=BAD)
        self.subline.config(text=f"Last check: {summary['last_run']}")
        self.tile_vars["files"].set(f"{summary['files']:,}")
        self.tile_vars["dupes"].set(f"{summary['duplicates']:,}")
        self.tile_vars["exposure"].set(human_size(summary["exposure"]))
        self.detail_text.config(text=status_detail(summary))

    def run_check(self) -> None:
        if self.config is None:
            return
        self.check_btn.set_enabled(False)
        self.activity.config(text="Checking…")
        threading.Thread(target=self._run_check_worker, daemon=True).start()

    def _run_check_worker(self) -> None:
        try:
            state_path = Path(self.config["state"])
            cache = monitor_mod.load_hash_cache(state_path)

            def scan_progress(reads: int, current: str) -> None:
                name = Path(current).name
                self.root.after(0, lambda: self.activity.config(
                    text=f"Checking… {reads:,} files read · "
                         f"currently: {name}"))

            result = scanner.scan(
                [Path(p) for p in self.config["paths"]], cache=cache,
                on_progress=scan_progress)
            vault_path = self.config.get("vault")
            _snap, drift, history = monitor_mod.record_run(
                state_path, result, now_stamp(),
                vault=Path(vault_path) if vault_path else None,
                protected=self._protected_dirs() or None,
                hash_cache=cache)
            alert = notify_mod.compose_alert(_snap, len(drift.new_groups))
            if alert:
                notify_mod.send(alert)
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
        self.check_btn.set_enabled(True)
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
        keyfile = None
        if Vault.requires_keyfile(Path(vault_path)):
            from tkinter import filedialog
            chosen = filedialog.askopenfilename(
                title="Select the vault's keyfile (on your USB drive)")
            if not chosen:
                self.unlock_msg.config(
                    text="This vault needs its keyfile to unlock.")
                return
            keyfile = chosen
        self.unlock_btn.set_enabled(False)
        self.unlock_msg.config(text="Unlocking…", fg=MUTED)
        threading.Thread(target=self._unlock_worker,
                         args=(vault_path, passphrase, keyfile),
                         daemon=True).start()

    def _unlock_worker(self, vault_path: str, passphrase: str,
                       keyfile: str | None = None) -> None:
        try:
            vault = Vault.open(Path(vault_path), passphrase,
                               keyfile=Path(keyfile) if keyfile else None)
            error = None
        except crypto.WrongPassphrase:
            vault, error = None, "That passphrase or keyfile is not correct."
        except (VaultError, OSError) as exc:
            vault, error = None, str(exc)
        self.root.after(0, self._unlock_done, vault, error)

    def _unlock_done(self, vault, error) -> None:
        self.unlock_btn.set_enabled(True)
        if error:
            self.unlock_msg.config(text=error, fg=BAD)
            return
        self.vault = vault
        self.pass_entry.delete(0, "end")
        self.unlock_msg.config(text="")
        self.unlock_frame.pack_forget()
        self.files_frame.pack(fill="both", expand=True)
        self.vault_buttons.pack(anchor="w", pady=(10, 0))
        self._refresh_vault_list()
        self._select_pending_receipt()
        # Anything sitting in the Protected folders? Offer the sweep now.
        waiting = self._waiting_protected()
        if waiting:
            from tkinter import messagebox
            if messagebox.askyesno(
                    "Kovyr Vault",
                    f"{len(waiting)} file(s) in your Protected folders "
                    "are not encrypted yet.\n\nEncrypt them into the "
                    "vault now? Each is replaced by a .kovyr receipt."):
                self._do_sweep()

    VAULT_LIST_CAP = 5000

    def _refresh_vault_list(self) -> None:
        self.tree.delete(*self.tree.get_children())
        if self.vault is None:
            self.vault_summary.config(text="")
            return
        entries = sorted(self.vault.list_files().items())
        total = sum(e.size for _n, e in entries)
        self.vault_summary.config(
            text=f"{len(entries):,} file{'' if len(entries) == 1 else 's'} "
            f"encrypted · {human_size(total)}")
        for name, entry in entries[:self.VAULT_LIST_CAP]:
            self.tree.insert("", "end", iid=name, text=name,
                             values=(human_size(entry.size),))
        if len(entries) > self.VAULT_LIST_CAP:
            self.tree.insert(
                "", "end", iid="::overflow::",
                text=f"… and {len(entries) - self.VAULT_LIST_CAP:,} more "
                "files (list capped to keep the app responsive)",
                values=("",))

    def _protected_dirs(self) -> list[Path]:
        return [Path(p) for p in (self.config or {}).get("protected", [])]

    def _waiting_protected(self) -> list[Path]:
        dirs = self._protected_dirs()
        if not dirs:
            return []
        exclude = Path(self.config["vault"]) if (
            self.config and self.config.get("vault")) else None
        return protect_mod.waiting_files(dirs, exclude=exclude)

    def sweep_protected(self) -> None:
        from tkinter import messagebox
        if self.vault is None:
            return
        if not self._protected_dirs():
            messagebox.showinfo(
                "Kovyr Vault",
                "No Protected folders are set up — add one on the "
                "Settings tab first.")
            return
        waiting = self._waiting_protected()
        if not waiting:
            messagebox.showinfo(
                "Kovyr Vault",
                "Nothing is waiting — every file in your Protected "
                "folders is already encrypted.")
            return
        if messagebox.askyesno(
                "Kovyr Vault",
                f"Encrypt {len(waiting)} file(s) into the vault?\n\n"
                "Each original is replaced by a .kovyr receipt; the "
                "content will only be readable through this app."):
            self._do_sweep()

    def _do_sweep(self) -> None:
        if self._sweeping or self.vault is None:
            return
        self._sweeping = True
        self.vault_msg.config(text="Encrypting…")
        vault = self.vault
        dirs = self._protected_dirs()

        def progress(done: int, total: int) -> None:
            self.root.after(0, lambda: self.vault_msg.config(
                text=f"Encrypting {done:,} of {total:,} files…"))

        def worker() -> None:
            try:
                encrypted, errors = protect_mod.sweep(
                    vault, dirs, on_progress=progress)
            except Exception as exc:
                encrypted, errors = 0, [str(exc)]
            self.root.after(0, self._sweep_done, encrypted, errors)

        threading.Thread(target=worker, daemon=True).start()

    def _sweep_done(self, encrypted: int, errors: list[str]) -> None:
        from tkinter import messagebox
        self._sweeping = False
        self.vault_msg.config(text="")
        self._refresh_vault_list()
        message = (f"Encrypted {encrypted:,} file(s) into the vault. "
                   "Receipts mark where each one came from.")
        if errors:
            message += f"\n\n{len(errors)} could not be encrypted:\n"
            message += "\n".join(errors[:5])
        messagebox.showinfo("Kovyr Vault", message)

    def lock(self) -> None:
        if self._sweeping:
            self.vault_msg.config(
                text="Encrypting — the vault locks when the sweep finishes.")
            return
        if self.vault is not None:
            self.vault.log_lock()
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


def run_app(config_path: Path | None = None, selftest: bool = False,
            receipt: str | None = None) -> int:
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
    if receipt:
        app.handle_receipt(receipt)
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
    parser.add_argument("receipt", nargs="?",
                        help="a .kovyr receipt to retrieve (Windows "
                             "passes double-clicked files this way)")
    args = parser.parse_args(argv)
    return run_app(Path(args.config) if args.config else None,
                   selftest=args.selftest, receipt=args.receipt)


if __name__ == "__main__":
    sys.exit(main())
