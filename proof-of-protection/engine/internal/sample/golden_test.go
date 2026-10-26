package sample

import (
	"bytes"
	"os"
	"path/filepath"
	"testing"
)

// demoDir is the demo folder next to the engine (relative, so the parent
// folder can be renamed).
const demoDir = "../../../demo"

// The committed demo data must be exactly what the generator produces from
// the committed demo keys.
func TestCommittedDemoDataIsReproducible(t *testing.T) {
	k, err := LoadKeys(filepath.Join(demoDir, "demo-keys"))
	if err != nil {
		t.Skipf("demo keys not present: %v", err)
	}
	o, err := Generate(ctx, k)
	if err != nil {
		t.Fatal(err)
	}
	tmp := t.TempDir()
	if err := o.WriteDemo(tmp); err != nil {
		t.Fatal(err)
	}
	for _, rel := range []string{"data/pack.json", "data/trust-policy.json", "data/scenarios.json", "data/demo-data.js",
		"data/public-log/checkpoint", "verifier/schema.js", "brand.js"} {
		want, _ := os.ReadFile(filepath.Join(tmp, rel))
		got, err := os.ReadFile(filepath.Join(demoDir, rel))
		if err != nil || !bytes.Equal(got, want) {
			t.Errorf("%s is stale; run: go run ./cmd/proofctl demo generate --keys ../demo/demo-keys --out ../demo", rel)
		}
	}
}

// Every compact scenario expands to exactly the pack the attack world built.
func TestScenariosExpandToTheirPacks(t *testing.T) {
	k, err := GenerateKeys()
	if err != nil {
		t.Fatal(err)
	}
	o, err := Generate(ctx, k)
	if err != nil {
		t.Fatal(err)
	}
	for _, sc := range o.Scenarios {
		p, err := Expand(o.Pack, sc)
		if err != nil {
			t.Fatal(err)
		}
		got, _ := p.MarshalJSON()
		want, _ := o.Alt[sc.ID].MarshalJSON()
		if !bytes.Equal(got, want) {
			t.Errorf("%s: expanded pack differs from the attack world's pack", sc.ID)
		}
	}
}
