package main

import (
	"bytes"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

type env struct {
	t   *testing.T
	dir string
}

func (e *env) p(name string) string { return filepath.Join(e.dir, name) }

func (e *env) run(want int, args ...string) string {
	e.t.Helper()
	var out, errb bytes.Buffer
	if code := run(args, &out, &errb); code != want {
		e.t.Fatalf("proofctl %s: exit %d (want %d)\n%s%s", strings.Join(args, " "), code, want, out.String(), errb.String())
	}
	return out.String() + errb.String()
}

const checks = `{"device": {"disk_encryption": "%s", "os_patch_status": "current", "firewall_on": true,
 "screen_lock_on": true, "screen_lock_max_idle_min": 10, "edr_running": true, "edr_kind": "defender",
 "local_admin_count": 1, "unapproved_remote_tools": {"items": [], "total": 0, "truncated": false},
 "heartbeat_interval_s": 300, "heartbeats_24h": 288 %s}}`

// The whole flow through the CLI: keys, log, enrollment, three days of
// reports, checkpoints, witnesses, a pack, and offline verification.
func TestEndToEnd(t *testing.T) {
	e := &env{t: t, dir: t.TempDir()}
	for _, k := range [][3]string{
		{"ed25519", "log", "example.com/cli-log"}, {"ed25519", "tsa", "tsa-a.example"}, {"ed25519", "tsa", "tsa-b.example"},
		{"ed25519", "witness", "witness-a.example"}, {"ed25519", "witness", "witness-b.example"},
		{"ecdsa-p256-sha256", "tenant", "firm"}, {"ecdsa-p256-sha256", "device", "laptop1"},
	} {
		e.run(0, "keygen", "--alg", k[0], "--role", k[1], "--name", k[2], "--out", e.p(strings.ReplaceAll(k[2], "/", "_")+".json"))
	}
	logd := e.p("log")
	tsas := []string{"--tsa", "tsa-a.example=" + e.p("tsa-a.example.json"), "--tsa", "tsa-b.example=" + e.p("tsa-b.example.json")}
	srv := func(cmd []string, at string, extra ...string) []string {
		args := append(append([]string{}, cmd...), "--dir", logd, "--log-key", e.p("example.com_cli-log.json"), "--time", at)
		return append(append(args, tsas...), extra...)
	}
	e.run(0, "log", "init", "--dir", logd, "--log-key", e.p("example.com_cli-log.json"), "--origin", "example.com/cli-log")
	e.run(0, srv([]string{"tenant"}, "2026-09-30T15:00:00Z", "--tenant-key", e.p("firm.json"), "--name", "Example Firm (test)", "--out", e.p("firm-id.json"))...)
	out := e.run(0, srv([]string{"enroll"}, "2026-09-30T15:10:00Z", "--tenant-key", e.p("firm.json"), "--key", e.p("laptop1.json"),
		"--kind", "device_agent", "--number", "1", "--state", e.p("laptop1.state"))...)
	devID := strings.Fields(out)[0]

	cosign := func(at string) {
		for _, w := range []string{"witness-a.example", "witness-b.example"} {
			e.run(0, "witness", "cosign", "--log-public", filepath.Join(logd, "public"), "--log-vkey", "@"+filepath.Join(logd, "log.json"),
				"--key", e.p(w+".json"), "--state", e.p(w+".state"), "--apply", logd, "--time", at)
		}
	}
	var day1 string
	for day := 1; day <= 3; day++ {
		at := fmt.Sprintf("2026-10-%02dT14:00:00Z", day)
		nonce := strings.TrimSpace(e.run(0, "challenge", "--dir", logd, "--subject", devID, "--time", at))
		in := e.p(fmt.Sprintf("checks%d.json", day))
		os.WriteFile(in, []byte(fmt.Sprintf(checks, "on", "")), 0o644)
		stmt := e.p(fmt.Sprintf("stmt%d.json", day))
		e.run(0, "attest", "--key", e.p("laptop1.json"), "--tenant-key-pub", e.p("firm.pub.json"), "--state", e.p("laptop1.state"),
			"--nonce", nonce, "--input", in, "--out", stmt, "--time", at)
		e.run(0, srv([]string{"log", "append"}, at, "--envelope", stmt)...)
		e.run(0, srv([]string{"checkpoint"}, fmt.Sprintf("2026-10-%02dT23:50:00Z", day), "--keep", e.p("kept"))...)
		cosign(fmt.Sprintf("2026-10-%02dT23:51:00Z", day))
		if day == 1 {
			day1 = stmt
		}
	}

	// Replaying day 1's report is refused by the ingest server.
	if !strings.Contains(e.run(1, srv([]string{"log", "append"}, "2026-10-03T15:00:00Z", "--envelope", day1)...), "replay") {
		t.Fatal("replay not refused")
	}
	// A collector that tries to report a host name is refused before signing.
	bad := e.p("bad.json")
	os.WriteFile(bad, []byte(fmt.Sprintf(checks, "on", `, "hostname": "MARIA-LAPTOP"`)), 0o644)
	nonce := strings.TrimSpace(e.run(0, "challenge", "--dir", logd, "--subject", devID, "--time", "2026-10-03T16:00:00Z"))
	if !strings.Contains(e.run(1, "attest", "--key", e.p("laptop1.json"), "--tenant-key-pub", e.p("firm.pub.json"), "--state", e.p("laptop1.state"),
		"--nonce", nonce, "--input", bad, "--out", e.p("bad.stmt"), "--time", "2026-10-03T16:00:00Z"), "not allowed") {
		t.Fatal("forbidden field not reported")
	}

	e.run(0, "trust", "--dir", logd, "--witness-key-pub", e.p("witness-a.example.pub.json"), "--witness-key-pub", e.p("witness-b.example.pub.json"),
		"--tsa-pub", "tsa-a.example="+e.p("tsa-a.example.pub.json"), "--tsa-pub", "tsa-b.example="+e.p("tsa-b.example.pub.json"),
		"--quorum", "2", "--out", e.p("trust.json"))
	kept, _ := filepath.Glob(filepath.Join(e.p("kept"), "*"))
	e.run(0, "pack", "--dir", logd, "--trust", e.p("trust.json"), "--firm", e.p("firm-id.json"), "--from", "2026-10-01", "--to", "2026-10-03",
		"--earlier", kept[0], "--out", e.p("pack.json"), "--time", "2026-10-04T06:00:00Z")
	out = e.run(0, "verify", "--pack", e.p("pack.json"), "--trust", e.p("trust.json"))
	if !strings.Contains(out, "RESULT: VERIFIED") || !strings.Contains(out, "Example Firm (test)") {
		t.Fatalf("unexpected report:\n%s", out)
	}

	// Tampering with the pack file makes verification fail (exit 1).
	b, _ := os.ReadFile(e.p("pack.json"))
	tampered := strings.Replace(string(b), `"days": 1`, `"days": 0`, 1)
	tampered = strings.Replace(tampered, `"gaps": [],`, `"gaps": [{"attester":"dev_0000000000000000","attester_kind":"device_agent","device_number":1,"from":"2026-10-02","to":"2026-10-02","days":1}],`, 1)
	if tampered == string(b) {
		t.Fatal("tamper did not apply")
	}
	os.WriteFile(e.p("tampered.json"), []byte(tampered), 0o644)
	if out := e.run(1, "verify", "--pack", e.p("tampered.json"), "--trust", e.p("trust.json")); !strings.Contains(out, "NOT VERIFIED") {
		t.Fatalf("tampered pack verified:\n%s", out)
	}
	// The public log directory holds only the checkpoint and tiles.
	pub, _ := filepath.Glob(filepath.Join(logd, "public", "*"))
	for _, f := range pub {
		if n := filepath.Base(f); n != "checkpoint" && n != "tile" {
			t.Errorf("unexpected public file %s", n)
		}
	}
}
