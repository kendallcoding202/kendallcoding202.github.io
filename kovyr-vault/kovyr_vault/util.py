"""Small shared helpers."""

from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path


def human_size(n: float) -> str:
    for unit in ("B", "KB", "MB", "GB", "TB"):
        if n < 1024 or unit == "TB":
            return f"{n:.1f} {unit}" if unit != "B" else f"{int(n)} B"
        n /= 1024
    return f"{n:.1f} TB"


def now_stamp() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")


def mirror_path(dest: Path, name: str) -> Path:
    """Rebuild a vault entry's original path underneath dest.

    Drive letters (Windows) and leading separators can't nest directly.
    """
    parts = [p.replace(":", "") for p in Path(name).parts
             if p not in ("/", "\\")]
    return dest.joinpath(*parts)
