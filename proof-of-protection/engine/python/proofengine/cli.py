"""Command line: verify a Proof Pack, or print the schema.

    python3 -I proofctl.py verify --pack pack.json --trust trust-policy.json [--json]
"""

from __future__ import annotations

import argparse
import dataclasses
import json
import pathlib
import sys

from . import pack
from ._schema import SCHEMA


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="proofctl.py", description="Verify Proof Packs offline.")
    sub = ap.add_subparsers(dest="cmd", required=True)
    v = sub.add_parser("verify", help="verify a Proof Pack (exit 0 only if every check passes)")
    v.add_argument("--pack", required=True)
    v.add_argument("--trust", required=True, help="trust policy pinned by the verifier, never taken from the pack")
    v.add_argument("--json", action="store_true", help="machine-readable report")
    sub.add_parser("schema", help="print the statement schema")
    a = ap.parse_args(argv)
    if a.cmd == "schema":
        print(json.dumps(SCHEMA, indent=1, sort_keys=True))
        return 0
    trust = pack.parse_trust_policy(pathlib.Path(a.trust).read_bytes())
    try:
        p = pack.parse(pathlib.Path(a.pack).read_bytes())
    except ValueError as e:
        print(f"NOT VERIFIED: this is not a valid Proof Pack ({e})")
        return 1
    r = pack.verify(p, trust)
    if a.json:
        print(json.dumps({"verified": r.verified, "steps": [dataclasses.asdict(s) for s in r.steps], "computed_summary": r.computed}, indent=2))
    else:
        sys.stdout.write(r.text())
    return 0 if r.verified else 1
