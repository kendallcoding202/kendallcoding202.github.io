"""RFC 6962 / RFC 9162 Merkle trees. Mirrors engine/merkle."""

from __future__ import annotations

import hashlib


class MerkleError(ValueError):
    pass


def leaf_hash(leaf: bytes) -> bytes:
    return hashlib.sha256(b"\x00" + leaf).digest()


def node_hash(left: bytes, right: bytes) -> bytes:
    return hashlib.sha256(b"\x01" + left + right).digest()


def empty_root() -> bytes:
    return hashlib.sha256(b"").digest()


def _split(n: int) -> int:
    """Largest power of two strictly less than n (n >= 2)."""
    return 1 << ((n - 1).bit_length() - 1)


class Tree:
    """Leaf hashes plus memoized complete subtrees (which never change)."""

    def __init__(self, leaf_hashes: list[bytes] | None = None):
        self._leaves: list[bytes] = list(leaf_hashes or [])
        self._memo: dict[tuple[int, int], bytes] = {}

    def append(self, h: bytes) -> int:
        self._leaves.append(h)
        return len(self._leaves) - 1

    @property
    def size(self) -> int:
        return len(self._leaves)

    def leaf_hash_at(self, i: int) -> bytes:
        return self._leaves[i]

    def _mth(self, lo: int, hi: int) -> bytes:
        n = hi - lo
        if n == 1:
            return self._leaves[lo]
        complete = n & (n - 1) == 0
        if complete and (lo, hi) in self._memo:
            return self._memo[(lo, hi)]
        k = _split(n)
        h = node_hash(self._mth(lo, lo + k), self._mth(lo + k, hi))
        if complete:
            self._memo[(lo, hi)] = h
        return h

    def subtree_root(self, lo: int, hi: int) -> bytes:
        if not 0 <= lo < hi <= self.size:
            raise MerkleError("bad subtree")
        return self._mth(lo, hi)

    def root(self, size: int | None = None) -> bytes:
        size = self.size if size is None else size
        if size > self.size:
            raise MerkleError(f"size {size} exceeds tree size {self.size}")
        return empty_root() if size == 0 else self._mth(0, size)

    def inclusion_proof(self, index: int, size: int) -> list[bytes]:
        if size > self.size or index >= size:
            raise MerkleError(f"no inclusion proof for index {index} in tree of size {size}")
        return self._path(index, 0, size)

    def _path(self, m: int, lo: int, hi: int) -> list[bytes]:
        n = hi - lo
        if n == 1:
            return []
        k = _split(n)
        if m < k:
            return self._path(m, lo, lo + k) + [self._mth(lo + k, hi)]
        return self._path(m - k, lo + k, hi) + [self._mth(lo, lo + k)]

    def consistency_proof(self, m: int, n: int) -> list[bytes]:
        if n > self.size or m > n:
            raise MerkleError(f"no consistency proof from {m} to {n}")
        if m == 0 or m == n:
            return []
        return self._subproof(m, 0, n, True)

    def _subproof(self, m: int, lo: int, hi: int, b: bool) -> list[bytes]:
        n = hi - lo
        if m == n:
            return [] if b else [self._mth(lo, hi)]
        k = _split(n)
        if m <= k:
            return self._subproof(m, lo, lo + k, b) + [self._mth(lo + k, hi)]
        return self._subproof(m - k, lo + k, hi, False) + [self._mth(lo, lo + k)]


def verify_inclusion(index: int, size: int, leaf: bytes, proof: list[bytes], root: bytes) -> bool:
    """RFC 9162 section 2.1.3.2."""
    if index >= size:
        return False
    fn, sn, r = index, size - 1, leaf
    for p in proof:
        if sn == 0:
            return False
        if fn & 1 or fn == sn:
            r = node_hash(p, r)
            if not fn & 1:
                while not fn & 1 and fn != 0:
                    fn >>= 1
                    sn >>= 1
        else:
            r = node_hash(r, p)
        fn >>= 1
        sn >>= 1
    return sn == 0 and r == root


def verify_consistency(first: int, second: int, proof: list[bytes], first_root: bytes, second_root: bytes) -> bool:
    """RFC 9162 section 2.1.4.2."""
    if first > second:
        return False
    if first == second:
        return not proof and first_root == second_root
    if first == 0:
        return not proof
    if not proof:
        return False
    if first & (first - 1) == 0:
        proof = [first_root] + list(proof)
    fn, sn = first - 1, second - 1
    while fn & 1:
        fn >>= 1
        sn >>= 1
    fr = sr = proof[0]
    for c in proof[1:]:
        if sn == 0:
            return False
        if fn & 1 or fn == sn:
            fr, sr = node_hash(c, fr), node_hash(c, sr)
            if not fn & 1:
                while not fn & 1 and fn != 0:
                    fn >>= 1
                    sn >>= 1
        else:
            sr = node_hash(sr, c)
        fn >>= 1
        sn >>= 1
    return sn == 0 and fr == first_root and sr == second_root
