"""Run the Python verifier without installing it, even under ``python3 -I``
(which ignores the current directory and PYTHONPATH):

    python3 -I proofctl.py verify --pack PACK.json --trust TRUST.json
"""

import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from proofengine.cli import main  # noqa: E402

sys.exit(main())
