// The Proof Pack demo page: renders the pack as an owner-friendly summary,
// runs the in-browser verifier, and lets a visitor play the attacker.
// Data comes from data/*.json (or data/demo-data.js when opened from
// file://). Every element is built with DOM APIs; no data is ever parsed as
// HTML.
(function () {
  "use strict";
  const P = window.Proof, V = P.verifier, B = window.BRAND;
  const $ = (id) => document.getElementById(id);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function el(tag, attrs, ...kids) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === null || v === undefined || v === false) continue;
      if (k === "class") e.className = v;
      else if (k === "text") e.textContent = v;
      else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
      else e.setAttribute(k, v === true ? "" : v);
    }
    for (const kid of kids.flat()) if (kid !== null && kid !== undefined && kid !== false) e.append(kid);
    return e;
  }

  // ---------- plain-English copy ----------

  const STEP_WHAT = {
    signatures: "Every report is signed by the device or service that made it. Changing one character breaks the signature.",
    content: "Reports may hold only yes/no answers, counts, categories and times: never names, file paths or email content.",
    enrollment: "Every signing key was enrolled for this firm, and each enrollment is itself in the log.",
    sequence: "Each device numbers its reports and links each to the one before, so old reports can't be re-sent and missing ones show.",
    timestamps: "Two independent timestamp authorities confirm when each report was made, so nothing can be backdated.",
    inclusion: "A Merkle proof shows each report is in the append-only public log, which stores only fingerprints.",
    checkpoint: "The log's current state (its checkpoint) is signed by the log.",
    consistency: "A checkpoint the firm's app saved earlier is a prefix of today's log: nothing was removed or rewritten.",
    witnesses: "Independent witnesses countersigned the same log state, so the vendor can't show different histories to different people.",
    gaps: "Days a device didn't check in are shown, not hidden, and this page's summary matches the signed evidence.",
  };

  const SCENARIOS = [
    { id: "flip", who: "A firm insider edits the file", title: "Hide the bad day",
      what: "Change Laptop D07's Oct 14 report from \"encryption off, antivirus stopped\" to all-green.",
      why: "The laptop signed its report. Changing one word breaks that signature, the link from the next report, both timestamps and the log proof, and the summary no longer matches the evidence.",
      expect: ["signatures", "sequence", "timestamps", "inclusion", "gaps"] },
    { id: "delete", who: "A firm insider edits the file", title: "Delete the bad day",
      what: "Remove Laptop D07's Oct 14 report from the pack and tidy the summary to match.",
      why: "Every report carries the fingerprint of the one before it. Report #13 points back to a #12 that is no longer there.",
      expect: ["sequence"] },
    { id: "hide_gap", who: "A firm insider edits the file", title: "Hide the gap in the summary",
      what: "Edit the one-page summary so it shows no missed check-ins.",
      why: "The verifier recomputes the summary from the signed reports, finds two silent days for Laptop D07 and refuses the edited summary.",
      expect: ["gaps"] },
    { id: "replay", who: "An attacker on the laptop", title: "Replay an old all-green report",
      what: "With antivirus switched off, re-send Laptop D07's clean report from Oct 4 to keep the alert quiet.",
      why: "Each report uses a one-time server challenge and a sequence number, and both timestamp authorities saw this copy on Oct 14, not Oct 4.",
      expect: ["sequence", "timestamps"] },
    { id: "backdate", who: "An attacker on the laptop", title: "Backdate reports to fill the gap",
      what: "When the laptop comes back, forge clean reports dated Oct 12 and Oct 13.",
      why: "Two independent timestamp authorities saw them on Oct 14. Backdated reports don't count, so the gap stays visible.",
      expect: ["timestamps"] },
    { id: "vendor_rewrite", who: "We, the vendor, cheat", title: "Rewrite the log's history",
      what: "The vendor's own server deletes the bad report from the log and re-signs the log with its real key.",
      why: "The checkpoint the firm's app saved on Oct 20 no longer matches, the laptop's hash chain breaks, and the independent witnesses refuse to countersign. Nobody needs to trust us.",
      expect: ["sequence", "consistency", "witnesses"] },
  ];

  const STRENGTH = {
    hardware: ["Hardware key", "Signed by a key locked in the device's security chip."],
    platform: ["Platform-verified", "Read from Microsoft 365's own records."],
    scan_verified: ["Scan-verified", "Checked from outside by the scanner, against the firm's own domain."],
    staff_attested: ["Staff-attested", "A person's signed, time-stamped record."],
    software: ["Software key", "Signed by a software key on the device (prototype). Production Windows devices use a TPM-bound key."],
  };

  const SCAN_LABEL = {
    "EMAIL-01": "SPF record published", "EMAIL-02": "SPF is strict", "EMAIL-03": "DKIM signing", "EMAIL-04": "DMARC policy enforced",
    "EMAIL-05": "DMARC reports collected", "TLS-01": "Valid TLS certificate", "TLS-02": "Certificate not close to expiry",
    "TLS-03": "Modern TLS only", "HTTP-01": "HSTS enabled", "HTTP-02": "Security headers", "HTTP-03": "Clickjacking protection",
    "DNS-01": "DNSSEC", "BREACH-01": "No staff emails in new breaches", "BREACH-02": "No exposed passwords",
  };

  // ---------- state ----------

  const state = { genuine: null, scenarios: null, trust: null, current: null, scenario: null, running: false, cache: new Map(), report: null };

  // ---------- data loading ----------

  async function loadText(name) {
    try {
      const r = await fetch("data/" + name, { cache: "no-cache" });
      if (!r.ok) throw new Error("HTTP " + r.status);
      return await r.text();
    } catch (e) {
      // file:// pages cannot fetch local files; fall back to the bundled copy.
      if (!window.PROOF_DEMO_DATA) {
        await new Promise((resolve, reject) => {
          const s = el("script", { src: "data/demo-data.js" });
          s.onload = resolve;
          s.onerror = () => reject(new Error("could not load data/" + name));
          document.head.append(s);
        });
      }
      const text = window.PROOF_DEMO_DATA && window.PROOF_DEMO_DATA[name];
      if (typeof text !== "string") throw new Error("could not load data/" + name);
      return text;
    }
  }

  // ---------- model ----------

  const dayList = (from, to) => {
    const out = [];
    for (let t = Date.parse(from + "T00:00:00Z"); t <= Date.parse(to + "T00:00:00Z"); t += 86400000) out.push(new Date(t).toISOString().slice(0, 10));
    return out;
  };
  const dayLabel = (iso) => V.fmtDay(new Date(iso + "T00:00:00Z"));
  const span = (a, b) => (a === b ? dayLabel(a) : dayLabel(a) + " to " + dayLabel(b));

  function buildModel(value) {
    const pack = V.parsePack(value);
    const d = V.decode(pack);
    const days = dayList(pack.from, pack.to);
    const atts = Array.from(d.attesters.values()).filter((a) => a.it.st.str("tenant") === pack.tenantId);
    const order = { device_agent: 0, cloud_connector: 1, external_scanner: 2, staff_attester: 3 };
    atts.sort((a, b) => (order[a.kind] - order[b.kind]) || (a.number - b.number));
    const byAtt = new Map(atts.map((a) => [a.id, new Map()]));
    for (const it of d.items) {
      if (!it.posture || !byAtt.has(it.st.str("attester"))) continue;
      const day = V.isoDate(V.dateOf(it.st.time("observed_at")));
      const m = byAtt.get(it.st.str("attester"));
      if (!m.has(day)) m.set(day, []);
      m.get(day).push(it);
    }
    const series = (a) => days.map((day) => (byAtt.get(a.id).get(day) || []).slice(-1)[0] || null);
    const latest = (a) => { const s = series(a).filter(Boolean); return s[s.length - 1] || null; };
    // Gaps as the page shows them: an expected reporter with no report on a
    // day after it was enrolled. (Verification decides whether reports count.)
    const gaps = [];
    for (const a of atts) {
      if (a.kind === "staff_attester") continue;
      const enrolled = V.isoDate(V.dateOf(a.it.st.time("enrolled_at")));
      let run = null;
      for (const day of days) {
        if (day <= enrolled || byAtt.get(a.id).has(day)) { run = null; continue; }
        if (!run) { run = { a, from: day, to: day, days: 1 }; gaps.push(run); } else { run.to = day; run.days++; }
      }
    }
    return { value, pack, d, days, atts, byAtt, series, latest, gaps,
      devices: atts.filter((a) => a.kind === "device_agent"),
      connector: atts.find((a) => a.kind === "cloud_connector"),
      scanner: atts.find((a) => a.kind === "external_scanner"),
      staff: atts.find((a) => a.kind === "staff_attester") };
  }

  function cellState(a, it) {
    if (!it) return "gap";
    const checks = V.lapseChecks(it.st);
    if (checks.length) return "lapse";
    if (a.kind === "device_agent" && it.st.str("device.os_patch_status") === "updates_pending") return "warn";
    if (a.kind === "external_scanner") {
      const items = it.st.get("scan.results.items") || [];
      if (items.some((r) => r.status === "warn" || r.status === "error")) return "warn";
    }
    return "ok";
  }

  // incidents groups consecutive lapse days per attester and check.
  function incidents(m, a) {
    const out = [];
    let open = null;
    m.series(a).forEach((it, i) => {
      if (!it) return;
      const checks = V.lapseChecks(it.st);
      if (checks.length) {
        if (open && open.checks.join() === checks.join()) open.to = m.days[i];
        else { open = { a, checks, from: m.days[i], to: m.days[i], fixed: null }; out.push(open); }
      } else if (open) { open.fixed = m.days[i]; open = null; }
    });
    return out;
  }

  // ---------- rendering: hero ----------

  function renderHero(m) {
    const p = m.pack;
    $("firm-name").textContent = p.displayName;
    $("pack-period").textContent = "Proof Pack · " + spanLong(p.from, p.to) + " · issued " + V.fmtDay(new Date(p.issuedAt)) + ", " + p.issuedAt.slice(0, 4);
    const s = p.summary || {}, cov = s.coverage || {};
    const nGaps = Array.isArray(s.gaps) ? s.gaps.length : 0;
    const allInc = m.atts.flatMap((a) => incidents(m, a));
    const claimedLapses = Array.isArray(s.lapses) ? s.lapses.length : 0;
    const open = allInc.filter((x) => !x.fixed);
    let text;
    if (nGaps === 0 && claimedLapses === 0) text = "Every protection was on, every day, on every enrolled device and account.";
    else {
      const parts = [];
      const gapDays = s.gaps.reduce((n, g) => n + (Number.isSafeInteger(g.days) ? g.days : 0), 0);
      if (nGaps) parts.push(nGaps + " gap" + (nGaps === 1 ? "" : "s") + " in daily check-ins (" + gapDays + " day" + (gapDays === 1 ? "" : "s") + ")");
      if (claimedLapses) parts.push(allInc.length + " issue" + (allInc.length === 1 ? "" : "s"));
      text = (open.length === 0 ? "All protections are on at the end of the period. " : open.length + " issue(s) still open. ") +
        "During the month: " + parts.join(" and ") + (open.length === 0 && allInc.length ? ", all fixed." : ", disclosed below.");
    }
    $("headline").textContent = text;
    const chips = $("coverage-chips");
    chips.replaceChildren();
    const chip = (strong, rest, cls) => chips.append(el("li", { class: cls }, el("strong", { text: strong }), " " + rest));
    chip(cov.devices_enrolled + " of " + cov.devices_known, "known devices enrolled");
    chip(cov.accounts_mfa + " of " + cov.accounts_total, "accounts with MFA");
    chip(cov.accounts_passkey + " of " + cov.accounts_total, "with passkeys");
    if (m.scanner) {
      const l = m.latest(m.scanner);
      if (l) chip(String(l.st.int("scan.results.total")), "external checks daily");
    }
    chip(String(nGaps), "gap" + (nGaps === 1 ? "" : "s") + " disclosed");
  }

  function spanLong(from, to) {
    const f = new Date(from + "T00:00:00Z"), t = new Date(to + "T00:00:00Z");
    const month = (d) => ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"][d.getUTCMonth()];
    return month(f) + " " + f.getUTCDate() + " to " + (month(t) === month(f) ? "" : month(t) + " ") + t.getUTCDate() + ", " + t.getUTCFullYear();
  }

  // ---------- rendering: protections ----------

  function deviceLine(m, title, field, okWhen, okText) {
    const issues = m.devices.flatMap((a) => incidents(m, a)).filter((x) => x.checks.includes(field));
    const atEnd = m.devices.filter((a) => { const l = m.latest(a); return l && okWhen(l.st); }).length;
    let detail = okText(atEnd, m.devices.length);
    for (const x of issues) detail += " " + x.a.label + " was off " + span(x.from, x.to) + (x.fixed ? "; fixed " + dayLabel(x.fixed) + "." : "; still off.");
    return { title, detail, status: issues.length ? "warn" : "ok" };
  }

  function renderProtections(m) {
    const root = $("protections");
    root.replaceChildren();
    const group = (title, strength, lines) => {
      const g = el("div", { class: "prot-group" }, el("h3", { text: title }));
      for (const l of lines) {
        const [label, tip] = STRENGTH[l.strength || strength];
        g.append(el("div", { class: "prot" },
          el("span", { class: "mark " + l.status, "aria-label": l.status === "ok" ? "OK" : "Needs attention" }, l.status === "ok" ? "✓" : "⚠"),
          el("div", {}, el("div", { class: "prot-title", text: l.title }), el("div", { class: "prot-detail", text: l.detail })),
          el("span", { class: "badge s-" + (l.strength || strength), title: tip, text: label })));
      }
      root.append(g);
    };
    const n = m.devices.length;
    const dev = [
      deviceLine(m, "Disk encryption", "disk_encryption", (s) => s.str("device.disk_encryption") === "on", (k, n) => "On for " + k + " of " + n + " devices at the end of the period."),
      deviceLine(m, "Antivirus / EDR running", "edr_running", (s) => s.bool("device.edr_running"), (k, n) => "Running on " + k + " of " + n + " devices at the end of the period."),
      deviceLine(m, "Firewall", "firewall", (s) => s.bool("device.firewall_on"), (k, n) => "On for " + k + " of " + n + " devices."),
      deviceLine(m, "Screen lock", "screen_lock", (s) => s.bool("device.screen_lock_on"), (k, n) => {
        const mins = m.devices.map((a) => { const l = m.latest(a); return l ? l.st.int("device.screen_lock_max_idle_min") : 0; });
        return "On for " + k + " of " + n + " devices; locks after " + Math.min(...mins) + " to " + Math.max(...mins) + " idle minutes.";
      }),
    ];
    const pendingDays = m.devices.reduce((acc, a) => acc + m.series(a).filter((it) => it && it.st.str("device.os_patch_status") === "updates_pending").length, 0);
    const osLine = deviceLine(m, "Operating system updates", "os_patch", (s) => !["out_of_date", "unsupported_os"].includes(s.str("device.os_patch_status")),
      (k, n) => "Up to date on " + k + " of " + n + " devices." + (pendingDays ? " An update waited for a restart on " + pendingDays + " device-days, which is normal." : ""));
    dev.push(osLine);
    const admins = m.devices.map((a) => { const l = m.latest(a); return l ? l.st.int("device.local_admin_count") : 0; });
    dev.push({ title: "Local admin accounts", status: "ok", detail: "At most " + Math.max(...admins) + " per device; most have " + Math.min(...admins) + "." });
    dev.push(deviceLine(m, "Remote-control tools", "remote_tools", (s) => s.int("device.unapproved_remote_tools.total") === 0, () => "No remote-control tools found outside the approved list."));
    const devGaps = m.gaps.filter((g) => g.a.kind === "device_agent");
    dev.push({ title: "Daily check-ins", status: devGaps.length ? "warn" : "ok",
      detail: (n - new Set(devGaps.map((g) => g.a.id)).size) + " of " + n + " devices checked in every day." +
        devGaps.map((g) => " " + g.a.label + " missed " + span(g.from, g.to) + ".").join("") + " A missed check-in raises an alert." });
    group("Devices (" + n + ")", "software", dev);

    if (m.connector) {
      const ser = m.series(m.connector).filter(Boolean);
      const first = ser[0].st, last = ser[ser.length - 1].st;
      const mfaIssues = incidents(m, m.connector).filter((x) => x.checks.includes("mfa"));
      const alerts = ser.filter((it) => it.st.int("tenant_posture.mailbox_alerts_24h.total") > 0);
      const resolved = ser.find((it) => it.st.int("tenant_posture.mailbox_alerts_resolved_24h") > 0);
      const kinds = { forwarding_rule_external: "a new rule forwarding mail outside the firm", signin_unusual_country_approx: "a sign-in from an unusual country (approximate location)",
        new_auth_method: "a new sign-in method added", new_admin_role: "a new admin role", impossible_travel_approx: "sign-ins too far apart to be one person (approximate)" };
      const alertText = alerts.length === 0 ? "No warning signs of a hijacked mailbox." :
        alerts.map((it) => { const k = (it.st.get("tenant_posture.mailbox_alerts_24h.items") || [])[0]; return dayLabel(V.isoDate(it.st.time("observed_at"))) + ": " + (k ? kinds[k.kind] || k.kind : "alert"); }).join("; ") +
        (resolved && last.int("tenant_posture.mailbox_alerts_open") === 0 ? ". Resolved by " + dayLabel(V.isoDate(resolved.st.time("observed_at"))) + "." : ". Still open.");
      group("Accounts and email (Microsoft 365)", "platform", [
        { title: "Multi-factor sign-in (MFA)", status: mfaIssues.length ? "warn" : "ok", detail: last.int("tenant_posture.accounts_mfa") + " of " + last.int("tenant_posture.accounts_total") + " accounts" + (mfaIssues.length ? ", with gaps during the month." : ", every day.") },
        { title: "Phishing-resistant passkeys", status: last.int("tenant_posture.accounts_passkey") < last.int("tenant_posture.accounts_total") ? "warn" : "ok",
          detail: last.int("tenant_posture.accounts_passkey") + " of " + last.int("tenant_posture.accounts_total") + " accounts" + (first.int("tenant_posture.accounts_passkey") !== last.int("tenant_posture.accounts_passkey") ? ", up from " + first.int("tenant_posture.accounts_passkey") + " at the start of the month." : ".") },
        { title: "Admin accounts", status: "ok", detail: last.int("tenant_posture.admin_accounts") + " accounts can change settings for the whole firm." },
        { title: "Mailbox-takeover alerts", status: alerts.length ? "warn" : "ok", detail: alertText },
      ]);
    }
    if (m.scanner) {
      const ser = m.series(m.scanner).filter(Boolean);
      const last = ser[ser.length - 1].st;
      const changes = [];
      const lastStatus = new Map();
      for (const it of ser) {
        for (const r of it.st.get("scan.results.items") || []) {
          const prev = lastStatus.get(r.check_id);
          if (prev && prev !== r.status) changes.push((SCAN_LABEL[r.check_id] || r.check_id) + " went from " + prev + " to " + r.status + " on " + dayLabel(V.isoDate(it.st.time("observed_at"))));
          lastStatus.set(r.check_id, r.status);
        }
      }
      const firstWarn = (ser[0].st.get("scan.results.items") || []).filter((r) => r.status !== "pass");
      const failing = (last.get("scan.results.items") || []).filter((r) => r.status === "fail");
      group("From outside (the firm's own domain)", "scan_verified", [
        { title: "Email authentication, TLS and web security", status: firstWarn.length || failing.length ? "warn" : "ok",
          detail: last.int("scan.results.total") + " checks every night; " + (last.get("scan.results.items") || []).filter((r) => r.status === "pass").length + " pass now." +
            (changes.length ? " " + changes.join("; ") + "." : "") },
      ]);
    }
    if (m.staff) {
      const all = Array.from(m.byAtt.get(m.staff.id).values()).flat();
      const drills = all.filter((it) => it.st.str("staff_event.kind") === "backup_restore_drill");
      const pays = all.filter((it) => it.st.str("staff_event.kind") === "verify_before_pay");
      const sum = (k) => pays.reduce((acc, it) => acc + it.st.int("staff_event.verify_before_pay." + k), 0);
      const req = sum("requests"), cb = sum("callback_verified"), second = sum("second_approver"), blocked = sum("blocked");
      group("People and process", "staff_attested", [
        { title: "Backup restore drill", status: drills.length && drills.every((it) => it.st.str("staff_event.backup_restore_drill.result") === "success") ? "ok" : "warn",
          detail: drills.length ? drills.map((it) => { const s = it.st; return dayLabel(V.isoDate(s.time("staff_event.backup_restore_drill.performed_at"))) + ": " +
            s.int("staff_event.backup_restore_drill.files_restored") + " files restored in " + s.int("staff_event.backup_restore_drill.minutes_to_restore") + " minutes" +
            (s.bool("staff_event.backup_restore_drill.second_person_verified") ? ", checked by a second person." : "."); }).join(" ") : "No restore drill in this period." },
        { title: "Verify before you pay", status: cb < req ? "warn" : "ok",
          detail: req + " requests to change bank details or move money. " + (cb === req ? "Every one" : cb + " of " + req) + " was called back on the number on file" +
            (second === req ? " and approved by a second person." : ".") + (blocked ? " " + blocked + " turned out to be fraud and was blocked." : "") },
      ]);
    }
  }

  // ---------- rendering: timeline ----------

  function renderTimeline(m, invalid) {
    const root = $("timeline");
    root.replaceChildren();
    root.append(el("div", { class: "tl-label" }));
    m.days.forEach((day, i) => {
      const n = Number(day.slice(8));
      root.append(el("div", { class: "tl-day" + ([1, 8, 15, 22, 29].includes(n) || i === 0 ? "" : " minor"), "aria-hidden": "true", text: String(n) }));
    });
    const row = (a, label, short, kind) => {
      root.append(el("div", { class: "tl-label", title: a.label }, el("span", { class: "long", text: label }), el("span", { class: "short", text: short })));
      m.days.forEach((day) => {
        const its = m.byAtt.get(a.id).get(day) || [];
        const it = its[its.length - 1];
        let cls = "cell", text = "", title;
        if (kind === "events") {
          if (!its.length) { root.append(el("span", { class: "cell empty", "aria-hidden": "true" })); return; }
          const k = it.st.str("staff_event.kind");
          cls += " event";
          text = k === "backup_restore_drill" ? "◆" : it.st.int("staff_event.verify_before_pay.blocked") ? "⊘" : "●";
          title = dayLabel(day) + ": " + (k === "backup_restore_drill" ? "backup restore drill" : "verify-before-you-pay record");
        } else {
          const enrolled = V.isoDate(V.dateOf(a.it.st.time("enrolled_at")));
          if (day <= enrolled && !it) { root.append(el("span", { class: "cell empty", "aria-hidden": "true" })); return; }
          const st = cellState(a, it);
          cls += " " + st;
          title = a.label + ", " + dayLabel(day) + ": " + (st === "gap" ? "no check-in" : st === "lapse" ? V.lapseChecks(it.st).map((c) => V.CHECK_LABEL[c]).join(", ") : st === "warn" ? "minor warning" : "all protections on");
        }
        if (invalid && its.some((x) => invalid.has(x.index))) { cls += " invalid"; title += " (failed verification)"; }
        root.append(el("button", { type: "button", class: cls, title, "aria-label": title, "data-att": a.id, "data-day": day, onclick: (e) => showCell(m, a, day, e.currentTarget) }, text));
      });
    };
    root.append(el("div", { class: "tl-label group", text: "Devices" }));
    for (const a of m.devices) row(a, a.label.replace(/^(Laptop|Desktop|Server) (D\d+)$/, "$2 $1"), "D" + String(a.number).padStart(2, "0"), "device");
    root.append(el("div", { class: "tl-label group", text: "Services" }));
    if (m.connector) row(m.connector, "Microsoft 365", "M365", "svc");
    if (m.scanner) row(m.scanner, "External scan", "Scan", "svc");
    if (m.staff) { root.append(el("div", { class: "tl-label group", text: "People" })); row(m.staff, "Staff records", "Staff", "events"); }
  }

  function showCell(m, a, day, btn) {
    document.querySelectorAll(".cell.selected").forEach((c) => c.classList.remove("selected"));
    btn.classList.add("selected");
    const box = $("cell-detail");
    box.hidden = false;
    box.replaceChildren();
    const its = m.byAtt.get(a.id).get(day) || [];
    if (!its.length) {
      const before = m.series(a).slice(0, m.days.indexOf(day)).filter(Boolean).pop();
      const after = m.series(a).slice(m.days.indexOf(day) + 1).find(Boolean);
      let why = "";
      if (before && after) {
        const linked = after.st.int("seq") === before.st.int("seq") + 1;
        why = linked
          ? " Its next report (#" + after.st.int("seq") + ", " + dayLabel(V.isoDate(after.st.time("observed_at"))) + ") follows #" + before.st.int("seq") + " directly, so nothing was deleted: the device was silent."
          : " Its reports skip from #" + before.st.int("seq") + " to #" + after.st.int("seq") + ", so a report is missing from this pack.";
      }
      box.append(el("strong", { text: a.label + " · " + dayLabel(day) + " · no check-in" }),
        el("p", { text: "There is no report for this day." + why + " A missed check-in raises an alert, and every Proof Pack shows it as a gap." }));
      box.scrollIntoView({ block: "nearest", behavior: "smooth" });
      return;
    }
    for (const it of its) {
      const env = it.env;
      const lines = [
        ["Signed by", a.label + " (" + it.st.str("attester") + "), " + (env.signatures[0] ? "key " + env.signatures[0].keyid.slice(0, 16) + "…" : "no signature")],
        ["Report number", "#" + it.st.int("seq") + ", made " + V.fmtTime(it.st.time("observed_at"))],
        ["Log position", String(it.index)],
        ["Timestamps", it.e.timestamps.map((t) => (t.tst && t.tst.tsa) + " " + (t.tst && t.tst.gen_time)).join(", ")],
      ];
      box.append(el("strong", { text: a.label + " · " + dayLabel(day) + " · report #" + it.st.int("seq") }),
        el("dl", { class: "tech-grid" }, lines.flatMap(([k, v]) => [el("dt", { text: k }), el("dd", { text: v })])),
        el("p", { class: "section-sub", text: "The exact signed statement (decoded). Notice there are no names, host names or file paths, only yes/no answers, counts, categories and times. The salt keeps its public fingerprint unguessable." }),
        el("pre", { text: JSON.stringify(it.st.raw.predicate, null, 2) }));
      P.verifier.entryDigest(env).then((dg) => {
        box.append(el("p", { class: "section-sub" }, "Its fingerprint in the public log (all the public ever sees): ", el("code", { text: P.crypto.hex(dg) })));
      });
    }
    box.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }

  // ---------- rendering: events ----------

  function renderEvents(m) {
    const evs = [];
    const add = (day, cls, text) => evs.push({ day, cls, text });
    for (const g of m.gaps) add(g.from, "ev-warn", g.a.label + " missed " + g.days + " daily check-in" + (g.days === 1 ? "" : "s") + " (" + span(g.from, g.to) + "). A missed check-in raises an alert; the gap is disclosed, not hidden.");
    for (const a of m.atts) {
      for (const x of incidents(m, a)) {
        const what = x.checks.map((c) => V.CHECK_LABEL[c]).join(", ");
        add(x.from, "ev-bad", a.label + ": " + what + ".");
        if (x.fixed) add(x.fixed, "ev-good", a.label + ": fixed (" + x.checks.map((c) => V.CHECK_LABEL[c].replace(/ (off|not running|open|out of date|failed)$/, "")).join(", ") + " back to normal).");
      }
    }
    if (m.connector) {
      let prev = null;
      for (const it of m.series(m.connector)) {
        if (!it) continue;
        const pk = it.st.int("tenant_posture.accounts_passkey");
        if (prev !== null && pk !== prev) add(V.isoDate(it.st.time("observed_at")), "ev-good", "Passkeys rolled out: " + prev + " to " + pk + " of " + it.st.int("tenant_posture.accounts_total") + " accounts.");
        prev = pk;
      }
    }
    if (m.scanner) {
      const last = new Map();
      for (const it of m.series(m.scanner)) {
        if (!it) continue;
        for (const r of it.st.get("scan.results.items") || []) {
          const p = last.get(r.check_id);
          if (p && p !== r.status) add(V.isoDate(it.st.time("observed_at")), r.status === "pass" ? "ev-good" : "ev-warn", "External check \"" + (SCAN_LABEL[r.check_id] || r.check_id) + "\": " + p + " → " + r.status + ".");
          last.set(r.check_id, r.status);
        }
      }
    }
    if (m.staff) {
      for (const it of Array.from(m.byAtt.get(m.staff.id).values()).flat()) {
        const s = it.st, day = V.isoDate(s.time("observed_at"));
        if (s.str("staff_event.kind") === "backup_restore_drill") add(day, "ev-good", "Backup restore drill: " + s.int("staff_event.backup_restore_drill.files_restored") + " files restored in " + s.int("staff_event.backup_restore_drill.minutes_to_restore") + " minutes (" + s.str("staff_event.backup_restore_drill.result") + ").");
        else {
          const kinds = (s.get("staff_event.verify_before_pay.request_kinds.items") || []).map((k) => k.kind.replace(/_/g, " ")).join(" and ");
          const blocked = s.int("staff_event.verify_before_pay.blocked");
          add(day, blocked ? "ev-good" : "", "Verify before you pay: " + kinds + " request" + (s.int("staff_event.verify_before_pay.requests") > 1 ? "s" : "") + " called back on the number on file" + (blocked ? "; " + blocked + " was fraud and was blocked." : " and approved by a second person."));
        }
      }
    }
    evs.sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
    $("events").replaceChildren(...evs.map((e) => el("li", {}, el("time", { datetime: e.day, text: dayLabel(e.day) }), el("span", { class: e.cls, text: e.text }))));
  }

  // ---------- rendering: proves / doesn't ----------

  function renderProves(m) {
    const cov = (m.pack.summary && m.pack.summary.coverage) || {};
    const yes = [
      "Each report came from a device or service enrolled for this firm, and has not been changed since it was signed.",
      "When each report was made, confirmed by two independent clocks. Nothing was backdated.",
      "No report was removed, replayed or reordered. Days without a check-in are shown, not hidden.",
      "The log holding the reports was never rewritten: a checkpoint the firm saved earlier and independent witnesses agree.",
      cov.devices_enrolled + " of the " + cov.devices_known + " devices Microsoft 365 knows about are enrolled and reporting.",
    ];
    const no = [
      "That the firm cannot be breached. It shows which protections were measurably on, and when.",
      "Anything about devices that are not enrolled, or about days outside " + spanLong(m.pack.from, m.pack.to) + ".",
      "Staff-attested records (the restore drill, the call-backs) are a person's signed word, not a machine check.",
      "The firm's legal identity. The name is bound to the account when it signs up.",
      "In this prototype: device keys are software keys (production uses TPM 2.0 or Secure Enclave keys), and the timestamp authorities and witnesses are simulated.",
    ];
    $("proves-list").replaceChildren(...yes.map((t) => el("li", { text: t })));
    $("limits-list").replaceChildren(...no.map((t) => el("li", { text: t })));
  }

  // ---------- technical details ----------

  async function renderTech(m) {
    const root = $("tech");
    root.replaceChildren();
    const p = m.pack, t = state.trust;
    const cp = P.note.parseCheckpoint(P.note.parseNote(p.checkpoint).text);
    const dl = el("dl", { class: "tech-grid" });
    const row = (k, v) => dl.append(el("dt", { text: k }), el("dd", {}, v));
    row("Format", "proof-pack/v1, " + P.CANON_VERSION + "; in-toto Statement v1 in DSSE envelopes");
    row("Predicate types", el("code", { text: B.predicatePosture + ", " + B.predicateEnrollment }));
    row("Signatures", "ECDSA P-256 (IEEE P1363, low-S) for devices, the firm and staff; Ed25519 for the cloud connector, the scanner, the log and witnesses");
    row("Firm", p.displayName + " (" + p.tenantId + "); the name is a salted commitment in the enrollment record");
    row("Entries in this pack", String(p.entries.length) + ", out of " + cp.size + " in the shared public log");
    row("Log", el("code", { text: cp.origin }));
    row("Witnesses", t.witnesses.map((w) => w.label + (w.simulated ? " (simulated)" : "")).join("; ") + "; quorum " + t.witnessQuorum);
    row("Timestamp authorities", t.tsas.map((a) => a.label).join("; "));
    row("Trust roots", "Loaded from data/trust-policy.json, never from the pack. A production verifier pins them in its own code.");
    root.append(dl);
    root.append(el("h3", { text: "Latest checkpoint (C2SP signed note with witness cosignatures)" }), el("pre", { text: p.checkpoint }));
    if (p.earlier[0]) root.append(el("h3", { text: "Checkpoint the firm's app saved earlier" }), el("pre", { text: p.earlier[0].checkpoint }));
    const sample = [];
    for (const it of m.d.items.slice(0, 3)) sample.push(P.crypto.hex(await V.entryDigest(it.env)));
    root.append(el("h3", { text: "What the public log sees" }),
      el("p", { class: "section-sub", text: "Only 32-byte fingerprints, published as C2SP tlog-tiles under data/public-log/. These are the first three of this pack's:" }),
      el("pre", { text: sample.join("\n") }));
    root.append(el("h3", { text: "Verify it yourself, offline" }),
      el("p", {}, "Download ", el("a", { href: "data/pack.json", download: "pack.json", text: "pack.json" }), " and ",
        el("a", { href: "data/trust-policy.json", download: "trust-policy.json", text: "trust-policy.json" }), ", then run either open-source verifier:"),
      el("pre", { text: "cd engine\ngo run ./cmd/proofctl verify --pack pack.json --trust trust-policy.json\npython3 -I python/proofctl.py verify --pack pack.json --trust trust-policy.json" }));
  }

  // ---------- verification UI ----------

  function renderSteps() {
    const ol = $("steps");
    ol.classList.remove("ran");
    ol.replaceChildren(...globalThis.ProofSchema.steps.map((s, i) => el("li", { class: "step", id: "step-" + s.ID, "data-status": "idle" },
      el("span", { class: "step-icon", "aria-hidden": "true", text: String(i + 1) }),
      el("div", {}, el("div", { class: "step-title", text: s.Title }), el("div", { class: "step-what", text: STEP_WHAT[s.ID] || "" }), el("div", { class: "step-result" })))));
    $("verify-summary").textContent = "10 checks, offline";
  }

  function setStep(step, status) {
    const li = $("step-" + step.id);
    li.dataset.status = status;
    const icon = li.querySelector(".step-icon");
    icon.textContent = status === "pass" ? "✓" : status === "fail" ? "✗" : status === "warn" ? "!" : icon.textContent;
    const res = li.querySelector(".step-result");
    res.replaceChildren(document.createTextNode(step.detail || ""));
    const box = li.querySelector("div");
    box.querySelectorAll(".step-problems, .step-notes").forEach((n) => n.remove());
    if (step.problems.length) box.append(el("ul", { class: "step-problems" }, step.problems.slice(0, 6).map((p) => el("li", { text: p })),
      step.problems.length > 6 ? el("li", { text: "…and " + (step.problems.length - 6) + " more" }) : null));
    if (step.notes.length) box.append(el("details", { class: "step-notes" }, el("summary", { text: "Notes (" + step.notes.length + ")" }), el("ul", {}, step.notes.map((n) => el("li", { text: n })))));
  }

  function setSeal(state_, title, sub) {
    const seal = $("seal");
    seal.dataset.state = state_;
    seal.querySelector(".seal-icon").textContent = state_ === "pass" ? "✓" : state_ === "fail" ? "✗" : state_ === "running" ? "" : "?";
    $("seal-title").textContent = title;
    $("seal-sub").textContent = sub;
  }

  async function runVerify() {
    if (state.running) return;
    state.running = true;
    $("verify-btn").disabled = true;
    $("tamper-toggle").disabled = true;
    renderSteps();
    setSeal("running", "Verifying…", "Checking every signature, timestamp and proof in this browser.");
    const ids = globalThis.ProofSchema.steps.map((s) => s.ID);
    $("step-" + ids[0]).dataset.status = "running";
    const t0 = performance.now();
    let report;
    try {
      report = await V.verify(state.current.pack, state.trust, async (step) => {
        setStep(step, step.status);
        const next = ids[ids.indexOf(step.id) + 1];
        if (next && $("step-" + next).dataset.status === "idle") $("step-" + next).dataset.status = "running";
        await sleep(110);
      });
    } catch (e) {
      setSeal("fail", "Could not verify", e.message);
      state.running = false;
      $("verify-btn").disabled = false;
      $("tamper-toggle").disabled = false;
      return;
    }
    state.report = report;
    const secs = ((performance.now() - t0) / 1000).toFixed(1);
    const failed = report.steps.filter((s) => s.status === "fail");
    $("steps").classList.add("ran");
    $("verify-summary").textContent = (10 - failed.length) + " of 10 passed · " + secs + " s";
    document.body.classList.toggle("verified", report.verified);
    if (report.verified) {
      const g = report.gaps.length;
      setSeal("pass", "Verified in this browser", "Every check passed" + (g ? "; " + g + " gap" + (g === 1 ? "" : "s") + " disclosed" : "") + ". Checked " + new Date().toLocaleString() + ".");
    } else {
      setSeal("fail", "Verification failed", failed.length + " check" + (failed.length === 1 ? "" : "s") + " failed: " + failed.map((s) => s.title).join("; ") + ".");
      if (failed[0]) $("step-" + failed[0].id).querySelector(".step-title").append(el("span", { class: "caught-tag", text: "caught here" }));
    }
    // Mark timeline squares whose reports failed a per-entry check.
    const invalid = new Set(report.decoded.items.filter((it) => it.posture && !(it.sigOK && it.enrolOK && it.tsOK && it.inclOK)).map((it) => it.index));
    renderTimeline(state.current, invalid);
    if (state.scenario) renderOutcome(report);
    state.running = false;
    $("verify-btn").disabled = false;
    $("tamper-toggle").disabled = false;
    $("verify-btn").textContent = "Verify again";
  }

  // ---------- tampering ----------

  function d07Attester(value) {
    const m = buildModel(value);
    return m.devices.find((a) => a.number === 7);
  }

  function findEntry(value, attId, isoDay) {
    return value.entries.findIndex((e) => {
      try {
        const st = P.posture.validate(P.crypto.b64decode(e.envelope.payload));
        return st.isPosture && st.str("attester") === attId && st.str("observed_at").startsWith(isoDay);
      } catch (err) { return false; }
    });
  }

  async function makeScenario(id) {
    if (state.cache.has(id)) return P.deepClone(state.cache.get(id));
    const v = P.deepClone(state.genuine);
    const a = d07Attester(v);
    let out;
    if (id === "flip") {
      const i = findEntry(v, a.id, "2026-10-14");
      const env = v.entries[i].envelope;
      const st = P.parseCanonical(P.crypto.b64decode(env.payload));
      st.predicate.device.disk_encryption = "on";
      st.predicate.device.edr_running = true;
      env.payload = P.crypto.b64encode(P.utf8(P.canonical(st)));
      // The insider also deletes the matching line from the summary.
      v.summary.lapses = v.summary.lapses.filter((l) => !(l.attester === a.id && l.date === "2026-10-14"));
      out = v;
    } else if (id === "delete") {
      v.entries.splice(findEntry(v, a.id, "2026-10-14"), 1);
      // Make the summary consistent with what is left, as a careful insider would.
      const r = await V.verify(V.parsePack(v), state.trust);
      v.summary = P.parseStrictJSON(P.canonical(r.computed));
      out = v;
    } else if (id === "hide_gap") {
      v.summary.gaps = [];
      out = v;
    } else {
      out = await expandScenario(v, state.scenarios.find((s) => s.id === id));
    }
    state.cache.set(id, out);
    return P.deepClone(out);
  }

  // expandScenario rebuilds an attack world's full pack from its compact
  // form: entries by reference, and every Merkle proof recomputed from the
  // public log's fingerprints (as engine/internal/sample.Expand does).
  async function expandScenario(genuine, sc) {
    const C = P.crypto;
    const raw = C.b64decode(sc.log_digests);
    const leaves = [];
    for (let i = 0; i < raw.length; i += 32) leaves.push(await P.merkle.leafHash(raw.subarray(i, i + 32)));
    const tree = new P.merkle.Tree(leaves);
    const size = P.note.parseCheckpoint(P.note.parseNote(sc.checkpoint).text).size;
    const v = P.deepClone(genuine);
    v.log.checkpoint = sc.checkpoint;
    v.log.earlier_checkpoints = [];
    for (const e of sc.earlier_checkpoints) {
      const m = P.note.parseCheckpoint(P.note.parseNote(e).text).size;
      v.log.earlier_checkpoints.push({ checkpoint: e, consistency_proof: (await tree.consistencyProof(m, size)).map(C.b64encode) });
    }
    v.entries = [];
    for (const e of sc.entries) {
      const src = P.has(e, "ref") ? genuine.entries[e.ref] : e;
      v.entries.push({ index: e.index, envelope: P.deepClone(src.envelope), timestamps: P.deepClone(src.timestamps),
        inclusion_proof: (await tree.inclusionProof(e.index, size)).map(C.b64encode) });
    }
    v.summary = P.deepClone(sc.summary);
    return v;
  }

  function renderScenarios() {
    const fs = $("scenarios");
    fs.querySelectorAll(".scenario").forEach((n) => n.remove());
    for (const s of SCENARIOS) {
      const input = el("input", { type: "radio", name: "scenario", value: s.id, onchange: () => applyScenario(s.id) });
      fs.append(el("label", { class: "scenario", "data-id": s.id }, input,
        el("span", {}, el("span", { class: "scenario-who", text: s.who }), el("span", { class: "scenario-title", text: s.title }),
          el("span", { class: "scenario-what", text: s.what }))));
    }
  }

  async function applyScenario(id) {
    if (state.running) return;
    const s = SCENARIOS.find((x) => x.id === id);
    document.querySelectorAll(".scenario").forEach((n) => n.classList.toggle("selected", n.dataset.id === id));
    $("tamper-outcome").hidden = true;
    setSeal("running", "Preparing the tampered copy…", s.title);
    let value;
    try { value = await makeScenario(id); } catch (e) { setSeal("fail", "Could not build the scenario", e.message); return; }
    state.scenario = s;
    setCurrent(value);
    const banner = $("tamper-banner");
    banner.hidden = false;
    banner.textContent = "Tampered copy: " + s.title.toLowerCase() + ". " + s.what + " The page above now shows what the attacker wants you to see.";
    await runVerify();
  }

  function renderOutcome(report) {
    const s = state.scenario;
    const failed = report.steps.filter((x) => x.status === "fail");
    const box = $("tamper-outcome");
    box.hidden = false;
    box.replaceChildren(
      el("h3", { text: failed.length ? "Caught by " + failed.length + " independent check" + (failed.length === 1 ? "" : "s") : "Not caught (this would be a bug)" }),
      el("ul", { class: "caught-list" }, failed.map((f) => el("li", {}, el("strong", { text: f.title + ": " }), f.problems[0] || f.detail))),
      el("p", {}, el("strong", { text: "Why: " }), s.why));
    box.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }

  function setCurrent(value) {
    state.current = buildModel(value);
    const m = state.current;
    renderHero(m);
    renderProtections(m);
    renderTimeline(m, null);
    renderEvents(m);
    renderProves(m);
    renderSteps();
    $("cell-detail").hidden = true;
    setSeal("idle", "Not verified yet", "Check it yourself: nothing to install, nothing sent anywhere.");
    $("verify-btn").textContent = "Verify this Proof Pack";
    document.body.classList.remove("verified");
  }

  function resetTamper() {
    state.scenario = null;
    $("tamper-banner").hidden = true;
    $("tamper-outcome").hidden = true;
    document.querySelectorAll(".scenario input").forEach((i) => { i.checked = false; });
    document.querySelectorAll(".scenario").forEach((n) => n.classList.remove("selected"));
    setCurrent(P.deepClone(state.genuine));
  }

  // ---------- start ----------

  async function main() {
    document.title = B.product + ": Proof Pack demo";
    document.querySelectorAll("[data-brand=product]").forEach((n) => { n.textContent = B.product; });
    document.querySelectorAll("[data-brand=name]").forEach((n) => { n.textContent = B.name; });
    renderSteps();
    renderScenarios();
    const fc = await P.crypto.featureCheck();
    try {
      const [packText, trustText, scenText] = await Promise.all([loadText("pack.json"), loadText("trust-policy.json"), loadText("scenarios.json")]);
      state.genuine = P.parseStrictJSON(packText);
      state.scenarios = P.parseStrictJSON(scenText).scenarios;
      if (fc.ok) state.trust = await V.parseTrust(P.parseStrictJSON(trustText));
      setCurrent(P.deepClone(state.genuine));
      if (fc.ok) renderTech(state.current).catch((e) => console.warn(e));
    } catch (e) {
      $("firm-name").textContent = "Could not load the Proof Pack";
      $("headline").textContent = e.message;
      return;
    }
    if (!fc.ok) {
      const box = $("crypto-error");
      box.hidden = false;
      box.textContent = fc.why;
      setSeal("fail", "Can't verify in this browser", fc.why);
      return;
    }
    $("verify-btn").disabled = false;
    $("verify-btn").addEventListener("click", runVerify);
    const toggle = $("tamper-toggle");
    toggle.disabled = false;
    toggle.addEventListener("change", () => {
      $("tamper-body").hidden = !toggle.checked;
      $("tamper-state").textContent = toggle.checked ? "On" : "Off";
      if (!toggle.checked) resetTamper();
    });
    $("tamper-reset").addEventListener("click", () => { toggle.checked = false; $("tamper-state").textContent = "Off"; $("tamper-body").hidden = true; resetTamper(); });
    window.ProofDemo = { state, makeScenario, SCENARIOS, runVerify, applyScenario }; // for automated tests
  }

  main();
})();
