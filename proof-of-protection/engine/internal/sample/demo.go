package sample

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"proofengine/brand"
	"proofengine/canon"
	"proofengine/merkle"
	"proofengine/note"
	"proofengine/pack"
	"proofengine/posture"
	"proofengine/tlog"
)

// Scenario is an attack world in compact form: the public log's digests,
// the checkpoints, and the pack's entries (most of which are identical to
// the genuine pack's and stored as references). The demo page rebuilds the
// full pack, including every Merkle proof, from this.
type Scenario struct {
	ID         string
	Digests    []merkle.Hash
	Checkpoint string
	Earlier    []string
	Entries    []ScenarioEntry
	Summary    any
}

// ScenarioEntry is a pack entry by reference (Ref >= 0, a position in the
// genuine pack) or inline.
type ScenarioEntry struct {
	Index    uint64
	Ref      int
	Evidence *tlog.Evidence
}

func evidenceKey(ev *tlog.Evidence) string {
	v := ev.Value()
	delete(v, "index")
	return string(canon.MustEncode(v))
}

// Compact turns an attack-world pack into a Scenario relative to the
// genuine pack.
func Compact(id string, genuine *pack.Pack, alt *pack.Pack, digests []merkle.Hash) Scenario {
	pos := map[string]int{}
	for i, e := range genuine.Entries {
		pos[evidenceKey(e.Evidence)] = i
	}
	sc := Scenario{ID: id, Digests: digests, Checkpoint: alt.Checkpoint, Summary: alt.Summary}
	for _, e := range alt.Earlier {
		sc.Earlier = append(sc.Earlier, e.Checkpoint)
	}
	for _, e := range alt.Entries {
		se := ScenarioEntry{Index: e.Evidence.Index, Ref: -1}
		if i, ok := pos[evidenceKey(e.Evidence)]; ok {
			se.Ref = i
		} else {
			se.Evidence = e.Evidence
		}
		sc.Entries = append(sc.Entries, se)
	}
	return sc
}

// Expand rebuilds the full pack from a Scenario, computing every proof
// from the digests exactly as the demo page does.
func Expand(genuine *pack.Pack, sc Scenario) (*pack.Pack, error) {
	tree := merkle.NewTree()
	for _, d := range sc.Digests {
		tree.Append(tlog.LeafHash(d))
	}
	size, err := cpSize(sc.Checkpoint)
	if err != nil {
		return nil, err
	}
	p := *genuine
	p.Checkpoint, p.Summary, p.Entries, p.Earlier = sc.Checkpoint, sc.Summary, nil, nil
	for _, e := range sc.Earlier {
		m, err := cpSize(e)
		if err != nil {
			return nil, err
		}
		proof, err := tree.ConsistencyProof(m, size)
		if err != nil {
			return nil, err
		}
		p.Earlier = append(p.Earlier, pack.EarlierCheckpoint{Checkpoint: e, Proof: proof})
	}
	for _, se := range sc.Entries {
		var ev tlog.Evidence
		if se.Ref >= 0 {
			ev = *genuine.Entries[se.Ref].Evidence
		} else {
			ev = *se.Evidence
		}
		ev.Index = se.Index
		proof, err := tree.InclusionProof(se.Index, size)
		if err != nil {
			return nil, err
		}
		p.Entries = append(p.Entries, pack.Entry{Evidence: &ev, Proof: proof})
	}
	return &p, nil
}

func cpSize(signed string) (uint64, error) {
	n, err := note.Parse(signed)
	if err != nil {
		return 0, err
	}
	cp, err := note.ParseCheckpoint(n.Text)
	return cp.Size, err
}

func (sc Scenario) value() map[string]any {
	var digests []byte
	for _, d := range sc.Digests {
		digests = append(digests, d[:]...)
	}
	earlier := []any{}
	for _, e := range sc.Earlier {
		earlier = append(earlier, e)
	}
	entries := []any{}
	for _, e := range sc.Entries {
		if e.Ref >= 0 {
			entries = append(entries, map[string]any{"index": int64(e.Index), "ref": int64(e.Ref)})
		} else {
			v := e.Evidence.Value()
			v["index"] = int64(e.Index)
			entries = append(entries, v)
		}
	}
	return map[string]any{
		"id": sc.ID, "log_digests": base64.StdEncoding.EncodeToString(digests),
		"checkpoint": sc.Checkpoint, "earlier_checkpoints": earlier, "entries": entries, "summary": sc.Summary,
	}
}

// Output is everything the demo page needs.
type Output struct {
	Genuine   *World
	Pack      *pack.Pack
	Scenarios []Scenario
	Alt       map[string]*pack.Pack // full attack-world packs, for tests
}

// Generate builds the genuine world and the three attack worlds.
func Generate(ctx context.Context, k *Keys) (*Output, error) {
	g, err := Build(ctx, k, Genuine)
	if err != nil {
		return nil, err
	}
	gp, err := g.Pack()
	if err != nil {
		return nil, err
	}
	out := &Output{Genuine: g, Pack: gp, Alt: map[string]*pack.Pack{}}
	for _, v := range []Variant{Backdate, Replay} {
		w, err := Build(ctx, k, v)
		if err != nil {
			return nil, err
		}
		p, err := w.Pack()
		if err != nil {
			return nil, err
		}
		out.Alt[string(v)] = p
		out.Scenarios = append(out.Scenarios, Compact(string(v), gp, p, w.Server.Log.Digests()))
	}
	fork, vp, err := g.VendorRewrite()
	if err != nil {
		return nil, err
	}
	out.Alt["vendor_rewrite"] = vp
	out.Scenarios = append(out.Scenarios, Compact("vendor_rewrite", gp, vp, fork.Log.Digests()))
	return out, nil
}

// WriteDemo writes the demo's data files under demoDir:
//
//	data/pack.json            the sample Proof Pack
//	data/trust-policy.json    the (demo) keys a verifier trusts
//	data/scenarios.json       the attack worlds, compact
//	data/demo-data.js         the same three files for file:// viewing
//	data/public-log/          the public log as tlog-tiles: digests only
//	verifier/schema.js        the statement schema, generated from Go
//	brand.js                  brand constants, generated from Go
func (o *Output) WriteDemo(demoDir string) error {
	data := filepath.Join(demoDir, "data")
	if err := os.MkdirAll(data, 0o755); err != nil {
		return err
	}
	packJSON, err := o.Pack.MarshalJSON()
	if err != nil {
		return err
	}
	trustJSON := o.Genuine.Trust.JSON()
	var scen []any
	for _, s := range o.Scenarios {
		scen = append(scen, s.value())
	}
	scenJSON := marshalLines(map[string]any{"format": "proof-demo-scenarios/v1", "scenarios": scen})
	files := map[string][]byte{"pack.json": packJSON, "trust-policy.json": trustJSON, "scenarios.json": scenJSON}
	for name, b := range files {
		if err := os.WriteFile(filepath.Join(data, name), b, 0o644); err != nil {
			return err
		}
	}
	var js bytes.Buffer
	js.WriteString("// Generated by `proofctl demo generate`. Do not edit.\n")
	js.WriteString("// The same data as pack.json, trust-policy.json and scenarios.json, for\n")
	js.WriteString("// opening the demo from file://, where fetch() of local files is blocked.\n")
	js.WriteString("window.PROOF_DEMO_DATA = {\n")
	fmt.Fprintf(&js, "\"pack.json\": %s,\n\"trust-policy.json\": %s,\n\"scenarios.json\": %s};\n",
		jsString(packJSON), jsString(trustJSON), jsString(scenJSON))
	if err := os.WriteFile(filepath.Join(data, "demo-data.js"), js.Bytes(), 0o644); err != nil {
		return err
	}
	pub := filepath.Join(data, "public-log")
	if err := os.RemoveAll(pub); err != nil {
		return err
	}
	if err := o.Genuine.Server.Log.WriteTiles(pub); err != nil {
		return err
	}
	if err := writeSchemaJS(filepath.Join(demoDir, "verifier", "schema.js")); err != nil {
		return err
	}
	return writeBrandJS(filepath.Join(demoDir, "brand.js"))
}

// jsString embeds JSON text as a JavaScript string literal, so the page
// parses it with the same strict parser it uses for fetched files.
func jsString(b []byte) string {
	s, _ := json.Marshal(string(b))
	return strings.ReplaceAll(string(s), "</", `<\/`)
}

func marshalLines(v map[string]any) []byte {
	var b bytes.Buffer
	enc := json.NewEncoder(&b)
	enc.SetEscapeHTML(false)
	enc.SetIndent("", " ")
	_ = enc.Encode(v)
	return b.Bytes()
}

func writeSchemaJS(path string) error {
	schema, err := posture.SchemaJSON()
	if err != nil {
		return err
	}
	steps, _ := json.Marshal(pack.Steps())
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	var b bytes.Buffer
	b.WriteString("// Generated by `proofctl demo generate` from engine/posture/schema.go.\n")
	b.WriteString("// Do not edit: change the Go schema and regenerate, so every verifier\n")
	b.WriteString("// enforces exactly the same content rules.\n")
	b.WriteString("window.ProofSchema = ")
	b.Write(schema)
	b.WriteString(";\nwindow.ProofSchema.steps = ")
	b.Write(steps)
	b.WriteString(";\n")
	return os.WriteFile(path, b.Bytes(), 0o644)
}

func writeBrandJS(path string) error {
	v := map[string]string{
		"name": brand.Name, "product": brand.Product,
		"predicatePosture": brand.PredicatePosture, "predicateEnrollment": brand.PredicateEnrollment,
		"logOrigin": brand.DemoLogOrigin,
	}
	b, _ := json.MarshalIndent(v, "", "  ")
	js := "// Generated by `proofctl demo generate` from engine/brand/brand.go.\n" +
		"// To rename the product, edit that file and regenerate.\n" +
		"window.BRAND = Object.freeze(" + string(b) + ");\n"
	return os.WriteFile(path, []byte(js), 0o644)
}

// WriteFullPacks writes the attack worlds as full packs (for checking that
// the browser and Go verifiers agree).
func (o *Output) WriteFullPacks(dir string) error {
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	for id, p := range o.Alt {
		b, err := p.MarshalJSON()
		if err != nil {
			return err
		}
		if err := os.WriteFile(filepath.Join(dir, id+".pack.json"), b, 0o644); err != nil {
			return err
		}
	}
	return nil
}

// LoadOrCreateKeys loads demo keys from dir, or creates them if dir has
// none (only when create is set).
func LoadOrCreateKeys(dir string, create bool) (*Keys, error) {
	k, err := LoadKeys(dir)
	if err == nil {
		return k, nil
	}
	if !create || !errors.Is(err, os.ErrNotExist) {
		return nil, err
	}
	if k, err = GenerateKeys(); err != nil {
		return nil, err
	}
	return k, k.Save(dir)
}
