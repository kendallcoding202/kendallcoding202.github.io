import { Errand } from "./agent.js";
import { BrowserTools, describeAction, shortUrl, toolDefinitions } from "./tools.js";
import { DEFAULT_MODEL, MODELS, siteOf } from "./policy.js";

const $ = (sel) => document.querySelector(sel);
const timeline = $("#timeline");
const input = $("#input");
const sendBtn = $("#send-btn");

const DEFAULTS = {
  apiKey: "",
  model: DEFAULT_MODEL,
  effort: "medium",
  mode: "balanced",
  maxSteps: 40,
  history: false,
  baseURL: "",
  alwaysAllowed: [],
};

const state = {
  settings: { ...DEFAULTS },
  errand: null, // current Errand (conversation)
  browser: null,
  awaitingReply: null, // resolver while ask_user waits for the user
  pending: new Set(), // resolvers of open approval / site / continue cards
  statusEl: null,
  statusTimer: null,
  log: [], // for export
};

// ---------- tiny DOM helper ----------

function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

function icon(path) {
  const span = h("span", { class: "ic" });
  span.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${path}</svg>`;
  return span;
}

const ICONS = {
  click: '<path d="M9 9l10 4-4 2-2 4z"/><path d="M5 3v3M3 5h3M6.5 6.5 4.5 4.5"/>',
  type_text: '<rect x="3" y="6" width="18" height="12" rx="2"/><path d="M7 10h.01M11 10h.01M15 10h.01M7 14h10"/>',
  select_option: '<path d="M4 7h16M4 12h10M4 17h7"/>',
  press_key: '<rect x="4" y="6" width="16" height="12" rx="2"/><path d="M9 12h6"/>',
  navigate: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
  open_tab: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 9h18"/>',
  switch_tab: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 9h18"/>',
  list_tabs: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 9h18"/>',
  go_back: '<path d="M15 6l-6 6 6 6"/>',
  read_page: '<path d="M4 5h16M4 10h16M4 15h10M4 20h7"/>',
  scroll: '<path d="M12 5v14M7 14l5 5 5-5"/>',
  screenshot: '<rect x="3" y="6" width="18" height="13" rx="2"/><circle cx="12" cy="12.5" r="3"/>',
  wait: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  ask_user: '<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.5A8 8 0 1 1 21 12z"/>',
  search_history: '<circle cx="11" cy="11" r="6"/><path d="M20 20l-4.5-4.5"/>',
  error: '<circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16h.01"/>',
};

function scrollDown() {
  requestAnimationFrame(() => (timeline.scrollTop = timeline.scrollHeight));
}

function add(el) {
  // Keep the live status line at the bottom.
  if (state.statusEl && state.statusEl.isConnected) timeline.insertBefore(el, state.statusEl);
  else timeline.append(el);
  scrollDown();
  return el;
}

// Safe, small Markdown subset for the agent's replies: paragraphs, lists,
// **bold**, `code`, and http(s) links. Everything is escaped first.
function renderMarkdown(text) {
  const wrap = h("div", { class: "msg-agent" });
  const blocks = text.replace(/\r/g, "").split(/\n{2,}/);
  for (const block of blocks) {
    const lines = block.split("\n");
    const isList = lines.every((l) => /^\s*([-*•]|\d+[.)])\s+/.test(l));
    if (isList) {
      const ordered = /^\s*\d/.test(lines[0]);
      const list = h(ordered ? "ol" : "ul");
      for (const l of lines) list.append(inline(h("li"), l.replace(/^\s*([-*•]|\d+[.)])\s+/, "")));
      wrap.append(list);
    } else {
      const p = h("p");
      lines.forEach((l, i) => {
        if (i) p.append(h("br"));
        inline(p, l.replace(/^#{1,6}\s+/, ""));
      });
      wrap.append(p);
    }
  }
  return wrap;
}

function inline(parent, text) {
  const re = /\*\*([^*]+)\*\*|`([^`]+)`|\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|(https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"])/g;
  let last = 0;
  let m;
  while ((m = re.exec(text))) {
    if (m.index > last) parent.append(text.slice(last, m.index));
    if (m[1]) parent.append(h("strong", {}, m[1]));
    else if (m[2]) parent.append(h("code", {}, m[2]));
    else if (m[3]) parent.append(h("a", { href: m[4], target: "_blank", rel: "noopener noreferrer" }, m[3]));
    else if (m[5]) parent.append(h("a", { href: m[5], target: "_blank", rel: "noopener noreferrer" }, m[5]));
    last = re.lastIndex;
  }
  if (last < text.length) parent.append(text.slice(last));
  return parent;
}

// ---------- settings ----------

async function loadSettings() {
  const stored = await chrome.storage.local.get(Object.keys(DEFAULTS));
  state.settings = { ...DEFAULTS, ...stored };
  if (!MODELS[state.settings.model]) state.settings.model = DEFAULT_MODEL;
  renderMeta();
}

async function saveSettings(patch) {
  Object.assign(state.settings, patch);
  await chrome.storage.local.set(patch);
  renderMeta();
  const saved = $("#s-saved");
  saved.textContent = state.errand ? "Saved. Changes apply to your next errand." : "Saved.";
  clearTimeout(saveSettings.t);
  saveSettings.t = setTimeout(() => (saved.textContent = ""), 2500);
}

function renderMeta() {
  const s = state.settings;
  $("#meta-model").textContent = `${MODELS[s.model]?.label || s.model} · ${s.mode === "cautious" ? "Cautious" : "Balanced"}`;
}

function openSettings() {
  const s = state.settings;
  $("#main-view").hidden = true;
  $("#settings-view").hidden = false;
  $("#s-key").value = s.apiKey;
  const sel = $("#s-model");
  sel.replaceChildren(...Object.entries(MODELS).map(([id, m]) => h("option", { value: id }, m.label)));
  sel.value = s.model;
  $("#s-effort").value = s.effort;
  for (const r of document.querySelectorAll("input[name=s-mode]")) r.checked = r.value === s.mode;
  $("#s-steps").value = s.maxSteps;
  $("#s-history").checked = !!s.history;
  $("#s-base").value = s.baseURL;
  renderSites();
  $("#s-key").focus();
}

function closeSettings() {
  $("#settings-view").hidden = true;
  $("#main-view").hidden = false;
  if (!timeline.children.length) renderEmpty();
  input.focus();
}

function renderSites() {
  const list = $("#s-sites");
  const sites = state.settings.alwaysAllowed || [];
  if (!sites.length) {
    list.replaceChildren(h("li", { class: "none" }, "None yet. Choose “Always allow” when Errand asks."));
    return;
  }
  list.replaceChildren(
    ...sites.map((site) =>
      h("li", {}, site,
        h("button", {
          type: "button", class: "link-btn",
          onclick: async () => {
            await saveSettings({ alwaysAllowed: state.settings.alwaysAllowed.filter((s) => s !== site) });
            renderSites();
          },
        }, "Remove")),
    ),
  );
}

function wireSettings() {
  $("#settings-btn").addEventListener("click", openSettings);
  $("#settings-back").addEventListener("click", closeSettings);
  $("#s-key").addEventListener("change", (e) => saveSettings({ apiKey: e.target.value.trim() }));
  $("#s-key-toggle").addEventListener("click", (e) => {
    const k = $("#s-key");
    k.type = k.type === "password" ? "text" : "password";
    e.target.textContent = k.type === "password" ? "Show" : "Hide";
  });
  $("#s-model").addEventListener("change", (e) => saveSettings({ model: e.target.value }));
  $("#s-effort").addEventListener("change", (e) => saveSettings({ effort: e.target.value }));
  for (const r of document.querySelectorAll("input[name=s-mode]")) {
    r.addEventListener("change", (e) => e.target.checked && saveSettings({ mode: e.target.value }));
  }
  $("#s-steps").addEventListener("change", (e) => {
    const n = Math.min(200, Math.max(5, Number(e.target.value) || 40));
    e.target.value = n;
    saveSettings({ maxSteps: n });
  });
  $("#s-history").addEventListener("change", async (e) => {
    if (e.target.checked) {
      // Must run inside the click's user gesture for Chrome to show its prompt.
      const granted = await chrome.permissions.request({ permissions: ["history"] }).catch(() => false);
      e.target.checked = granted;
      await saveSettings({ history: granted });
    } else {
      await chrome.permissions.remove({ permissions: ["history"] }).catch(() => {});
      await saveSettings({ history: false });
    }
  });
  $("#s-base").addEventListener("change", (e) => saveSettings({ baseURL: e.target.value.trim() }));
}

// ---------- empty state ----------

const SUGGESTIONS = [
  "Summarize this page in five bullet points",
  "Find the cheapest option on this page that fits what I need",
  "Unsubscribe me from this mailing list",
  "Fill out this form using details I'll give you",
];

function renderEmpty() {
  const check = '<path d="M5 12l5 5 9-10"/>';
  const svg = (p) => {
    const s = h("span");
    s.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${p}</svg>`;
    return s.firstChild;
  };
  timeline.replaceChildren(
    h("div", { class: "empty" },
      h("h1", {}, "What can I take off your plate?"),
      h("p", {}, "Errand works in this browser, where you’re already signed in, and asks before anything that matters."),
      h("div", { class: "chips" },
        SUGGESTIONS.map((s) => h("button", { type: "button", class: "chip", onclick: () => { input.value = s; input.focus(); autosize(); } }, s))),
      h("div", { class: "promise" },
        h("div", {}, svg(check), "Never sees your passwords or card numbers"),
        h("div", {}, svg(check), "Asks before buying, sending, posting or deleting"),
        h("div", {}, svg(check), "Only works on sites you allow")),
      !state.settings.apiKey
        ? h("div", { class: "card", style: "margin-top:16px" },
            h("p", { class: "what" }, "Add your Anthropic API key to start."),
            h("p", { class: "sub" }, "It stays in this browser. Errand talks to Anthropic directly; there is no Errand server."),
            h("div", { class: "actions" }, h("button", { type: "button", class: "btn primary", onclick: openSettings }, "Open settings")))
        : null,
    ),
  );
}

// ---------- status line ----------

function setStatus(kind, call) {
  clearInterval(state.statusTimer);
  if (kind === "idle") {
    state.statusEl?.remove();
    state.statusEl = null;
    setRunning(false);
    return;
  }
  setRunning(true);
  const started = Date.now();
  const label = kind === "thinking" ? "Thinking" : call ? `${describeAction(call.name, call.input || {}, null)}` : "Working";
  const text = h("span", {}, label);
  const el = h("div", { class: "status", role: "status" }, h("span", { class: "dots" }, h("i"), h("i"), h("i")), text);
  state.statusEl?.remove();
  state.statusEl = el;
  timeline.append(el);
  scrollDown();
  if (kind === "thinking") {
    state.statusTimer = setInterval(() => {
      const s = Math.round((Date.now() - started) / 1000);
      text.textContent = s >= 3 ? `${label} · ${s}s` : label;
    }, 1000);
  }
}

function setRunning(on) {
  sendBtn.classList.toggle("running", on && !state.awaitingReply);
  sendBtn.setAttribute("aria-label", on && !state.awaitingReply ? "Stop" : "Run");
  input.placeholder = state.awaitingReply
    ? "Reply to Errand…"
    : on ? "Errand is working. Press stop to interrupt." : state.errand ? "Ask a follow-up or give a new task" : "What should Errand do on this page?";
}

// ---------- cards that wait for the user ----------

function waitFor(card, buttons) {
  return new Promise((resolve) => {
    const finish = (value, label) => {
      state.pending.delete(cancel);
      card.classList.add("done");
      card.querySelector(".actions")?.replaceChildren(h("span", { class: "sub" }, label));
      resolve(value);
    };
    const cancel = () => finish(buttons.find((b) => b.cancel)?.value ?? null, "Stopped");
    state.pending.add(cancel);
    card.append(
      h("div", { class: "actions" },
        buttons.map((b) => h("button", { type: "button", class: `btn ${b.kind || ""}`, "data-choice": b.id, onclick: () => finish(b.value, b.done) }, b.label))),
    );
    add(card);
    card.querySelector(".btn")?.focus({ preventScroll: true });
  });
}

const ui = {
  status: setStatus,
  usage(usage, cost) {
    const tokens = usage.input_tokens + usage.cache_creation_input_tokens + usage.cache_read_input_tokens + usage.output_tokens;
    $("#meta-usage").textContent = `${formatTokens(tokens)} tokens · ≈$${cost < 0.01 ? cost.toFixed(3) : cost.toFixed(2)}`;
    $("#export-btn").hidden = false;
  },
  say(text, { interim = false } = {}) {
    const el = renderMarkdown(text);
    if (interim) el.classList.add("interim");
    add(el);
    state.log.push({ at: new Date(), kind: interim ? "note" : "reply", text });
  },
  step(entry) {
    const cls = ["step", entry.quiet ? "quiet" : "", entry.status === "error" ? "error" : ""].join(" ");
    const badge = entry.decision === "approved" ? h("span", { class: "badge approved" }, "Approved")
      : entry.decision === "denied" ? h("span", { class: "badge denied" }, "Declined")
      : entry.decision === "blocked" ? h("span", { class: "badge blocked" }, "Blocked") : h("span");
    add(h("div", { class: cls },
      icon(entry.status === "error" && !entry.decision ? ICONS.error : ICONS[entry.tool] || ICONS.click),
      h("div", {},
        h("div", { class: "title" }, entry.title),
        entry.note ? h("div", { class: "note" }, entry.note) : null,
        entry.status === "error" && entry.detail && entry.decision !== "denied" ? h("div", { class: "note" }, entry.detail) : null),
      badge));
    state.log.push({ at: new Date(), kind: "step", ...entry });
  },
  error(message) {
    add(h("div", { class: "card error", role: "alert" }, message));
    state.log.push({ at: new Date(), kind: "error", text: message });
  },
  warn(message, excerpts = []) {
    add(h("div", { class: "card warn" }, h("strong", {}, "Heads up: "), message, excerpts[0] ? h("q", {}, excerpts[0]) : null));
    state.log.push({ at: new Date(), kind: "warning", text: message, excerpts });
  },
  approve(req) {
    const card = h("div", { class: "card approval", "data-kind": "approval" },
      h("h3", {}, "Approval needed"),
      h("p", { class: "what" }, req.title),
      req.note ? h("p", { class: "sub" }, `Errand: “${req.note}”`) : null,
      h("p", { class: "why" }, `${req.why}${req.site ? ` On ${req.site}.` : ""}`));
    return waitFor(card, [
      { id: "approve", label: "Approve", kind: "primary", value: true, done: "Approved" },
      { id: "deny", label: "Deny", kind: "danger", value: false, done: "Declined", cancel: true },
    ]).then((ok) => {
      state.log.push({ at: new Date(), kind: "approval", title: req.title, site: req.site, approved: ok });
      return ok;
    });
  },
  allowSite(site) {
    const card = h("div", { class: "card site", "data-kind": "site" },
      h("h3", {}, "New site"),
      h("p", { class: "what" }, `Let Errand work on ${site}?`),
      h("p", { class: "why" }, "Errand only reads and acts on sites you allow."));
    return waitFor(card, [
      { id: "once", label: "Allow for this errand", kind: "primary", value: "once", done: `Allowed ${site} for this errand` },
      { id: "always", label: "Always allow", value: "always", done: `Always allowed ${site}` },
      { id: "all", label: "Allow all sites this errand", value: "all", done: "Allowed every site for this errand" },
      { id: "deny", label: "Don’t allow", kind: "danger", value: "deny", done: `Didn’t allow ${site}`, cancel: true },
    ]).then(async (answer) => {
      if (answer === "always") await saveSettings({ alwaysAllowed: [...new Set([...(state.settings.alwaysAllowed || []), site])] });
      state.log.push({ at: new Date(), kind: "site", site, answer });
      return answer;
    });
  },
  ask(question) {
    const card = add(h("div", { class: "card question", "data-kind": "question" }, h("h3", {}, "Errand asks"), h("p", { class: "what" }, question)));
    state.log.push({ at: new Date(), kind: "question", text: question });
    return new Promise((resolve) => {
      const cancel = () => {
        state.pending.delete(cancel);
        state.awaitingReply = null;
        card.classList.add("done");
        resolve("(The user stopped the errand without answering.)");
      };
      state.pending.add(cancel);
      state.awaitingReply = (text) => {
        state.pending.delete(cancel);
        state.awaitingReply = null;
        card.classList.add("done");
        setRunning(true);
        resolve(text);
      };
      setRunning(true);
      input.focus();
    });
  },
  confirmContinue(steps) {
    const card = h("div", { class: "card", "data-kind": "continue" },
      h("p", { class: "what" }, `Errand has taken ${steps} steps on this errand.`),
      h("p", { class: "sub" }, "Keep going, or stop here?"));
    return waitFor(card, [
      { id: "continue", label: "Keep going", kind: "primary", value: true, done: "Continued" },
      { id: "stop", label: "Stop", value: false, done: "Stopped", cancel: true },
    ]);
  },
  tabChanged(tab) {
    add(h("div", { class: "step quiet" }, icon(ICONS.open_tab), h("div", {}, h("div", { class: "title" }, `Now working in “${tab.title || shortUrl(tab.pendingUrl || tab.url || "")}”`)), h("span")));
  },
};

function formatTokens(n) {
  return n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

// ---------- running errands ----------

async function currentTab() {
  const forced = new URLSearchParams(location.search).get("tab"); // used by tests
  if (forced) return chrome.tabs.get(Number(forced));
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function submit() {
  const text = input.value.trim();

  if (state.awaitingReply) {
    if (!text) return;
    input.value = "";
    autosize();
    add(h("div", { class: "msg-user" }, text));
    state.log.push({ at: new Date(), kind: "user", text });
    state.awaitingReply(text);
    return;
  }

  if (state.errand?.running) {
    stopErrand();
    return;
  }

  if (!text) return;
  if (!state.settings.apiKey) {
    openSettings();
    return;
  }

  const tab = await currentTab();
  input.value = "";
  autosize();
  if (!state.errand) {
    timeline.replaceChildren();
    state.log = [];
    const history = state.settings.history && !!(await chrome.permissions.contains({ permissions: ["history"] }).catch(() => false));
    const settings = { ...state.settings };
    state.browser = new BrowserTools({
      tabId: tab?.id,
      settings,
      ui,
      alwaysAllowed: state.settings.alwaysAllowed,
      saveAlwaysAllowed: (list) => saveSettings({ alwaysAllowed: list }),
    });
    state.errand = new Errand({ settings, tools: toolDefinitions({ history }), browser: state.browser, ui });
  } else if (tab) {
    state.browser.tabId = tab.id; // follow-ups work on whatever tab is in front now
  }
  if (tab?.url) state.browser.grantSite(tab.url);

  add(h("div", { class: "msg-user" }, text));
  state.log.push({ at: new Date(), kind: "user", text, url: tab?.url });

  const context = tab?.url
    ? `Current tab: "${tab.title || ""}" ${tab.url}${siteOf(tab.url) ? "" : " (Errand can't act on this kind of page; navigate to a website first.)"}`
    : "There is no current tab.";
  const today = new Date().toLocaleDateString(undefined, { weekday: "long", year: "numeric", month: "long", day: "numeric" });
  await state.errand.run(`${text}\n\n<context>\n${context}\nToday is ${today}.\n</context>`);
}

function stopErrand() {
  state.errand?.stop();
  for (const cancel of [...state.pending]) cancel();
  if (state.awaitingReply) state.awaitingReply = null;
}

function newErrand() {
  stopErrand();
  state.errand = null;
  state.browser = null;
  state.log = [];
  $("#meta-usage").textContent = "";
  $("#export-btn").hidden = true;
  renderEmpty();
  setRunning(false);
  input.focus();
}

function exportLog() {
  const lines = ["# Errand activity log", "", `Exported ${new Date().toLocaleString()} · ${MODELS[state.settings.model]?.label || state.settings.model}`, ""];
  for (const e of state.log) {
    const t = e.at.toLocaleTimeString();
    if (e.kind === "user") lines.push(`## ${t} · You`, "", e.text, e.url ? `\n_On ${e.url}_` : "", "");
    else if (e.kind === "reply") lines.push(`## ${t} · Errand`, "", e.text, "");
    else if (e.kind === "note") lines.push(`- ${t} · _${e.text}_`);
    else if (e.kind === "step") {
      const decision = e.decision === "approved" ? " **(you approved)**" : e.decision === "denied" ? " **(you declined)**" : e.decision === "blocked" ? " **(blocked)**" : "";
      lines.push(`- ${t} · ${e.title}${decision}${e.site ? ` · ${e.site}` : ""}${e.note ? ` · ${e.note}` : ""}${e.status === "error" && e.detail ? ` · error: ${e.detail}` : ""}`);
    } else if (e.kind === "approval") lines.push(`- ${t} · Approval: ${e.title} → ${e.approved ? "approved" : "declined"}`);
    else if (e.kind === "site") lines.push(`- ${t} · Site ${e.site} → ${e.answer}`);
    else if (e.kind === "question") lines.push(`- ${t} · Errand asked: ${e.text}`);
    else if (e.kind === "warning") lines.push(`- ${t} · ⚠ ${e.text}`);
    else if (e.kind === "error") lines.push(`- ${t} · Error: ${e.text}`);
  }
  if (state.errand) {
    const u = state.errand.usage;
    lines.push("", `Tokens: ${u.input_tokens} input, ${u.cache_read_input_tokens} cached, ${u.cache_creation_input_tokens} cache writes, ${u.output_tokens} output · ≈$${state.errand.cost.toFixed(3)}`);
  }
  const blob = new Blob([lines.join("\n")], { type: "text/markdown" });
  const a = h("a", { href: URL.createObjectURL(blob), download: `errand-log-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-")}.md` });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function autosize() {
  input.style.height = "auto";
  input.style.height = `${Math.min(160, input.scrollHeight)}px`;
}

// ---------- wiring ----------

$("#composer").addEventListener("submit", (e) => {
  e.preventDefault();
  submit();
});
input.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    submit();
  } else if (e.key === "Escape" && state.errand?.running) {
    stopErrand();
  }
});
input.addEventListener("input", autosize);
$("#new-btn").addEventListener("click", newErrand);
$("#export-btn").addEventListener("click", exportLog);
chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === "errand:stop") stopErrand();
});

wireSettings();
await loadSettings();
renderEmpty();
setRunning(false);
input.focus();
