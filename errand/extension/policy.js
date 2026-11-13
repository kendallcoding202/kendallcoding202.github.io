// Errand's safety policy. Pure functions only (no chrome.* or DOM), so the
// rules that decide what the agent may do on its own can be unit tested.

// Hosts where the registrable domain is three labels, not two. Not the full
// Public Suffix List, but it covers the common cases where treating the last
// two labels as "the site" would lump unrelated sites together.
const MULTI_PART_SUFFIXES = new Set([
  "co.uk", "org.uk", "ac.uk", "gov.uk", "me.uk", "net.uk",
  "com.au", "net.au", "org.au", "edu.au", "gov.au",
  "co.nz", "org.nz", "co.jp", "ne.jp", "or.jp", "co.kr", "co.in", "net.in",
  "org.in", "co.za", "com.br", "com.mx", "com.ar", "com.tr", "com.sg",
  "com.hk", "com.tw", "com.cn", "co.il", "co.id", "com.my", "com.ph",
  "github.io", "gitlab.io", "vercel.app", "netlify.app", "pages.dev",
  "herokuapp.com", "web.app", "firebaseapp.com", "blogspot.com",
  "azurewebsites.net", "cloudfront.net", "workers.dev", "fly.dev",
  "onrender.com", "glitch.me", "replit.app", "s3.amazonaws.com",
]);

const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;

/**
 * The "site" a URL belongs to, for consent purposes: the registrable domain
 * (example.com for shop.example.com). Returns null for pages Errand never
 * acts on (chrome://, file://, the Web Store, extension pages...).
 */
export function siteOf(url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  const host = u.hostname.toLowerCase().replace(/\.$/, "");
  if (!host) return null;
  if (host === "chromewebstore.google.com" ||
      (host === "chrome.google.com" && u.pathname.startsWith("/webstore"))) {
    return null; // browsers forbid extensions from scripting the store
  }
  if (host === "localhost" || IPV4.test(host) || host.startsWith("[")) {
    return host;
  }
  const labels = host.split(".");
  if (labels.length <= 2) return host;
  const lastTwo = labels.slice(-2).join(".");
  if (MULTI_PART_SUFFIXES.has(lastTwo)) return labels.slice(-3).join(".");
  return lastTwo;
}

// Labels on buttons and links whose click does something the user would want
// to sign off on: spending money, speaking for them, destroying data, or
// changing account or security settings.
const CONSEQUENTIAL_LABEL = new RegExp(
  "\\b(" +
    [
      // money
      "buy", "buy now", "purchase", "pay", "pay now", "place (?:my |your |the )?order",
      "order now", "submit order", "complete (?:order|purchase|booking|payment|checkout)",
      "confirm (?:order|purchase|booking|payment|and pay)", "checkout and pay",
      "donate", "tip", "transfer", "send money", "withdraw", "add funds", "bid",
      "subscribe", "upgrade", "start (?:my |your )?(?:free )?trial", "book",
      "book now", "reserve", "rent",
      // speaking for the user
      "send", "post", "publish", "tweet", "reply", "comment", "submit", "share",
      "invite", "rsvp", "apply", "apply now", "sign up", "register", "enroll",
      "join",
      // destroying or undoing
      "delete", "remove", "discard", "erase", "empty trash", "unsubscribe",
      "cancel (?:my |your |the )?(?:order|subscription|membership|account|plan|reservation|booking)",
      "deactivate", "close (?:my |your )?account", "revoke", "reset", "archive",
      "unfollow", "block", "report",
      // account and security
      "confirm", "authori[sz]e", "approve", "accept", "agree", "allow access",
      "grant access", "connect account", "sign", "e-?sign",
      "change (?:password|email|phone)", "save (?:changes|settings)", "transfer ownership",
    ].join("|") +
    ")\\b",
  "i",
);

const DOWNLOAD_URL = /\.(exe|msi|dmg|pkg|app|apk|bat|cmd|sh|ps1|scr|jar|deb|rpm|zip|7z|rar|iso)(\?|#|$)/i;

/**
 * Decide whether an action can run on its own, needs the user's approval
 * first, or is blocked outright.
 *
 * @param {object} action  {tool, input}
 * @param {object|null} target  what the page reports about the element the
 *   action touches (see page.js describe()), or null for tab-level actions
 * @param {object} options {mode: "balanced" | "cautious"}
 * @returns {{decision: "auto"|"confirm"|"block", why: string}}
 */
export function classifyAction(action, target, { mode = "balanced" } = {}) {
  const { tool, input = {} } = action;
  const cautious = mode === "cautious";
  const label = target ? `${target.name || ""} ${target.value || ""}`.trim() : "";

  if (tool === "type_text") {
    if (target?.sensitive) {
      return {
        decision: "block",
        why: "This is a password, payment, or other sensitive field. Errand never types into those; the user has to fill it in themselves.",
      };
    }
    if (looksLikeCardNumber(input.text)) {
      return {
        decision: "block",
        why: "The text looks like a payment card number. Errand never types card numbers; the user has to enter them.",
      };
    }
    if (input.press_enter && target?.inForm && !target.formIsSearch) {
      return { decision: "confirm", why: "Pressing Enter here submits a form." };
    }
    if (cautious) return { decision: "confirm", why: "Cautious mode asks before typing." };
    return { decision: "auto", why: "" };
  }

  if (tool === "click") {
    if (target?.isSubmit && target.formHasSensitive) {
      return { decision: "confirm", why: "This submits a form that contains payment or login details." };
    }
    if (label && CONSEQUENTIAL_LABEL.test(label)) {
      return { decision: "confirm", why: `"${truncate(label, 60)}" looks like an action that can't easily be undone.` };
    }
    if (target?.isSubmit && target.inForm && !target.formIsSearch) {
      return { decision: "confirm", why: "This submits a form." };
    }
    if (target?.href && DOWNLOAD_URL.test(target.href)) {
      return { decision: "confirm", why: "This link downloads a file." };
    }
    if (cautious) return { decision: "confirm", why: "Cautious mode asks before every click." };
    return { decision: "auto", why: "" };
  }

  if (tool === "press_key") {
    if (input.key === "Enter" && target?.inForm && !target.formIsSearch && target.tag !== "textarea") {
      return { decision: "confirm", why: "Pressing Enter here submits a form." };
    }
    if (input.key === "Enter" && target && CONSEQUENTIAL_LABEL.test(label)) {
      return { decision: "confirm", why: `Pressing Enter activates "${truncate(label, 60)}".` };
    }
    if (cautious) return { decision: "confirm", why: "Cautious mode asks before key presses." };
    return { decision: "auto", why: "" };
  }

  if (tool === "select_option") {
    if (cautious) return { decision: "confirm", why: "Cautious mode asks before changing a field." };
    return { decision: "auto", why: "" };
  }

  if (tool === "navigate" || tool === "open_tab") {
    if (DOWNLOAD_URL.test(input.url || "")) {
      return { decision: "confirm", why: "This address downloads a file." };
    }
    return { decision: "auto", why: "" };
  }

  return { decision: "auto", why: "" };
}

/** True for 13-19 digit strings (spaces/dashes allowed) that pass the Luhn check. */
export function looksLikeCardNumber(text) {
  if (typeof text !== "string") return false;
  const compact = text.replace(/[\s-]/g, "");
  if (!/^\d{13,19}$/.test(compact)) return false;
  let sum = 0;
  let double = false;
  for (let i = compact.length - 1; i >= 0; i--) {
    let d = compact.charCodeAt(i) - 48;
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
}

// Phrases that show up when a page tries to steer an AI agent. A match does
// not block anything by itself (the approval and site gates are the real
// defense); it tells the user and reminds the model that it is page content.
const INJECTION_PATTERNS = [
  /\b(ignore|disregard|forget|override)\b[^.\n]{0,40}\b(previous|prior|above|earlier|all|your|system)\b[^.\n]{0,25}\b(instructions?|prompts?|rules|directions|guidelines)/i,
  /\b(new|updated|real|actual)\s+(instructions|system prompt|task)\s*:/i,
  /\b(ai|llm|gpt|claude|language model|browser|automated)\s+(agents?|assistants?|bots?)\b[^.\n]{0,60}\b(must|should|need to|are (?:required|instructed)|have to|please)\b/i,
  /\byou are (now )?(an?|the) (ai|assistant|agent)\b[^.\n]{0,40}\b(must|should|will)\b/i,
  /<\/?\s*(system|instructions?|admin)\s*>/i,
  /\bsystem prompt\b/i,
];

/** Return up to 3 short excerpts of page text that look like prompt injection. */
export function findInjection(text) {
  if (typeof text !== "string" || !text) return [];
  const hits = [];
  for (const re of INJECTION_PATTERNS) {
    const m = re.exec(text);
    if (!m) continue;
    const start = Math.max(0, m.index - 30);
    const end = Math.min(text.length, m.index + m[0].length + 50);
    const excerpt = text.slice(start, end).replace(/\s+/g, " ").trim();
    if (!hits.some((h) => h.includes(excerpt) || excerpt.includes(h))) hits.push(excerpt);
    if (hits.length >= 3) break;
  }
  return hits;
}

/** Turn a page snapshot (from page.js) into the text the model reads. */
export function formatSnapshot(snap, { tabId } = {}) {
  const lines = [];
  const scroll = snap.scroll || {};
  lines.push(
    `<page_content source="website" trust="untrusted" tab="${tabId ?? ""}">`,
    `URL: ${snap.url}`,
    `Title: ${snap.title || "(none)"}`,
  );
  if (scroll.screens > 1.05) {
    const where = scroll.atBottom ? "at the bottom" : scroll.atTop ? "at the top" : `${scroll.percent}% down`;
    lines.push(`Scroll: ${where} of a page ${scroll.screens.toFixed(1)} screens tall.`);
  }
  if (snap.dialog) lines.push(`A dialog is open: "${snap.dialog}"`);
  lines.push("", "Interactive elements ([ref] role \"name\" details; * = outside the visible area):");
  if (!snap.elements?.length) lines.push("(none found)");
  for (const el of snap.elements || []) lines.push(formatElement(el));
  if (snap.truncatedElements) {
    lines.push(`(${snap.truncatedElements} more elements not listed; scroll or use more specific steps to reach them)`);
  }
  lines.push("", "Page text:", snap.text || "(no text)");
  if (snap.truncatedText) lines.push("(text truncated)");
  lines.push("</page_content>");
  // A page must not be able to close the wrapper early and pose as the
  // harness, so neutralize the tag anywhere except the first and last line.
  const last = lines.length - 1;
  return lines
    .map((line, i) => (i === 0 || i === last ? line : line.replace(/<(\/?)page_content/gi, "<$1page​_content")))
    .join("\n");
}

function formatElement(el) {
  let s = `[${el.ref}] ${el.role}`;
  if (el.name) s += ` "${el.name}"`;
  if (el.type && !["text", el.role].includes(el.type)) s += ` type=${el.type}`;
  if (el.sensitive) s += " (sensitive: hidden; the user must fill this in)";
  else if (el.value) s += ` value="${el.value}"`;
  if (el.placeholder && el.placeholder !== el.name) s += ` placeholder="${el.placeholder}"`;
  if (el.checked !== undefined && el.checked !== null) s += el.checked ? " [checked]" : " [unchecked]";
  if (el.expanded !== undefined && el.expanded !== null) s += el.expanded ? " [expanded]" : " [collapsed]";
  if (el.disabled) s += " [disabled]";
  if (el.required) s += " [required]";
  if (el.href) s += ` -> ${el.href}`;
  if (el.options?.length) s += ` options: ${el.options.map((o) => JSON.stringify(o)).join(", ")}`;
  if (!el.inViewport) s += " *";
  return s;
}

function truncate(s, n) {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

// Prices in USD per million tokens, from Anthropic's published rates.
// Cache writes cost 1.25x input; cache reads are listed per model.
export const MODELS = {
  "claude-fable-5-2": { label: "Claude Fable 5.2", input: 8, output: 40, cacheRead: 0.2 },
  "claude-opus-5-5": { label: "Claude Opus 5.5", input: 4, output: 20, cacheRead: 0.2 },
  "claude-sonnet-5-5": { label: "Claude Sonnet 5.5", input: 2, output: 10, cacheRead: 0.1 },
  "claude-haiku-5-5": { label: "Claude Haiku 5.5", input: 0.1, output: 0.5, cacheRead: 0.01 },
};

export const DEFAULT_MODEL = "claude-fable-5-2";

/** Approximate cost in USD of the token usage so far. */
export function estimateCost(model, usage) {
  const p = MODELS[model];
  if (!p) return null;
  const perTok = (rate) => rate / 1_000_000;
  return (
    (usage.input_tokens || 0) * perTok(p.input) +
    (usage.cache_creation_input_tokens || 0) * perTok(p.input * 1.25) +
    (usage.cache_read_input_tokens || 0) * perTok(p.cacheRead) +
    (usage.output_tokens || 0) * perTok(p.output)
  );
}
