// End-to-end test of the demo page in headless Chromium (Playwright).
//
//   node tests/e2e.js [screenshot-dir] [export-dir]
//
// It serves the repository the way GitHub Pages does (so the page lives at
// /<project-folder>/demo/), then checks: no console errors; the genuine pack
// verifies; every tamper scenario fails at exactly the expected steps; the
// page works from file://; no horizontal scrolling at phone width; the print
// layout fits on one page. With export-dir it also writes every tampered
// pack so the Go and Python verifiers can be run on the same files.
const { chromium } = require("playwright");
const path = require("path"), fs = require("fs"), { spawn } = require("child_process");

const demoDir = path.resolve(__dirname, "..");
const projectDir = path.dirname(demoDir);
const siteRoot = path.dirname(projectDir);
const urlPath = "/" + path.basename(projectDir) + "/demo/";
const shots = process.argv[2] || path.join(demoDir, "tests", "out");
const exportDir = process.argv[3] || "";
const PORT = 8000 + Math.floor(Math.random() * 900);

const EXPECT = {
  genuine: [],
  flip: ["signatures", "sequence", "timestamps", "inclusion", "gaps"],
  delete: ["sequence"],
  hide_gap: ["gaps"],
  replay: ["sequence", "timestamps"],
  backdate: ["timestamps"],
  vendor_rewrite: ["sequence", "consistency", "witnesses"],
};

let failures = 0;
const check = (ok, msg) => { console.log((ok ? "  ok   " : "  FAIL ") + msg); if (!ok) failures++; };

async function waitVerified(page) {
  await page.waitForFunction(() => {
    const s = document.getElementById("seal").dataset.state;
    return s === "pass" || s === "fail";
  }, null, { timeout: 60000 });
  return page.evaluate(() => ({
    seal: document.getElementById("seal").dataset.state,
    failed: Array.from(document.querySelectorAll(".step[data-status=fail]")).map((n) => n.id.replace("step-", "")),
    statuses: Object.fromEntries(Array.from(document.querySelectorAll(".step")).map((n) => [n.id.replace("step-", ""), n.dataset.status])),
  }));
}

function watchConsole(page, label, errors) {
  page.on("console", (m) => { if (m.type() === "error") errors.push(label + ": " + m.text()); });
  page.on("pageerror", (e) => errors.push(label + ": " + e.message));
}

(async () => {
  fs.mkdirSync(shots, { recursive: true });
  if (exportDir) fs.mkdirSync(exportDir, { recursive: true });
  const server = spawn(process.execPath, [path.join(__dirname, "serve.js"), siteRoot, String(PORT)], { stdio: "ignore" });
  await new Promise((r) => setTimeout(r, 400));
  const url = "http://localhost:" + PORT + urlPath;
  const browser = await chromium.launch();
  const errors = [];
  try {
    // ---- desktop, served over http ----
    console.log("desktop " + url);
    const desk = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    watchConsole(desk, "desktop", errors);
    await desk.goto(url);
    await desk.waitForFunction(() => !document.getElementById("verify-btn").disabled, null, { timeout: 30000 });
    check((await desk.textContent("#firm-name")).includes("Maple Street Tax & Bookkeeping (sample)"), "firm name rendered");
    check((await desk.textContent(".sample-banner")).includes("Sample data"), "sample banner shown");
    check((await desk.title()).includes(await desk.evaluate(() => window.BRAND.product)), "title uses the brand constant");
    check((await desk.locator("#timeline .cell.gap").count()) === 2, "timeline shows the 2-day gap");
    await desk.screenshot({ path: path.join(shots, "desktop-before-verify.png"), fullPage: true });
    await desk.click("#verify-btn");
    let r = await waitVerified(desk);
    check(r.seal === "pass" && r.failed.length === 0, "genuine pack verifies (failed: " + r.failed.join(",") + ")");
    check(Object.values(r.statuses).every((s) => s === "pass"), "all 10 steps pass");
    await desk.screenshot({ path: path.join(shots, "desktop-verified.png"), fullPage: true });
    await desk.locator("#timeline .cell.lapse").first().click();
    check(await desk.isVisible("#cell-detail pre"), "clicking a square shows the signed statement");

    // ---- tamper scenarios ----
    await desk.check("#tamper-toggle", { force: true });
    for (const id of ["flip", "delete", "hide_gap", "replay", "backdate", "vendor_rewrite"]) {
      await desk.click(`.scenario[data-id=${id}]`);
      await desk.waitForFunction(() => document.getElementById("seal").dataset.state === "running" || document.getElementById("seal").dataset.state === "fail", null, { timeout: 30000 });
      r = await waitVerified(desk);
      check(r.seal === "fail" && JSON.stringify(r.failed) === JSON.stringify(EXPECT[id]), `tamper "${id}" fails at [${r.failed.join(", ")}] (expected [${EXPECT[id].join(", ")}])`);
      if (id === "flip") {
        await desk.screenshot({ path: path.join(shots, "desktop-tampered-flip.png"), fullPage: true });
        const first = await desk.textContent(".step[data-status=fail] .step-problems li");
        check(first.includes("Laptop D07 report #12 (Oct 14)") && first.includes("signature does not match"), "flip: the first failure names the edited report");
      }
      if (id === "vendor_rewrite") await desk.screenshot({ path: path.join(shots, "desktop-tampered-vendor.png"), fullPage: true });
      if (exportDir) {
        const json = await desk.evaluate(async (sid) => JSON.stringify(await window.ProofDemo.makeScenario(sid)), id);
        fs.writeFileSync(path.join(exportDir, id + ".pack.json"), json);
      }
    }
    await desk.click("#tamper-reset");
    await desk.click("#verify-btn");
    r = await waitVerified(desk);
    check(r.seal === "pass", "restoring the genuine pack verifies again");

    // ---- print layout ----
    await desk.emulateMedia({ media: "print" });
    const pdf = await desk.pdf({ format: "Letter", printBackground: true });
    const pages = (pdf.toString("latin1").match(/\/Type\s*\/Page[^s]/g) || []).length;
    fs.writeFileSync(path.join(shots, "print.pdf"), pdf);
    check(pages === 1, "prints as one page (got " + pages + ")");
    await desk.screenshot({ path: path.join(shots, "print-preview.png"), fullPage: true });
    await desk.emulateMedia({ media: "screen" });

    // ---- mobile 390px ----
    const mob = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    watchConsole(mob, "mobile", errors);
    await mob.goto(url);
    await mob.waitForFunction(() => !document.getElementById("verify-btn").disabled, null, { timeout: 30000 });
    const overflow = await mob.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    check(overflow <= 0, "no horizontal scroll at 390px (overflow " + overflow + "px)");
    await mob.screenshot({ path: path.join(shots, "mobile-before-verify.png"), fullPage: true });
    await mob.click("#verify-btn");
    r = await waitVerified(mob);
    check(r.seal === "pass", "mobile: verifies");
    await mob.screenshot({ path: path.join(shots, "mobile-verified.png"), fullPage: true });
    await mob.check("#tamper-toggle", { force: true });
    await mob.click(".scenario[data-id=flip]");
    await mob.waitForFunction(() => document.getElementById("seal").dataset.state === "running", null, { timeout: 30000 }).catch(() => {});
    r = await waitVerified(mob);
    check(r.seal === "fail", "mobile: tamper fails");
    const overflow2 = await mob.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    check(overflow2 <= 0, "no horizontal scroll at 390px after tampering (overflow " + overflow2 + "px)");
    await mob.screenshot({ path: path.join(shots, "mobile-tampered.png"), fullPage: true });

    // ---- dark mode ----
    const dark = await browser.newPage({ viewport: { width: 1280, height: 900 }, colorScheme: "dark" });
    watchConsole(dark, "dark", errors);
    await dark.goto(url);
    await dark.waitForFunction(() => !document.getElementById("verify-btn").disabled, null, { timeout: 30000 });
    await dark.click("#verify-btn");
    await waitVerified(dark);
    await dark.screenshot({ path: path.join(shots, "desktop-dark-verified.png"), fullPage: true });

    // ---- file:// ----
    const file = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const fileErrors = [];
    watchConsole(file, "file", fileErrors);
    await file.goto("file://" + path.join(demoDir, "index.html"));
    await file.waitForFunction(() => !document.getElementById("verify-btn").disabled, null, { timeout: 30000 });
    await file.click("#verify-btn");
    r = await waitVerified(file);
    check(r.seal === "pass", "works from file:// (data from demo-data.js)");
    // fetch() of a local file is expected to fail from file://; nothing else may.
    const unexpected = fileErrors.filter((e) => !/Failed to load resource|Fetch API cannot load|CORS|net::ERR_FILE_NOT_FOUND|Not allowed to load local resource/i.test(e));
    check(unexpected.length === 0, "file://: no unexpected console errors " + (unexpected.length ? JSON.stringify(unexpected) : ""));
  } finally {
    await browser.close();
    server.kill();
  }
  check(errors.length === 0, "no console errors over http " + (errors.length ? JSON.stringify(errors) : ""));
  console.log(failures ? failures + " check(s) FAILED" : "all checks passed");
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
