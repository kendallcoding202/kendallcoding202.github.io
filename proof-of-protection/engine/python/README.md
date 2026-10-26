# proofengine (Python)

The Python implementation of the proof engine, shaped to drop into a
server's worker processes: build and validate statements (the no-free-text
rule enforced in both), DSSE signing and verification (ECDSA P-256 for
devices and people, Ed25519 for the vendor's service keys), the Merkle log
(append, tree head, inclusion and consistency proofs, C2SP tlog-tiles),
C2SP checkpoints, witness cosigning and verification, salted commitments,
and Proof Pack build and verify.

It mirrors the Go engine and passes the same vectors
(`../testdata/vectors`). The specification is [../SPEC.md](../SPEC.md).

* Dependencies: the standard library and `cryptography` (tested with 50.x on
  Python 3.13; needs Python 3.10+).
* Tests: stdlib `unittest`, nothing to install.

```sh
cd engine/python
python3 -I -m unittest discover -s tests -t .        # all tests, including the shared vectors
python3 -I proofctl.py verify --pack ../../demo/data/pack.json --trust ../../demo/data/trust-policy.json
python3 -I sync_schema.py                             # after the Go schema changes
```

`python3 -I` ignores the current directory and `PYTHONPATH`; `proofctl.py`
adds its own folder explicitly, and unittest discovery adds `-t .`.

## Modules

| Module | Purpose |
|---|---|
| `brand` | Brand-dependent constants (kept in sync with Go by a test). |
| `canon` | `strict-json-c14n/v1` and the strict container parser. |
| `sigs` | Keys, ES256 (P1363, low-S) and Ed25519, `Signer` protocol (a KMS-backed signer only needs `public()` and `sign()`). |
| `dsse` | DSSE v1 envelopes. |
| `posture` | Schema validator, typed builders (`build_device`, `build_tenant_posture`, `build_scan`, `build_staff_event`, enrollments). Builders accept Enum members, ints, bools and datetimes only. |
| `_schema` | The statement schema, generated from Go by `sync_schema.py`. |
| `merkle`, `note`, `tsa` | Trees and proofs; signed notes, checkpoints and cosignatures; timestamp authorities. |
| `tlog` | The log (commitments only) and the ingest server (`Server.submit`). |
| `witness` | Cosigns only checkpoints consistent with what it saw before. |
| `pack` | Proof Pack build, parse and the ten-step verifier. |

## Example: sign an external scan result with the service key

```python
from proofengine import posture, sigs
from proofengine.posture import AttesterKind, Header, ScanCheck, ScanResult, ScanStatus, Severity

h = Header(tenant_key, service_signer.public(), AttesterKind.EXTERNAL_SCANNER, seq, prev, nonce,
           posture.new_salt(), observed_at)
payload = posture.build_scan(h, [ScanResult(ScanCheck.EMAIL_04, ScanStatus.WARN, Severity.MEDIUM)])
envelope = posture.sign(payload, service_signer)
evidence = server.submit(envelope)     # tlog.Server: validates, timestamps, logs the commitment
```

`tlog.Server` keeps state in memory and is not safe for concurrent use; in a
worker, persist the evidence and nonce tables in the database and serialize
appends per log.
