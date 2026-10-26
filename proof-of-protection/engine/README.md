# Proof engine

Turns security checks into signed, time-stamped statements in a
witness-cosigned transparency log, and bundles them into Proof Packs that an
insurer, client or regulator can verify offline without trusting the vendor.

* **Go** (this folder): the library a future endpoint agent imports, the demo
  generator and the `proofctl` CLI. Standard library only.
* **Python** (`python/`): the server side (statement building, ingest, log,
  witnesses, pack build and verify). Standard library plus `cryptography`.
* **JavaScript** (`../demo/verifier/`): the in-browser verifier.

All three follow [SPEC.md](SPEC.md) and pass the shared vectors in
[testdata/vectors](testdata/vectors). Everything here is a prototype: device
keys are software keys, and the timestamp authorities and witnesses are
simulated with local keys. See SPEC.md section 14 and 15.

## Quick start

Requires Go 1.24 (and Python 3.10+ with `cryptography` for `python/`).

```sh
cd engine
go test ./...                               # Go suite, including the attack tests
go run ./cmd/proofctl help

# Verify the demo's sample Proof Pack, fully offline:
go run ./cmd/proofctl verify --pack ../demo/data/pack.json --trust ../demo/data/trust-policy.json

# The same with the Python verifier, and the Python suite:
python3 -I python/proofctl.py verify --pack ../demo/data/pack.json --trust ../demo/data/trust-policy.json
(cd python && python3 -I -m unittest discover -s tests -t .)

# The browser verifier against the shared vectors, and the page end to end:
(cd ../demo && node tests/vectors.js && node tests/e2e.js)
```

## The whole flow by hand

One binary plays every role so the flow fits on one machine. In production
these are different machines run by different parties.

```sh
go build -o /tmp/proofctl ./cmd/proofctl && P=/tmp/proofctl && W=$(mktemp -d) && cd $W
# Keys: the log, two (simulated) timestamp authorities, two witnesses, the firm, one laptop.
$P keygen --alg ed25519 --role log --name example.com/log --out log.json
for n in tsa-a tsa-b; do $P keygen --alg ed25519 --role tsa --name $n.example --out $n.json; done
for n in witness-a witness-b; do $P keygen --alg ed25519 --role witness --name $n.example --out $n.json; done
$P keygen --role tenant --name firm --out firm.json            # ECDSA P-256 by default
$P keygen --role device --name laptop1 --out laptop1.json
S="--dir log --log-key log.json --tsa tsa-a.example=tsa-a.json --tsa tsa-b.example=tsa-b.json"

$P log init --dir log --log-key log.json --origin example.com/log
$P tenant $S --tenant-key firm.json --name "Example Firm" --out firm-id.json
$P enroll $S --tenant-key firm.json --key laptop1.json --kind device_agent --number 1 --state laptop1.state
DEV=$(jq -r .attester laptop1.state)

cat > checks.json <<'EOF'
{"device": {"disk_encryption": "on", "os_patch_status": "current", "firewall_on": true,
  "screen_lock_on": true, "screen_lock_max_idle_min": 10, "edr_running": true, "edr_kind": "defender",
  "local_admin_count": 1, "unapproved_remote_tools": {"items": [], "total": 0, "truncated": false},
  "heartbeat_interval_s": 300, "heartbeats_24h": 288}}
EOF
NONCE=$($P challenge --dir log --subject $DEV)                 # one-time server challenge
$P attest --key laptop1.json --tenant-key-pub firm.pub.json --state laptop1.state \
  --nonce $NONCE --input checks.json --out report.json         # the device signs
$P log append $S --envelope report.json                        # validate, timestamp, log the commitment
$P log append $S --envelope report.json                        # refused: replay

$P checkpoint $S --keep kept                                   # sign; the firm keeps a copy
for w in witness-a witness-b; do
  $P witness cosign --log-public log/public --log-vkey @log/log.json --key $w.json --state $w.state --apply log
done
$P prove inclusion --log-public log/public --index 2

$P trust --dir log --witness-key-pub witness-a.pub.json --witness-key-pub witness-b.pub.json \
  --tsa-pub tsa-a.example=tsa-a.pub.json --tsa-pub tsa-b.example=tsa-b.pub.json --quorum 2 --out trust.json
$P pack --dir log --trust trust.json --firm firm-id.json --from $(date -u +%F) --to $(date -u +%F) \
  --earlier kept/checkpoint-*.txt --out pack.json
$P verify --pack pack.json --trust trust.json                  # exit status 0 only if every check passes
ls log/public log/public/tile                                  # all the public sees: checkpoint and digests
```

`log/public/` is a static site in the C2SP tlog-tiles layout; serve it from
any web server or bucket. `log/private/` holds evidence (envelopes and
timestamp tokens) and must never be published.

## Packages

| Package | What it does |
|---|---|
| `brand` | The only brand-dependent strings (product name, predicate type URIs). |
| `canon` | `strict-json-c14n/v1` canonical JSON and the strict container parser. |
| `sigs` | ES256 (P1363, low-S) and Ed25519; canonical SPKI keys; `NewSigner(crypto.Signer)` adapts any signer, including a TPM- or Secure Enclave-backed one. |
| `dsse` | DSSE v1 envelopes. |
| `posture` | The statement schema (as data), typed builders that accept no strings, and the validator. |
| `merkle` | RFC 6962/9162 trees, proofs and verification. |
| `note` | C2SP signed notes, checkpoints and cosignatures. |
| `tsa` | Timestamp authority interface; simulated authority; token verification. |
| `tlog` | The log (commitments only, tlog-tiles publishing) and the ingest server. |
| `witness` | A witness that cosigns only consistent checkpoints. |
| `pack` | Proof Pack build, strict parsing and the ten-step verifier. |
| `keys` | Software key files (kept apart so the builder never touches files). |
| `internal/sample` | The demo world and its attack scenarios. |
| `internal/vectors` | Generator for `testdata/vectors`. |

## Using the library from an agent

```go
signer, _ := sigs.NewSigner(tpmKey)            // any crypto.Signer: TPM via CNG, Secure Enclave, or software
payload, err := posture.BuildDevice(posture.Header{
    TenantKey: tenantPub, Attester: signer.Public(), Kind: posture.DeviceAgent,
    Seq: state.Seq + 1, Prev: state.Prev, Nonce: nonceFromServer, Salt: mustSalt(), ObservedAt: time.Now(),
}, posture.DeviceChecks{DiskEncryption: posture.EncryptionOn, OSPatch: posture.PatchCurrent /* ... */})
env, err := posture.Sign(payload, signer)      // DSSE envelope, ready to submit
```

The builder takes typed values only. Classify raw observations (registry
values, file paths, product names) into these types in a separate package;
the builder never sees them, and a test enforces that its package imports
nothing that touches files, the network or the OS.

## Regenerating generated files

```sh
cd engine
go run ./cmd/proofctl demo generate --keys ../demo/demo-keys --out ../demo   # demo data, schema.js, brand.js
go run ./cmd/proofctl vectors --out testdata/vectors                        # cross-language vectors
(cd python && python3 -I sync_schema.py)                                    # Python's embedded schema
```

Generation is deterministic (Ed25519 and RFC 6979 ECDSA signatures, seeded
nonces and salts), so regenerating produces byte-identical files. Tests fail
if committed files drift. The demo generator uses only the published demo
keys in `../demo/demo-keys` (see the warning there).
