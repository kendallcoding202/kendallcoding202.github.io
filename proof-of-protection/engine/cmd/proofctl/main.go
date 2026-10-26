// Command proofctl drives the proof engine: keys, enrollment, statements,
// the log, witnesses, proofs, Proof Packs and offline verification.
//
// One binary plays every role here (device agent, ingest server, log,
// witness, owner, verifier) so the whole flow can be tried on one machine.
// In production these run on different machines owned by different
// parties. Run "proofctl help" for usage.
package main

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"time"

	"proofengine/brand"
	"proofengine/canon"
	"proofengine/dsse"
	"proofengine/internal/sample"
	"proofengine/internal/vectors"
	"proofengine/keys"
	"proofengine/merkle"
	"proofengine/note"
	"proofengine/pack"
	"proofengine/posture"
	"proofengine/sigs"
	"proofengine/tlog"
	"proofengine/tsa"
	"proofengine/witness"
)

func main() { os.Exit(run(os.Args[1:], os.Stdout, os.Stderr)) }

func newContext() (context.Context, context.CancelFunc) {
	return signal.NotifyContext(context.Background(), os.Interrupt)
}

const usage = `proofctl: the %s proof engine

Keys and enrollment
  keygen     --alg ecdsa-p256-sha256|ed25519 --role ROLE --name NAME --out FILE
  log init   --dir LOG --log-key FILE [--origin ORIGIN]
  tenant     --dir LOG --log-key FILE --tsa NAME=KEY --tsa NAME=KEY --tenant-key FILE --name "Firm name" --out FIRM.json
  enroll     --dir LOG --log-key FILE --tsa ... --tenant-key FILE --key FILE --kind device_agent|cloud_connector|staff_attester
             [--class laptop|desktop|server] [--platform windows|macos|microsoft_365|mobile_app] [--number N]
             [--role owner|office_manager|bookkeeper] --state STATE.json

Statements and the log
  challenge  --dir LOG --subject ATTESTER_ID          issue a one-time nonce (server)
  attest     --key FILE --tenant-key-pub FILE --state STATE.json --nonce HEX --input CHECKS.json --out STMT.json
  log append --dir LOG --log-key FILE --tsa ... --envelope STMT.json
  checkpoint --dir LOG --log-key FILE [--keep DIR]  sign a checkpoint (and keep a copy, as the firm's app does)
  witness cosign --log-public LOG/public --log-vkey VKEY --key FILE --state FILE [--apply LOG]
  prove inclusion   --log-public DIR --index N
  prove consistency --log-public DIR --from M

Proof Packs
  trust      --dir LOG --witness-key-pub FILE... --tsa-pub NAME=FILE... --quorum N --out TRUST.json
  pack       --dir LOG --trust TRUST.json --firm FIRM.json --from YYYY-MM-DD --to YYYY-MM-DD [--earlier FILE...] --out PACK.json
  verify     --pack PACK.json --trust TRUST.json [--json]      exit 0 only if every check passes

Demo and conformance
  demo generate --keys DIR --out DEMO_DIR [--create-keys] [--full-packs DIR]
  vectors       --out DIR                                     cross-language test vectors
  schema                                                      print the statement schema

Most commands accept --time 2026-10-01T14:00:00Z to fix the clock (for tests).
`

type multi []string

func (m *multi) String() string     { return strings.Join(*m, ",") }
func (m *multi) Set(v string) error { *m = append(*m, v); return nil }

func run(args []string, stdout, stderr io.Writer) int {
	if len(args) == 0 || args[0] == "help" || args[0] == "-h" || args[0] == "--help" {
		fmt.Fprintf(stdout, usage, brand.Product)
		return 0
	}
	cmd, rest := args[0], args[1:]
	if (cmd == "log" || cmd == "witness" || cmd == "prove" || cmd == "demo") && len(rest) > 0 {
		cmd, rest = cmd+" "+rest[0], rest[1:]
	}
	ctx, cancel := newContext()
	defer cancel()
	c := &cli{ctx: ctx, stdout: stdout, stderr: stderr, fs: flag.NewFlagSet(cmd, flag.ContinueOnError)}
	c.fs.SetOutput(stderr)
	h, ok := commands[cmd]
	if !ok {
		fmt.Fprintf(stderr, "unknown command %q (try proofctl help)\n", cmd)
		return 2
	}
	if err := h(c, rest); err != nil {
		var ve verifyFailed
		if errors.As(err, &ve) {
			return 1
		}
		fmt.Fprintf(stderr, "proofctl %s: %v\n", cmd, err)
		return 1
	}
	return 0
}

type verifyFailed struct{}

func (verifyFailed) Error() string { return "verification failed" }

type cli struct {
	ctx            context.Context
	stdout, stderr io.Writer
	fs             *flag.FlagSet
	timeFlag       *string
}

func (c *cli) parse(args []string) error {
	c.timeFlag = c.fs.String("time", "", "fixed clock (RFC 3339 UTC), for tests")
	return c.fs.Parse(args)
}

func (c *cli) now() (time.Time, error) {
	if *c.timeFlag == "" {
		return time.Now().UTC().Truncate(time.Second), nil
	}
	return tsa.ParseTime(*c.timeFlag)
}

func (c *cli) clock() func() time.Time {
	t, err := c.now()
	if err != nil {
		t = time.Now().UTC()
	}
	return func() time.Time { return t }
}

func required(vals map[string]string) error {
	for k, v := range vals {
		if v == "" {
			return fmt.Errorf("--%s is required", k)
		}
	}
	return nil
}

var commands = map[string]func(*cli, []string) error{
	"keygen":            cmdKeygen,
	"log init":          cmdLogInit,
	"tenant":            cmdTenant,
	"enroll":            cmdEnroll,
	"challenge":         cmdChallenge,
	"attest":            cmdAttest,
	"log append":        cmdAppend,
	"checkpoint":        cmdCheckpoint,
	"witness cosign":    cmdCosign,
	"prove inclusion":   cmdProveInclusion,
	"prove consistency": cmdProveConsistency,
	"trust":             cmdTrust,
	"pack":              cmdPack,
	"verify":            cmdVerify,
	"demo generate":     cmdDemo,
	"vectors":           cmdVectors,
	"schema":            cmdSchema,
}

func cmdKeygen(c *cli, args []string) error {
	alg := c.fs.String("alg", string(sigs.ES256), "ecdsa-p256-sha256 or ed25519")
	role := c.fs.String("role", "", "device, tenant, connector, staff, log, witness or tsa")
	name := c.fs.String("name", "", "key name (for log/witness keys, a schema-less URL like witness.example)")
	out := c.fs.String("out", "", "private key file to write")
	if err := c.parse(args); err != nil {
		return err
	}
	if err := required(map[string]string{"role": *role, "name": *name, "out": *out}); err != nil {
		return err
	}
	kf, err := keys.Generate(sigs.Alg(*alg), *role, *name)
	if err != nil {
		return err
	}
	if err := kf.Save(*out); err != nil {
		return err
	}
	pf, _ := kf.PublicFile()
	pubPath := strings.TrimSuffix(*out, ".json") + ".pub.json"
	if err := pf.Save(pubPath); err != nil {
		return err
	}
	fmt.Fprintf(c.stdout, "wrote %s (private, software key) and %s\nkeyid %s\n", *out, pubPath, pf.KeyID)
	return nil
}

func loadEd25519(path string) (ed25519.PrivateKey, *keys.KeyFile, error) {
	kf, err := keys.Load(path)
	if err != nil {
		return nil, nil, err
	}
	cs, err := kf.CryptoSigner()
	if err != nil {
		return nil, nil, err
	}
	k, ok := cs.(ed25519.PrivateKey)
	if !ok {
		return nil, nil, fmt.Errorf("%s is not an Ed25519 key", path)
	}
	return k, kf, nil
}

func cmdLogInit(c *cli, args []string) error {
	dir := c.fs.String("dir", "", "log directory")
	keyPath := c.fs.String("log-key", "", "log private key (Ed25519)")
	origin := c.fs.String("origin", brand.DemoLogOrigin, "log origin")
	if err := c.parse(args); err != nil {
		return err
	}
	if err := required(map[string]string{"dir": *dir, "log-key": *keyPath}); err != nil {
		return err
	}
	k, _, err := loadEd25519(*keyPath)
	if err != nil {
		return err
	}
	if _, err := os.Stat(filepath.Join(*dir, "log.json")); err == nil {
		return errors.New("a log already exists in " + *dir)
	}
	l, err := tlog.NewLog(*origin, k, c.clock())
	if err != nil {
		return err
	}
	if err := tlog.NewServer(l, nil, c.clock(), rand.Reader).Save(*dir); err != nil {
		return err
	}
	fmt.Fprintf(c.stdout, "log %s created in %s\nvkey %s\n", *origin, *dir, l.VKey())
	return nil
}

// server flags shared by commands that run the ingest server.
type serverFlags struct {
	dir, logKey *string
	tsas        multi
}

func (c *cli) serverFlags(needKey bool) *serverFlags {
	f := &serverFlags{dir: c.fs.String("dir", "", "log directory")}
	if needKey {
		f.logKey = c.fs.String("log-key", "", "log private key")
		c.fs.Var(&f.tsas, "tsa", "NAME=KEYFILE of a simulated timestamp authority (give two)")
	}
	return f
}

func (c *cli) openServer(f *serverFlags) (*tlog.Server, error) {
	if *f.dir == "" {
		return nil, errors.New("--dir is required")
	}
	var logKey ed25519.PrivateKey
	if f.logKey != nil && *f.logKey != "" {
		k, _, err := loadEd25519(*f.logKey)
		if err != nil {
			return nil, err
		}
		logKey = k
	}
	clock := c.clock()
	var authorities []tsa.Authority
	for _, spec := range f.tsas {
		name, path, ok := strings.Cut(spec, "=")
		if !ok {
			return nil, fmt.Errorf("--tsa wants NAME=KEYFILE, got %q", spec)
		}
		s, err := keys.LoadSigner(path)
		if err != nil {
			return nil, err
		}
		a, err := tsa.NewSimulated(name, s, clock, 0)
		if err != nil {
			return nil, err
		}
		authorities = append(authorities, a)
	}
	return tlog.Load(*f.dir, logKey, authorities, clock, rand.Reader)
}

type firmFile struct {
	TenantID    string `json:"tenant_id"`
	DisplayName string `json:"display_name"`
	Salt        string `json:"display_name_salt"`
}

func cmdTenant(c *cli, args []string) error {
	sf := c.serverFlags(true)
	tenantKey := c.fs.String("tenant-key", "", "the firm's private key (kept by the owner)")
	name := c.fs.String("name", "", "the firm's display name (never logged; only a salted commitment is)")
	out := c.fs.String("out", "", "file to save the firm's ID, name and salt")
	if err := c.parse(args); err != nil {
		return err
	}
	if err := required(map[string]string{"tenant-key": *tenantKey, "name": *name, "out": *out}); err != nil {
		return err
	}
	s, err := c.openServer(sf)
	if err != nil {
		return err
	}
	ts, err := keys.LoadSigner(*tenantKey)
	if err != nil {
		return err
	}
	now, _ := c.now()
	var saltB [32]byte
	_, _ = rand.Read(saltB[:])
	saltHex := hex.EncodeToString(saltB[:])
	id := posture.TenantID(ts.Public())
	nonce, err := s.IssueNonce(id)
	if err != nil {
		return err
	}
	salt, _ := posture.NewSalt()
	payload, err := posture.BuildTenantGenesis(ts.Public(), pack.NameCommitment(*name, saltHex), now, nonce, salt)
	if err != nil {
		return err
	}
	env, err := posture.Sign(payload, ts)
	if err != nil {
		return err
	}
	ev, err := s.Submit(c.ctx, env)
	if err != nil {
		return err
	}
	if err := s.Save(*sf.dir); err != nil {
		return err
	}
	if err := writeJSON(*out, firmFile{TenantID: id, DisplayName: *name, Salt: saltHex}, 0o600); err != nil {
		return err
	}
	fmt.Fprintf(c.stdout, "firm %s enrolled at log index %d\n", id, ev.Index)
	return nil
}

type stateFile struct {
	Attester string `json:"attester"`
	Kind     string `json:"kind"`
	Tenant   string `json:"tenant"`
	Seq      uint32 `json:"seq"`
	Prev     string `json:"prev"`
}

func cmdEnroll(c *cli, args []string) error {
	sf := c.serverFlags(true)
	tenantKey := c.fs.String("tenant-key", "", "the firm's private key (approves the enrollment)")
	keyPath := c.fs.String("key", "", "the attester's private key (proves possession)")
	kind := c.fs.String("kind", "device_agent", "device_agent, cloud_connector or staff_attester")
	class := c.fs.String("class", "laptop", "laptop, desktop or server (devices)")
	platform := c.fs.String("platform", "windows", "windows, macos, microsoft_365 or mobile_app")
	number := c.fs.Uint("number", 0, "device number shown as D01, D02... (never a host name)")
	role := c.fs.String("role", "none", "staff role for staff attesters")
	state := c.fs.String("state", "", "attester state file to create")
	if err := c.parse(args); err != nil {
		return err
	}
	if err := required(map[string]string{"tenant-key": *tenantKey, "key": *keyPath, "state": *state}); err != nil {
		return err
	}
	s, err := c.openServer(sf)
	if err != nil {
		return err
	}
	ts, err := keys.LoadSigner(*tenantKey)
	if err != nil {
		return err
	}
	as, err := keys.LoadSigner(*keyPath)
	if err != nil {
		return err
	}
	info := posture.EnrollmentInfo{Kind: posture.AttesterKind(*kind), KeyProtection: "software", KeyAttestation: "none",
		Method: "enrollment_code", DeviceClass: posture.DeviceClass(*class), Platform: posture.Platform(*platform),
		DeviceNumber: uint16(*number), StaffRole: posture.StaffRole(*role)}
	if info.Kind != posture.DeviceAgent {
		info.DeviceClass, info.DeviceNumber, info.Method = "not_a_device", 0, "owner_approval"
	}
	id := posture.AttesterID(info.Kind, as.Public())
	nonce, err := s.IssueNonce(id)
	if err != nil {
		return err
	}
	now, _ := c.now()
	salt, _ := posture.NewSalt()
	payload, err := posture.BuildAttesterEnrollment(ts.Public(), as.Public(), info, now, nonce, salt)
	if err != nil {
		return err
	}
	env, err := posture.Sign(payload, ts, as)
	if err != nil {
		return err
	}
	ev, err := s.Submit(c.ctx, env)
	if err != nil {
		return err
	}
	if err := s.Save(*sf.dir); err != nil {
		return err
	}
	d := posture.PayloadDigest(payload)
	if err := writeJSON(*state, stateFile{Attester: id, Kind: *kind, Tenant: posture.TenantID(ts.Public()), Prev: hex.EncodeToString(d[:])}, 0o600); err != nil {
		return err
	}
	fmt.Fprintf(c.stdout, "%s enrolled at log index %d (key strength: software)\n", id, ev.Index)
	return nil
}

func cmdChallenge(c *cli, args []string) error {
	sf := c.serverFlags(false)
	subject := c.fs.String("subject", "", "attester ID the nonce is for")
	if err := c.parse(args); err != nil {
		return err
	}
	if err := required(map[string]string{"subject": *subject}); err != nil {
		return err
	}
	s, err := c.openServer(sf)
	if err != nil {
		return err
	}
	n, err := s.IssueNonce(*subject)
	if err != nil {
		return err
	}
	if err := s.Save(*sf.dir); err != nil {
		return err
	}
	fmt.Fprintln(c.stdout, hex.EncodeToString(n[:]))
	return nil
}

func cmdAttest(c *cli, args []string) error {
	keyPath := c.fs.String("key", "", "attester private key")
	tenantPub := c.fs.String("tenant-key-pub", "", "the firm's public key file")
	statePath := c.fs.String("state", "", "attester state file (sequence and previous hash)")
	nonceHex := c.fs.String("nonce", "", "server challenge from 'proofctl challenge'")
	input := c.fs.String("input", "", `checks JSON: {"device": {...}} or {"tenant_posture": {...}} or {"staff_event": {...}}`)
	out := c.fs.String("out", "", "envelope file to write")
	if err := c.parse(args); err != nil {
		return err
	}
	if err := required(map[string]string{"key": *keyPath, "tenant-key-pub": *tenantPub, "state": *statePath, "nonce": *nonceHex, "input": *input, "out": *out}); err != nil {
		return err
	}
	signer, err := keys.LoadSigner(*keyPath)
	if err != nil {
		return err
	}
	pf, err := keys.LoadPublic(*tenantPub)
	if err != nil {
		return err
	}
	tk, err := sigs.ParsePublicKeyBase64(pf.PublicKey)
	if err != nil {
		return err
	}
	var st stateFile
	if err := readJSON(*statePath, &st); err != nil {
		return err
	}
	raw, err := os.ReadFile(*input)
	if err != nil {
		return err
	}
	v, err := canon.ParseContainer(raw)
	if err != nil {
		return fmt.Errorf("input: %w", err)
	}
	in, ok := v.(map[string]any)
	if !ok || len(in) != 1 {
		return errors.New(`input must be an object with exactly one of "device", "tenant_posture" or "staff_event"`)
	}
	var h posture.Header
	h.TenantKey, h.Attester, h.Kind = tk, signer.Public(), posture.AttesterKind(st.Kind)
	h.Seq = st.Seq + 1
	if err := decodeHex(st.Prev, h.Prev[:]); err != nil {
		return fmt.Errorf("state prev: %w", err)
	}
	if err := decodeHex(*nonceHex, h.Nonce[:]); err != nil {
		return fmt.Errorf("nonce: %w", err)
	}
	if h.Salt, err = posture.NewSalt(); err != nil {
		return err
	}
	if h.ObservedAt, err = c.now(); err != nil {
		return err
	}
	var payload []byte
	switch {
	case in["device"] != nil:
		obj, _ := in["device"].(map[string]any)
		d, err := posture.DecodeDeviceChecks(obj)
		if err != nil {
			return err
		}
		payload, err = posture.BuildDevice(h, d)
		if err != nil {
			return err
		}
	case in["tenant_posture"] != nil:
		obj, _ := in["tenant_posture"].(map[string]any)
		t, err := posture.DecodeTenantPosture(obj)
		if err != nil {
			return err
		}
		if payload, err = posture.BuildTenantPosture(h, t); err != nil {
			return err
		}
	case in["staff_event"] != nil:
		obj, _ := in["staff_event"].(map[string]any)
		e, err := posture.DecodeStaffEvent(obj)
		if err != nil {
			return err
		}
		if payload, err = posture.BuildStaffEvent(h, e); err != nil {
			return err
		}
	default:
		return errors.New(`input must contain "device", "tenant_posture" or "staff_event"`)
	}
	env, err := posture.Sign(payload, signer)
	if err != nil {
		return err
	}
	if err := os.WriteFile(*out, append(env.Canonical(), '\n'), 0o644); err != nil {
		return err
	}
	// The sequence number is spent once signed, even if the upload fails;
	// re-using it would look like equivocation.
	d := posture.PayloadDigest(payload)
	st.Seq, st.Prev = h.Seq, hex.EncodeToString(d[:])
	if err := writeJSON(*statePath, st, 0o600); err != nil {
		return err
	}
	fmt.Fprintf(c.stdout, "signed report #%d for %s -> %s\n", h.Seq, st.Attester, *out)
	return nil
}

func cmdAppend(c *cli, args []string) error {
	sf := c.serverFlags(true)
	envPath := c.fs.String("envelope", "", "signed statement from 'proofctl attest'")
	if err := c.parse(args); err != nil {
		return err
	}
	if err := required(map[string]string{"envelope": *envPath}); err != nil {
		return err
	}
	s, err := c.openServer(sf)
	if err != nil {
		return err
	}
	b, err := os.ReadFile(*envPath)
	if err != nil {
		return err
	}
	env, err := dsse.Parse([]byte(strings.TrimSuffix(string(b), "\n")))
	if err != nil {
		return err
	}
	ev, err := s.Submit(c.ctx, env)
	if err != nil {
		return fmt.Errorf("rejected: %w", err)
	}
	if err := s.Save(*sf.dir); err != nil {
		return err
	}
	d := tlog.EntryDigest(env)
	fmt.Fprintf(c.stdout, "appended at index %d; public leaf (commitment) %s\n", ev.Index, hex.EncodeToString(d[:]))
	return nil
}

func cmdCheckpoint(c *cli, args []string) error {
	sf := c.serverFlags(true)
	keep := c.fs.String("keep", "", "also save a copy here (the firm's app keeps checkpoints)")
	if err := c.parse(args); err != nil {
		return err
	}
	s, err := c.openServer(sf)
	if err != nil {
		return err
	}
	signed, err := s.Log.SignCheckpoint()
	if err != nil {
		return err
	}
	if err := s.Save(*sf.dir); err != nil {
		return err
	}
	if *keep != "" {
		if err := os.MkdirAll(*keep, 0o755); err != nil {
			return err
		}
		if err := os.WriteFile(filepath.Join(*keep, fmt.Sprintf("checkpoint-%d.txt", s.Log.Size())), []byte(signed), 0o644); err != nil {
			return err
		}
	}
	fmt.Fprint(c.stdout, signed)
	return nil
}

func cmdCosign(c *cli, args []string) error {
	pub := c.fs.String("log-public", "", "the log's published directory (checkpoint and tiles)")
	vkey := c.fs.String("log-vkey", "", "the log's verifier key (or @LOG/log.json)")
	keyPath := c.fs.String("key", "", "witness private key (Ed25519; its name is the witness name)")
	statePath := c.fs.String("state", "", "witness state file")
	apply := c.fs.String("apply", "", "log directory to attach the cosignature to")
	if err := c.parse(args); err != nil {
		return err
	}
	if err := required(map[string]string{"log-public": *pub, "log-vkey": *vkey, "key": *keyPath, "state": *statePath}); err != nil {
		return err
	}
	if strings.HasPrefix(*vkey, "@") {
		var cfg struct {
			VKey string `json:"vkey"`
		}
		if err := readJSON((*vkey)[1:], &cfg); err != nil {
			return err
		}
		*vkey = cfg.VKey
	}
	k, kf, err := loadEd25519(*keyPath)
	if err != nil {
		return err
	}
	w, err := witness.New(kf.Name, k, c.clock())
	if err != nil {
		return err
	}
	if err := w.LoadState(*statePath); err != nil {
		return err
	}
	pt, err := tlog.ReadPublic(*pub)
	if err != nil {
		return err
	}
	vk, err := note.ParseVKey(*vkey)
	if err != nil {
		return err
	}
	var proof []merkle.Hash
	if seen, ok := w.Seen[vk.Name]; ok && seen.Size <= pt.Size {
		if proof, err = pt.Tree.ConsistencyProof(seen.Size, pt.Size); err != nil {
			return err
		}
	}
	line, err := w.Cosign(pt.Checkpoint, *vkey, proof)
	if err != nil {
		return err
	}
	if err := w.SaveState(*statePath); err != nil {
		return err
	}
	if *apply != "" {
		s, err := tlog.Load(*apply, nil, nil, c.clock(), rand.Reader)
		if err != nil {
			return err
		}
		s.Log.AddCosignature(line)
		if err := s.Save(*apply); err != nil {
			return err
		}
	}
	fmt.Fprintln(c.stdout, line.Line)
	return nil
}

func cmdProveInclusion(c *cli, args []string) error {
	pub := c.fs.String("log-public", "", "published log directory")
	index := c.fs.Uint64("index", 0, "leaf index")
	if err := c.parse(args); err != nil {
		return err
	}
	pt, err := tlog.ReadPublic(*pub)
	if err != nil {
		return err
	}
	proof, err := pt.Tree.InclusionProof(*index, pt.Size)
	if err != nil {
		return err
	}
	return printJSON(c.stdout, map[string]any{"index": *index, "tree_size": pt.Size,
		"leaf_hash": b64(pt.Tree.LeafHashAt(*index)), "inclusion_proof": hashes(proof)})
}

func cmdProveConsistency(c *cli, args []string) error {
	pub := c.fs.String("log-public", "", "published log directory")
	from := c.fs.Uint64("from", 0, "earlier tree size")
	if err := c.parse(args); err != nil {
		return err
	}
	pt, err := tlog.ReadPublic(*pub)
	if err != nil {
		return err
	}
	proof, err := pt.Tree.ConsistencyProof(*from, pt.Size)
	if err != nil {
		return err
	}
	return printJSON(c.stdout, map[string]any{"from": *from, "to": pt.Size, "consistency_proof": hashes(proof)})
}

func cmdTrust(c *cli, args []string) error {
	dir := c.fs.String("dir", "", "log directory (for its origin and key)")
	var wpubs, tpubs multi
	c.fs.Var(&wpubs, "witness-key-pub", "witness public key file (repeat)")
	c.fs.Var(&tpubs, "tsa-pub", "NAME=PUBLIC_KEY_FILE of a timestamp authority (repeat)")
	quorum := c.fs.Int("quorum", 2, "witness cosignatures required")
	out := c.fs.String("out", "", "trust policy file to write")
	if err := c.parse(args); err != nil {
		return err
	}
	if err := required(map[string]string{"dir": *dir, "out": *out}); err != nil {
		return err
	}
	var cfg struct {
		Origin string `json:"origin"`
		VKey   string `json:"vkey"`
	}
	if err := readJSON(filepath.Join(*dir, "log.json"), &cfg); err != nil {
		return err
	}
	var ws, ts []pack.Party
	for _, p := range wpubs {
		pf, err := keys.LoadPublic(p)
		if err != nil {
			return err
		}
		pk, err := sigs.ParsePublicKeyBase64(pf.PublicKey)
		if err != nil {
			return err
		}
		raw, err := pk.Ed25519Raw()
		if err != nil {
			return err
		}
		ws = append(ws, pack.Party{Name: pf.Name, VKey: note.FormatVKey(pf.Name, note.TypeCosignature, raw), Label: pf.Name, Simulated: true})
	}
	for _, spec := range tpubs {
		name, path, ok := strings.Cut(spec, "=")
		if !ok {
			return fmt.Errorf("--tsa-pub wants NAME=FILE")
		}
		pf, err := keys.LoadPublic(path)
		if err != nil {
			return err
		}
		ts = append(ts, pack.Party{Name: name, Kind: tsa.KindSimulated, PublicKey: pf.PublicKey, Label: name + " (simulated)", Simulated: true})
	}
	t, err := pack.NewTrustPolicy(cfg.Origin, cfg.VKey, ws, *quorum, ts, true)
	if err != nil {
		return err
	}
	return os.WriteFile(*out, t.JSON(), 0o644)
}

func cmdPack(c *cli, args []string) error {
	dir := c.fs.String("dir", "", "log directory (the evidence store)")
	trustPath := c.fs.String("trust", "", "trust policy")
	firmPath := c.fs.String("firm", "", "firm file from 'proofctl tenant'")
	from := c.fs.String("from", "", "first day (YYYY-MM-DD)")
	to := c.fs.String("to", "", "last day (YYYY-MM-DD)")
	out := c.fs.String("out", "", "pack file to write")
	var earlier multi
	c.fs.Var(&earlier, "earlier", "an earlier checkpoint the firm kept (repeat)")
	if err := c.parse(args); err != nil {
		return err
	}
	if err := required(map[string]string{"dir": *dir, "trust": *trustPath, "firm": *firmPath, "from": *from, "to": *to, "out": *out}); err != nil {
		return err
	}
	s, err := tlog.Load(*dir, nil, nil, c.clock(), rand.Reader)
	if err != nil {
		return err
	}
	tb, err := os.ReadFile(*trustPath)
	if err != nil {
		return err
	}
	trust, err := pack.ParseTrustPolicy(tb)
	if err != nil {
		return err
	}
	var firm firmFile
	if err := readJSON(*firmPath, &firm); err != nil {
		return err
	}
	var notes []string
	for _, e := range earlier {
		b, err := os.ReadFile(e)
		if err != nil {
			return err
		}
		notes = append(notes, string(b))
	}
	now, _ := c.now()
	p, err := pack.Build(pack.ServerSource{S: s}, trust, pack.Request{TenantID: firm.TenantID, DisplayName: firm.DisplayName,
		DisplayNameSalt: firm.Salt, From: *from, To: *to, IssuedAt: now, Earlier: notes})
	if err != nil {
		return err
	}
	b, _ := p.MarshalJSON()
	if err := os.WriteFile(*out, b, 0o644); err != nil {
		return err
	}
	fmt.Fprintf(c.stdout, "wrote %s: %d entries\n", *out, len(p.Entries))
	return nil
}

func cmdVerify(c *cli, args []string) error {
	packPath := c.fs.String("pack", "", "Proof Pack file")
	trustPath := c.fs.String("trust", "", "trust policy file (pinned by the verifier, never taken from the pack)")
	asJSON := c.fs.Bool("json", false, "print a machine-readable report")
	if err := c.parse(args); err != nil {
		return err
	}
	if err := required(map[string]string{"pack": *packPath, "trust": *trustPath}); err != nil {
		return err
	}
	tb, err := os.ReadFile(*trustPath)
	if err != nil {
		return err
	}
	trust, err := pack.ParseTrustPolicy(tb)
	if err != nil {
		return err
	}
	pb, err := os.ReadFile(*packPath)
	if err != nil {
		return err
	}
	p, err := pack.Parse(pb)
	if err != nil {
		fmt.Fprintf(c.stdout, "NOT VERIFIED: this is not a valid Proof Pack (%v)\n", err)
		return verifyFailed{}
	}
	r := pack.Verify(p, trust)
	if *asJSON {
		c.stdout.Write(r.JSON())
	} else {
		fmt.Fprint(c.stdout, r.Text())
	}
	if !r.Verified {
		return verifyFailed{}
	}
	return nil
}

func cmdDemo(c *cli, args []string) error {
	keyDir := c.fs.String("keys", "", "demo key directory")
	out := c.fs.String("out", "", "demo directory to write data into")
	create := c.fs.Bool("create-keys", false, "create demo keys if the key directory is empty")
	full := c.fs.String("full-packs", "", "also write the attack worlds as full packs here")
	if err := c.parse(args); err != nil {
		return err
	}
	if err := required(map[string]string{"keys": *keyDir, "out": *out}); err != nil {
		return err
	}
	k, err := sample.LoadOrCreateKeys(*keyDir, *create)
	if err != nil {
		return err
	}
	o, err := sample.Generate(c.ctx, k)
	if err != nil {
		return err
	}
	if err := o.WriteDemo(*out); err != nil {
		return err
	}
	if *full != "" {
		if err := o.WriteFullPacks(*full); err != nil {
			return err
		}
	}
	r := pack.Verify(o.Pack, o.Genuine.Trust)
	fmt.Fprintf(c.stdout, "wrote demo data to %s: %d entries in the pack, log of %d entries, verified=%t\n",
		*out, len(o.Pack.Entries), o.Genuine.Server.Log.Size(), r.Verified)
	return nil
}

func cmdVectors(c *cli, args []string) error {
	out := c.fs.String("out", "", "directory for the vector files")
	if err := c.parse(args); err != nil {
		return err
	}
	if err := required(map[string]string{"out": *out}); err != nil {
		return err
	}
	files, err := vectors.Generate()
	if err != nil {
		return err
	}
	if err := os.MkdirAll(*out, 0o755); err != nil {
		return err
	}
	for name, b := range files {
		if err := os.WriteFile(filepath.Join(*out, name), b, 0o644); err != nil {
			return err
		}
	}
	fmt.Fprintf(c.stdout, "wrote %d vector files to %s\n", len(files), *out)
	return nil
}

func cmdSchema(c *cli, args []string) error {
	if err := c.parse(args); err != nil {
		return err
	}
	b, err := posture.SchemaJSON()
	if err != nil {
		return err
	}
	_, err = c.stdout.Write(append(b, '\n'))
	return err
}

func writeJSON(path string, v any, mode os.FileMode) error {
	b, err := json.MarshalIndent(v, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, append(b, '\n'), mode)
}

func readJSON(path string, v any) error {
	b, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	return json.Unmarshal(b, v)
}

func printJSON(w io.Writer, v any) error {
	b, err := json.MarshalIndent(v, "", "  ")
	if err != nil {
		return err
	}
	_, err = w.Write(append(b, '\n'))
	return err
}

func decodeHex(s string, dst []byte) error {
	b, err := hex.DecodeString(s)
	if err != nil || len(b) != len(dst) || hex.EncodeToString(b) != s {
		return fmt.Errorf("want %d lowercase hex bytes", len(dst))
	}
	copy(dst, b)
	return nil
}

func b64(h merkle.Hash) string { return base64.StdEncoding.EncodeToString(h[:]) }

func hashes(hs []merkle.Hash) []string {
	out := make([]string, len(hs))
	for i, h := range hs {
		out[i] = b64(h)
	}
	return out
}
