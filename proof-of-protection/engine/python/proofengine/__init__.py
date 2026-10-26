"""Python implementation of the proof engine: statements, DSSE, the Merkle
log, C2SP checkpoints and witnesses, and Proof Pack build and verify.

It mirrors the Go engine (engine/) and passes the same test vectors
(engine/testdata/vectors). Dependencies: the standard library and
``cryptography``.
"""

__all__ = ["brand", "canon", "dsse", "merkle", "note", "pack", "posture", "sigs", "tlog", "tsa", "witness"]
