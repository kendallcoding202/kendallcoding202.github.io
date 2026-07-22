"""PyInstaller entry point for the windowed client app (no console)."""

import sys

from kovyr_vault.gui import main

if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
