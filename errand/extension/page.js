// Injected into the page Errand is working on (isolated world, so page
// scripts cannot see or call it). Defines window.__errand once per document.
// Values of password, payment and other sensitive fields never leave this
// script: snapshots report that such a field exists, never what is in it.
(() => {
  if (window.__errand) return;

  const REF_ATTR = "data-errand-ref";
  const MAX_ELEMENTS = 250;
  const MAX_TEXT = 9000;
  let nextRef = 1;

  const INTERACTIVE_SELECTOR = [
    "a[href]", "button", "input:not([type=hidden])", "textarea", "select", "summary",
    "[role=button]", "[role=link]", "[role=checkbox]", "[role=radio]", "[role=switch]",
    "[role=tab]", "[role=menuitem]", "[role=menuitemcheckbox]", "[role=menuitemradio]",
    "[role=option]", "[role=combobox]", "[role=textbox]", "[role=searchbox]",
    "[role=slider]", "[role=spinbutton]", "[role=treeitem]", "[contenteditable='']",
    "[contenteditable=true]", "[onclick]", "[tabindex]:not([tabindex='-1'])",
  ].join(",");

  const SENSITIVE_HINT =
    /(passw|passcode|passphrase|\bpin\b|card.?num|cc.?num|credit.?card|debit.?card|cvv|cvc|\bcsc\b|security.?code|card.?code|expir|\bssn\b|social.?sec|routing|acct.?num|account.?num|\biban\b|\bswift\b|tax.?id|\bitin\b|one.?time|\botp\b|2fa|verification.?code)/i;

  // ---------- element discovery ----------

  function* allElements(root) {
    for (const el of root.querySelectorAll("*")) {
      yield el;
      if (el.shadowRoot) yield* allElements(el.shadowRoot);
    }
  }

  function findByRef(ref) {
    for (const el of allElements(document)) {
      if (el.getAttribute && el.getAttribute(REF_ATTR) === ref) return el;
    }
    return null;
  }

  function isVisible(el) {
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return false;
    if (typeof el.checkVisibility === "function") {
      return el.checkVisibility({ opacityProperty: true, visibilityProperty: true });
    }
    const s = getComputedStyle(el);
    return s.visibility !== "hidden" && s.display !== "none" && Number(s.opacity) > 0;
  }

  function inViewport(el) {
    const r = el.getBoundingClientRect();
    return r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth;
  }

  function clean(s, n = 100) {
    s = String(s || "").replace(/\s+/g, " ").trim();
    return s.length > n ? s.slice(0, n - 1) + "…" : s;
  }

  function labelText(el) {
    const parts = [];
    if (el.labels) for (const l of el.labels) parts.push(l.innerText);
    return clean(parts.join(" "));
  }

  function nameOf(el) {
    const aria = el.getAttribute("aria-label");
    if (aria && aria.trim()) return clean(aria);
    const by = el.getAttribute("aria-labelledby");
    if (by) {
      const t = by.split(/\s+/).map((id) => document.getElementById(id)?.innerText || "").join(" ");
      if (t.trim()) return clean(t);
    }
    const tag = el.tagName.toLowerCase();
    if (tag === "input" || tag === "textarea" || tag === "select") {
      const l = labelText(el);
      if (l) return l;
      if (["submit", "button", "reset"].includes(el.type) && el.value) return clean(el.value);
      if (el.type === "image" && el.alt) return clean(el.alt);
      return clean(el.getAttribute("placeholder") || el.getAttribute("title") || el.getAttribute("name") || "");
    }
    const text = el.innerText || el.textContent || "";
    if (text.trim()) return clean(text);
    const img = el.querySelector && el.querySelector("img[alt], svg[aria-label]");
    if (img) return clean(img.getAttribute("alt") || img.getAttribute("aria-label"));
    return clean(el.getAttribute("title") || "");
  }

  function roleOf(el) {
    const explicit = el.getAttribute("role");
    if (explicit) return explicit.split(/\s+/)[0];
    const tag = el.tagName.toLowerCase();
    if (tag === "a") return "link";
    if (tag === "button" || tag === "summary") return "button";
    if (tag === "select") return "select";
    if (tag === "textarea") return "textbox";
    if (tag === "input") {
      const t = (el.type || "text").toLowerCase();
      if (t === "checkbox" || t === "radio") return t;
      if (["submit", "button", "reset", "image"].includes(t)) return "button";
      if (t === "search") return "searchbox";
      if (t === "range") return "slider";
      if (t === "number") return "spinbutton";
      if (t === "file") return "file-upload";
      return "textbox";
    }
    if (el.isContentEditable) return "textbox";
    return "clickable";
  }

  function isSensitive(el) {
    const tag = el.tagName.toLowerCase();
    if (tag !== "input" && tag !== "textarea" && !el.isContentEditable) return false;
    if (tag === "input" && el.type === "password") return true;
    const ac = (el.getAttribute("autocomplete") || "").toLowerCase().split(/\s+/);
    if (ac.some((t) => t.startsWith("cc-") || t === "current-password" || t === "new-password" || t === "one-time-code")) {
      return true;
    }
    const hay = [el.name, el.id, el.getAttribute("aria-label"), el.getAttribute("placeholder"), labelText(el)].join(" ");
    return SENSITIVE_HINT.test(hay);
  }

  function formOf(el) {
    return el.form || el.closest("form");
  }

  function formIsSearch(form) {
    if (!form) return false;
    if (form.getAttribute("role") === "search" || form.closest("[role=search]")) return true;
    if (form.querySelector("input[type=search]")) return true;
    const hay = [form.getAttribute("action"), form.id, form.className, form.getAttribute("name"), form.getAttribute("aria-label")].join(" ");
    if (/search|query|\bfind\b|lookup/i.test(hay)) return true;
    const fields = [...form.querySelectorAll("input:not([type=hidden]):not([type=submit]):not([type=button]), textarea, select")];
    return fields.length === 1 && /^(q|query|s|search|keywords?|term|k)$/i.test(fields[0].name || "");
  }

  function formHasSensitive(form) {
    if (!form) return false;
    return [...form.querySelectorAll("input, textarea")].some(isSensitive);
  }

  function isSubmitControl(el) {
    const tag = el.tagName.toLowerCase();
    if (tag === "button") {
      const t = (el.getAttribute("type") || "").toLowerCase();
      return t === "submit" || (t === "" && !!formOf(el));
    }
    if (tag === "input") return ["submit", "image"].includes((el.type || "").toLowerCase());
    return false;
  }

  function shortHref(el) {
    const raw = el.getAttribute("href");
    if (!raw || raw.startsWith("javascript:")) return undefined;
    try {
      const u = new URL(raw, location.href);
      if (u.origin === location.origin) return clean(u.pathname + u.search + u.hash, 80);
      return clean(u.href, 100);
    } catch {
      return undefined;
    }
  }

  function describeElement(el, ref) {
    const tag = el.tagName.toLowerCase();
    const role = roleOf(el);
    const d = { ref, role, name: nameOf(el), inViewport: inViewport(el) };
    if (tag === "input") d.type = (el.type || "text").toLowerCase();
    const sensitive = isSensitive(el);
    if (sensitive) d.sensitive = true;
    if (!sensitive && (tag === "input" || tag === "textarea") && !["checkbox", "radio", "submit", "button", "reset", "image", "file"].includes(d.type)) {
      if (el.value) d.value = clean(el.value, 80);
      const ph = el.getAttribute("placeholder");
      if (ph) d.placeholder = clean(ph, 60);
    }
    if (!sensitive && el.isContentEditable && tag !== "input" && tag !== "textarea") {
      d.value = clean(el.innerText, 80);
    }
    if (tag === "select") {
      const opts = [...el.options];
      d.options = opts.slice(0, 15).map((o) => clean(o.text, 40));
      if (opts.length > 15) d.options.push(`…${opts.length - 15} more`);
      if (el.selectedIndex >= 0) d.value = clean(el.options[el.selectedIndex]?.text, 60);
    }
    if (d.type === "checkbox" || d.type === "radio") d.checked = el.checked;
    else if (el.hasAttribute("aria-checked")) d.checked = el.getAttribute("aria-checked") === "true";
    if (el.hasAttribute("aria-expanded")) d.expanded = el.getAttribute("aria-expanded") === "true";
    if (el.disabled || el.getAttribute("aria-disabled") === "true") d.disabled = true;
    if (el.required) d.required = true;
    if (tag === "a") d.href = shortHref(el);
    return d;
  }

  function refFor(el) {
    let ref = el.getAttribute(REF_ATTR);
    if (!ref) {
      ref = `e${nextRef++}`;
      el.setAttribute(REF_ATTR, ref);
    }
    return ref;
  }

  // ---------- snapshot ----------

  function snapshot() {
    const candidates = [];
    const seen = new Set();
    for (const el of allElements(document)) {
      if (!(el instanceof HTMLElement) || seen.has(el)) continue;
      if (!el.matches(INTERACTIVE_SELECTOR)) continue;
      if (!isVisible(el)) continue;
      // Skip containers whose only job is to hold another listed control.
      if (el.matches("[tabindex],[onclick]") && !el.matches("a,button,input,select,textarea,summary,[role]") &&
          el.querySelector("a[href],button,input,select,textarea")) continue;
      seen.add(el);
      candidates.push(el);
    }
    const visibleFirst = candidates.filter(inViewport).concat(candidates.filter((e) => !inViewport(e)));
    const chosen = visibleFirst.slice(0, MAX_ELEMENTS);
    const order = new Map(candidates.map((e, i) => [e, i]));
    chosen.sort((a, b) => order.get(a) - order.get(b));

    const elements = chosen.map((el) => describeElement(el, refFor(el)));

    let text = (document.body?.innerText || "").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
    const truncatedText = text.length > MAX_TEXT;
    if (truncatedText) text = text.slice(0, MAX_TEXT);

    const docH = Math.max(document.documentElement.scrollHeight, document.body?.scrollHeight || 0);
    const maxScroll = Math.max(1, docH - innerHeight);
    const dialogEl = [...document.querySelectorAll("dialog[open], [role=dialog], [role=alertdialog], [aria-modal=true]")].find(isVisible);

    return {
      url: location.href,
      title: document.title,
      elements,
      truncatedElements: Math.max(0, candidates.length - chosen.length),
      text,
      truncatedText,
      dialog: dialogEl ? nameOf(dialogEl).slice(0, 80) : null,
      scroll: {
        percent: Math.round((scrollY / maxScroll) * 100),
        screens: docH / Math.max(1, innerHeight),
        atTop: scrollY <= 2,
        atBottom: scrollY >= maxScroll - 2,
      },
    };
  }

  // ---------- actions ----------

  function need(ref) {
    const el = findByRef(ref);
    if (!el) throw new Error(`No element with ref ${ref} on the current page. The page may have changed; read it again for fresh refs.`);
    return el;
  }

  /** What the policy needs to know about an element before acting on it. */
  function describeTarget(ref) {
    const el = ref ? findByRef(ref) : document.activeElement;
    if (!el || el === document.body) return null;
    const form = formOf(el);
    return {
      ref: el.getAttribute(REF_ATTR) || null,
      tag: el.tagName.toLowerCase(),
      role: roleOf(el),
      name: nameOf(el),
      value: ["submit", "button"].includes(el.type) ? clean(el.value, 60) : "",
      href: el.tagName === "A" ? el.href : undefined,
      sensitive: isSensitive(el),
      isSubmit: isSubmitControl(el),
      inForm: !!form,
      formIsSearch: formIsSearch(form),
      formHasSensitive: formHasSensitive(form),
    };
  }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  async function click(ref) {
    const el = need(ref);
    if (el.disabled) throw new Error(`Element ${ref} is disabled.`);
    el.scrollIntoView({ block: "center", inline: "center", behavior: "instant" });
    flash(el);
    await sleep(120);
    const r = el.getBoundingClientRect();
    const base = { bubbles: true, cancelable: true, composed: true, view: window, button: 0,
      clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 };
    el.dispatchEvent(new PointerEvent("pointerdown", { ...base, pointerType: "mouse", isPrimary: true }));
    el.dispatchEvent(new MouseEvent("mousedown", base));
    if (typeof el.focus === "function") el.focus({ preventScroll: true });
    el.dispatchEvent(new PointerEvent("pointerup", { ...base, pointerType: "mouse", isPrimary: true }));
    el.dispatchEvent(new MouseEvent("mouseup", base));
    if (typeof el.click === "function") el.click();
    else el.dispatchEvent(new MouseEvent("click", base));
    return `Clicked ${ref}.`;
  }

  function setNativeValue(el, value) {
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
    if (setter) setter.call(el, value);
    else el.value = value;
  }

  async function typeText(ref, text, pressEnter) {
    const el = need(ref);
    if (isSensitive(el)) throw new Error("Refusing to type into a sensitive field.");
    el.scrollIntoView({ block: "center", behavior: "instant" });
    flash(el);
    el.focus({ preventScroll: true });
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
      setNativeValue(el, text);
      el.dispatchEvent(new InputEvent("input", { bubbles: true, composed: true, inputType: "insertText", data: text }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    } else if (el.isContentEditable) {
      const sel = getSelection();
      const range = document.createRange();
      range.selectNodeContents(el);
      sel.removeAllRanges();
      sel.addRange(range);
      if (!document.execCommand("insertText", false, text)) el.textContent = text;
    } else {
      throw new Error(`Element ${ref} is not a text field.`);
    }
    await sleep(60);
    if (pressEnter) await pressKey("Enter");
    return `Typed into ${ref}${pressEnter ? " and pressed Enter" : ""}.`;
  }

  const KEY_CODES = { Enter: 13, Escape: 27, Tab: 9, Backspace: 8, ArrowDown: 40, ArrowUp: 38,
    ArrowLeft: 37, ArrowRight: 39, PageDown: 34, PageUp: 33, Home: 36, End: 35, " ": 32 };

  async function pressKey(key) {
    if (key === "Space") key = " ";
    const target = document.activeElement || document.body;
    const init = { key, code: key === " " ? "Space" : key, keyCode: KEY_CODES[key] || 0, which: KEY_CODES[key] || 0,
      bubbles: true, cancelable: true, composed: true };
    const down = target.dispatchEvent(new KeyboardEvent("keydown", init));
    if (key === "Enter") target.dispatchEvent(new KeyboardEvent("keypress", init));
    target.dispatchEvent(new KeyboardEvent("keyup", init));
    // Synthetic key events don't trigger the browser's default actions, so
    // do the important ones by hand when the page didn't handle the key.
    if (down) {
      if (key === "Enter" && target instanceof HTMLInputElement && formOf(target)) {
        const form = formOf(target);
        if (typeof form.requestSubmit === "function") form.requestSubmit();
        else form.submit();
      } else if (key === "Enter" && (target instanceof HTMLAnchorElement || target instanceof HTMLButtonElement)) {
        target.click();
      } else if (key === "PageDown" || key === "PageUp") {
        scrollBy(0, (key === "PageDown" ? 1 : -1) * innerHeight * 0.85);
      } else if (key === "Home" || key === "End") {
        if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)) {
          scrollTo(0, key === "Home" ? 0 : document.documentElement.scrollHeight);
        }
      }
    }
    return `Pressed ${key === " " ? "Space" : key}.`;
  }

  async function selectOption(ref, option) {
    const el = need(ref);
    if (!(el instanceof HTMLSelectElement)) {
      throw new Error(`Element ${ref} is not a native dropdown. Click it to open it, then click the option.`);
    }
    const want = String(option).trim().toLowerCase();
    const opts = [...el.options];
    const match = opts.find((o) => o.value.toLowerCase() === want) ||
      opts.find((o) => o.text.trim().toLowerCase() === want) ||
      opts.find((o) => o.text.trim().toLowerCase().includes(want));
    if (!match) throw new Error(`No option matching "${option}". Options: ${opts.map((o) => o.text.trim()).slice(0, 20).join(", ")}`);
    flash(el);
    el.value = match.value;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return `Selected "${clean(match.text, 60)}" in ${ref}.`;
  }

  function scroll(direction, ref) {
    const sign = direction === "up" ? -1 : 1;
    if (ref) {
      const el = need(ref);
      el.scrollBy({ top: sign * el.clientHeight * 0.85, behavior: "instant" });
      return `Scrolled ${ref} ${direction}.`;
    }
    scrollBy({ top: sign * innerHeight * 0.85, behavior: "instant" });
    return `Scrolled ${direction}.`;
  }

  // ---------- "Errand is working" overlay ----------

  let host = null;
  let shadow = null;

  function ensureOverlay() {
    if (host && host.isConnected) return;
    host = document.createElement("errand-overlay");
    host.style.cssText = "all: initial; position: fixed; inset: 0; z-index: 2147483647; pointer-events: none;";
    shadow = host.attachShadow({ mode: "closed" });
    shadow.innerHTML = `
      <style>
        .frame { position: fixed; inset: 0; pointer-events: none;
          box-shadow: inset 0 0 0 3px rgba(91, 76, 240, .85), inset 0 0 28px rgba(91, 76, 240, .35);
          animation: pulse 2.4s ease-in-out infinite; }
        @keyframes pulse { 50% { box-shadow: inset 0 0 0 3px rgba(91, 76, 240, .55), inset 0 0 40px rgba(91, 76, 240, .2); } }
        .pill { position: fixed; left: 50%; bottom: 18px; transform: translateX(-50%);
          display: flex; align-items: center; gap: 10px; padding: 8px 8px 8px 14px; border-radius: 999px;
          background: #17142b; color: #fff; font: 500 13px/1.2 system-ui, -apple-system, "Segoe UI", sans-serif;
          box-shadow: 0 6px 24px rgba(0,0,0,.25); pointer-events: auto; }
        .dot { width: 8px; height: 8px; border-radius: 50%; background: #8f84ff; animation: blink 1s infinite; }
        @keyframes blink { 50% { opacity: .3; } }
        button { all: unset; cursor: pointer; padding: 5px 12px; border-radius: 999px; background: #fff; color: #17142b; font-weight: 600; }
        button:hover { background: #e9e6ff; }
        .flash { position: fixed; border: 2px solid #5b4cf0; border-radius: 6px; background: rgba(91,76,240,.12);
          pointer-events: none; transition: opacity .5s ease; }
        @media (prefers-reduced-motion: reduce) { .frame, .dot { animation: none; } }
      </style>
      <div class="frame"></div>
      <div class="pill" role="status"><span class="dot"></span><span>Errand is working</span><button type="button">Stop</button></div>`;
    shadow.querySelector("button").addEventListener("click", () => {
      chrome.runtime.sendMessage({ type: "errand:stop" }).catch(() => {});
    });
    document.documentElement.appendChild(host);
  }

  function overlay(on) {
    if (on) ensureOverlay();
    else if (host) {
      host.remove();
      host = null;
    }
    return true;
  }

  function flash(el) {
    if (!host || !host.isConnected) return;
    const r = el.getBoundingClientRect();
    const box = document.createElement("div");
    box.className = "flash";
    Object.assign(box.style, { left: `${r.left - 3}px`, top: `${r.top - 3}px`, width: `${r.width + 6}px`, height: `${r.height + 6}px` });
    shadow.appendChild(box);
    setTimeout(() => (box.style.opacity = "0"), 450);
    setTimeout(() => box.remove(), 1000);
  }

  const api = { snapshot, describeTarget, click, typeText, pressKey, selectOption, scroll, overlay };

  Object.defineProperty(window, "__errand", {
    value: {
      async call(method, args) {
        try {
          if (!Object.prototype.hasOwnProperty.call(api, method)) throw new Error(`Unknown page method ${method}`);
          return { value: await api[method](...(args || [])) };
        } catch (e) {
          return { error: String(e && e.message ? e.message : e) };
        }
      },
    },
  });
})();
