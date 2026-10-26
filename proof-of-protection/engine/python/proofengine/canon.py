"""strict-json-c14n/v1: the canonical JSON used for everything signed,
timestamped or hashed. Mirrors engine/canon (see SPEC.md, "Canonical JSON").

Values are dicts, lists, str, int and bool. None and floats are rejected.
Integers must be within +-(2**53 - 1). Strings and keys use only printable
ASCII except '"' and '\\', so no escape is ever needed. Keys are sorted by
byte value. No whitespace. A payload is canonical only if re-encoding its
parsed value reproduces it byte for byte.
"""

from __future__ import annotations

import json
from typing import Any

VERSION = "strict-json-c14n/v1"
MAX_SAFE_INT = 2**53 - 1
MAX_DEPTH = 32


class CanonError(ValueError):
    """Input is not acceptable JSON for this format."""


def check_string(s: str) -> None:
    for i, ch in enumerate(s):
        c = ord(ch)
        if c < 0x20 or c > 0x7E or ch == '"' or ch == "\\":
            raise CanonError(f"character 0x{c:02x} at offset {i} is outside the canonical string alphabet")


def _encode(v: Any, out: list[str], depth: int) -> None:
    if depth > MAX_DEPTH:
        raise CanonError("nesting too deep")
    if isinstance(v, bool):  # before int: bool is a subclass of int
        out.append("true" if v else "false")
    elif isinstance(v, int):
        if v > MAX_SAFE_INT or v < -MAX_SAFE_INT:
            raise CanonError(f"integer {v} outside the safe range")
        out.append(str(v))
    elif isinstance(v, str):
        check_string(v)
        out.append('"' + v + '"')
    elif isinstance(v, list):
        out.append("[")
        for i, e in enumerate(v):
            if i:
                out.append(",")
            _encode(e, out, depth + 1)
        out.append("]")
    elif isinstance(v, dict):
        out.append("{")
        for i, k in enumerate(sorted(v)):
            if not isinstance(k, str) or k == "":
                raise CanonError("object keys must be non-empty strings")
            check_string(k)
            if i:
                out.append(",")
            out.append('"' + k + '":')
            _encode(v[k], out, depth + 1)
        out.append("}")
    elif v is None:
        raise CanonError("null is not allowed")
    elif isinstance(v, float):
        raise CanonError("non-integer numbers are not allowed")
    else:
        raise CanonError(f"unsupported type {type(v).__name__}")


def encode(v: Any) -> bytes:
    """Return the canonical bytes of v."""
    out: list[str] = []
    _encode(v, out, 0)
    return "".join(out).encode("ascii")


def _pairs(pairs: list[tuple[str, Any]]) -> dict:
    d: dict = {}
    for k, v in pairs:
        if k in d:
            raise CanonError(f"duplicate object key {k!r}")
        d[k] = v
    return d


def _float(s: str) -> Any:
    raise CanonError("non-integer numbers are not allowed")


def _constant(s: str) -> Any:
    raise CanonError(f"{s} is not allowed")


def _int(s: str) -> int:
    if s == "-0":
        raise CanonError("negative zero is not allowed")
    if len(s.lstrip("-")) > 16:
        raise CanonError(f"integer {s} outside the safe range")
    n = int(s)
    if n > MAX_SAFE_INT or n < -MAX_SAFE_INT:
        raise CanonError(f"integer {s} outside the safe range")
    return n


def _walk(v: Any, depth: int) -> None:
    if depth > MAX_DEPTH:
        raise CanonError("nesting too deep")
    if v is None:
        raise CanonError("null is not allowed")
    if isinstance(v, str):
        try:
            v.encode("utf-8")
        except UnicodeEncodeError:
            raise CanonError("lone surrogate in string") from None
    elif isinstance(v, list):
        for e in v:
            _walk(e, depth + 1)
    elif isinstance(v, dict):
        for k, e in v.items():
            _walk(k, depth + 1)
            _walk(e, depth + 1)


def parse_container(b: bytes) -> Any:
    """Strictly parse JSON that is not itself signed (a Proof Pack file).

    Valid UTF-8, unique keys, safe integers only, no null, nothing after the
    value. Strings may use escapes and any Unicode.
    """
    try:
        text = b.decode("utf-8")
    except UnicodeDecodeError:
        raise CanonError("input is not valid UTF-8") from None
    try:
        v = json.loads(text, object_pairs_hook=_pairs, parse_float=_float, parse_int=_int, parse_constant=_constant)
    except CanonError:
        raise
    except (ValueError, RecursionError) as e:
        raise CanonError(str(e)) from None
    _walk(v, 0)
    return v


def parse(b: bytes) -> Any:
    """Parse bytes that must be exactly canonical."""
    v = parse_container(b)
    if encode(v) != b:
        raise CanonError("not in canonical form (" + VERSION + ")")
    return v


def parse_object(b: bytes) -> dict:
    v = parse(b)
    if not isinstance(v, dict):
        raise CanonError("top-level value must be an object")
    return v


def canonicalize(b: bytes) -> bytes:
    return encode(parse_container(b))
