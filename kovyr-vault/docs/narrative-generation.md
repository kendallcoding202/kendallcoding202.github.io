# Model-written narrative (Step 3) — parked spec

**Status: PARKED.** Steps 1 and 2 are built and shipped in 0.18.0 —
`briefing.py` (the boundary) and `narrative.py` (the draft lint). Step 3
is the generation call itself, and it should not be built until the
decision in "The fork" below is made deliberately.

---

## What already exists

- `briefing.build()` — turns tool output into counts, booleans and
  allowlisted values. No paths, no filenames, no client name.
- `briefing.validate()` — re-checks a finished object and names every
  reason it is unsafe.
- `narrative.check_draft()` — rejects a draft containing a number the
  briefing does not support, a path-like string, or the real client name.
- `kovyr-vault briefing` — prints the exact object for operator review.

What is missing is only the call, and the decision about where it runs.

---

## The fork: where does generation happen?

This is the whole decision. The privacy answer depends far more on
*where* than on *which model*.

### Option A — local model, on the client's machine
Ollama / llama.cpp / MLX bundled or required alongside the app.

- **Preserves the zero-egress claim absolutely.** Nothing leaves, ever.
- Cost: a multi-gigabyte runtime and model on a dental office's
  workstation, real RAM requirements, slow on the older hardware these
  clients actually run, and small local models write noticeably weaker
  prose than the thing being replaced.
- Also becomes a support burden: a second large component to install,
  update, and troubleshoot on machines Kovyr does not otherwise touch.

### Option B — hosted API, on the operator's machine ✅ recommended
Kendall runs report generation; the client app never calls a model.

- **The client machine's zero-egress property is untouched** — it makes
  no outbound call, and the claim in the data-handling summary stays
  literally true for the installed software.
- What leaves *Kendall's* machine is the briefing: counts, booleans, and
  five location buckets. If `validate()` passes, that object contains no
  client data in any meaningful sense — that is the entire purpose of the
  boundary built in Step 1.
- The wording that changes is Kovyr's own operator-side description, not
  the client-facing one. That is a much smaller edit, and an honest one.
- Cost: an API key to manage, a per-report cost, and a dependency on a
  third party for a step that has a deterministic fallback.

### Option C — hosted API, on the client's machine
Worst of both. The installed app gains an outbound dependency and the
zero-egress claim breaks, for no benefit over Option B. **Do not do
this.**

**Recommendation: Option B.** It preserves the property that took real
work to establish, keeps the heavy dependency off client hardware, and
confines the change to a sentence about how Kovyr produces reports.

---

## What is actually worth generating

Not the descriptive sections. Those are already deterministic, accurate,
and deliberately worded — for example:

> Looked inside 412 files; 1,203 could not be read inside (office
> documents, PDFs, images and other non-text files). Sensitive data in
> those files would not be found.

A model would rephrase that more smoothly. A dental office would not
notice, and the existing sentence is provably correct.

The value is in the **variable, judgement-shaped** parts — the ones
currently written by hand for every client:

- A per-client remediation narrative: given these gaps, which matter most
  for *this* firm, and in what order.
- The "what changed since last month" paragraph in the monthly packet.

Both are reasoning tasks, which is what a model is genuinely good at, and
both are work Kendall does manually today.

---

## The limit of `check_draft()` — state this plainly

The lint verifies **numbers and identifiers**. It cannot verify
**claims**. A draft reading:

> Your data is secure and you are compliant with the FTC Safeguards Rule.

contains no number, no path, and no client name. It passes the lint
cleanly, and in a compliance document it is the genuinely dangerous
sentence — far more so than a wrong file count.

Therefore:

- `check_draft() == []` means **not provably wrong**, never "correct".
- **Human review is the actual control**, not a formality. Generation
  must never write directly into a delivered artifact.
- Consider a claim-phrase denylist ("compliant", "certified", "secure",
  "guaranteed", "fully protected") as a cheap second filter. It will not
  be complete, and should not be presented as if it were.

---

## Build order (when unparked)

1. **Decide the fork** — A or B. Nothing below is stable until then.
2. **`generate()`** with an injectable client, so tests run without a
   model. Pipeline: `build()` → `validate()` → generate → `check_draft()`
   → return draft *plus* its problems, never a bare string.
3. **Human review gate** — the operator sees the draft and the lint
   results and explicitly accepts. No silent path into a report.
4. **Report slot** — `render_report()` takes an optional narrative key
   and falls back to today's exact output when absent. Pin that fallback
   with a test comparing against current rendering.
5. **Opt-in flags** — `--narrative` on `report` and `monitor --html`.
   Default off.
6. **Audit logging** — record every briefing produced and every draft
   accepted, using `audit.record`. Log the briefing's hash and the
   decision, not the prose.

---

## Revisit trigger

Build when **both** are true:

- The fork is decided in writing, and
- There is a specific section whose prose quality actually matters to a
  paying client — most likely the per-client remediation narrative, once
  enough engagements exist to know what that narrative should say.

Until then, Steps 1 and 2 stand on their own: `validate()` is a reusable
safety net for anything sent off-machine, and `check_draft()` is a real
control against fabricated figures regardless of what writes them.
