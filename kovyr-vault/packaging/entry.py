"""PyInstaller entry point — bundles the CLI into a standalone executable."""

import sys

from kovyr_vault.cli import main

if __name__ == "__main__":
    sys.exit(main())
