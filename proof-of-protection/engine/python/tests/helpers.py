"""Shared test helpers. Paths are relative to this file, so the project
folder can be renamed."""

import json
import pathlib

HERE = pathlib.Path(__file__).resolve().parent
ENGINE = HERE.parent.parent
VECTORS = ENGINE / "testdata" / "vectors"
DEMO_DATA = ENGINE.parent / "demo" / "data"


def vector(name):
    return json.loads((VECTORS / name).read_text(encoding="utf-8"))
