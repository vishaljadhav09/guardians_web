#!/usr/bin/env node
// Frame-exact "golden" capture of every stage (dev-only). Used to prove the Pixi port matches the Canvas2D build.
//   node golden.mjs --root <siteRoot> --out <dir> [--only stage01,stage04] [--viewports 1366x768,844x390,390x844]
//                   [--scenarios play60,play300,input,win,lose]
// Per stage x viewport x scenario it writes <out>/<stage>/<vp>/<scenario>.png (canvas frame only, for diffing),
// <scenario>-page.png (whole page, for human review) and appends the state trace to <out>/traces.json.
// Determinism: lib/determinism.js (seeded Math.random + virtual clock/rAF/timers; frames only advance on __det.step).
import fs from "node:fs";
import path from "node:path";
import { startServer } from "./lib/server.mjs";
import { launch, openPage, PAGES, sleep } from "./lib/driver.mjs";
import { pick } from "./lib/viewports.mjs";
import { injectHook } from "./lib/dbg-hooks.mjs";

const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, all) => (v.startsWith("--") ? [...a, [v.slice(2), all[i + 1] && !all[i + 1].startsWith("--") ? all[i + 1] : "1"]] : a), []));
const root = path.resolve(args.root || "../..");
const out = path.resolve(args.out || "out/golden");
const only = (args.only || "stage01,stage02,stage03,stage04,stage05").split(",");
const vps = pick(args.viewports || "1366x768,844x390,390x844");
const scenarios = (args.scenarios || "play60,play300,input,win,lose").split(",");
const DET = fs.readFileSync(new URL("./lib/determinism.js", import.meta.url), "utf8");

const step = (page, n) => page.evaluate((k) => window.__det.step(k), n);

async function pumpUntil(page, fn, maxFrames = 600) {
  for (let i = 0; i < maxFrames; i += 5) {
    if (await page.evaluate(fn)) return true;
    await step(page, 5);
    await sleep(10);
  }
  return false;
}

async function dismissIntro(page) {
  const sel = ".gog-guardian-beat [data-role=continue]";
  const shown = await pumpUntil(page, `!!document.querySelector('${sel}')`, 300);
  if (!shown) return false;
  for (let i = 0; i < 4; i++) {
    await page.evaluate((s) => { const b = document.querySelector(s); if (b) { b.disabled = false; b.click(); } }, sel);
    await step(page, 20);
    await sleep(30);
    if (!(await page.evaluate(() => !!document.querySelector(".gog-guardian-beat")))) return true;
  }
  return false;
}

async function frameBox(page) {
  return page.evaluate(() => {
    const f = document.getElementById("canvasFrame") || document.querySelector(".canvas-frame");
    const r = f.getBoundingClientRect();
    return { x: Math.max(0, r.left), y: Math.max(0, r.top), width: Math.min(r.width, innerWidth - Math.max(0, r.left)), height: Math.min(r.height, innerHeight - Math.max(0, r.top)) };
  });
}

async function shoot(page, dir, name) {
  fs.mkdirSync(dir, { recursive: true });
  const box = await frameBox(page);
  await page.screenshot({ path: path.join(dir, `${name}.png`), clip: box });
  await page.screenshot({ path: path.join(dir, `${name}-page.png`) });
}

async function scriptedInput(page, mode, vpName) {
  const box = await frameBox(page);
  const P = (fx, fy) => [box.x + box.width * fx, box.y + box.height * fy];
  if (mode === "keyboard") {
    await page.keyboard.down("ArrowRight");
    await step(page, 45);
    await page.keyboard.press("Space");
    await step(page, 45);
    await page.keyboard.up("ArrowRight");
    await step(page, 60);
    return;
  }
  const hold = mode === "pointerPolled" ? 6 : 3;
  const [ax, ay] = P(0.3, 0.45), [bx, by] = P(0.7, 0.4), [cx, cy] = P(0.5, 0.65);
  await page.mouse.move(ax, ay); await step(page, 20);
  await page.mouse.down(); await step(page, hold + 6);
  await page.mouse.move(bx, by, { steps: 4 }); await step(page, 30);
  await page.mouse.up(); await step(page, 40);
  await page.mouse.move(cx, cy); await page.mouse.down(); await step(page, hold + 6); await page.mouse.up(); await step(page, 60);
}

const traces = {};
const srvCache = {};
for (const stage of only) {
  const def = PAGES[stage];
  if (!def) { console.error("unknown stage", stage); continue; }
  const stageFile = def.file.replace(/^stages\//, "");
  const srv = (srvCache[stage] = await startServer(root, {
    transform: (rel, body) => {
      if (!rel.endsWith(stageFile) || !rel.startsWith("stages/")) return null;
      const o = injectHook(body.toString("utf8"), stage);
      return o ? Buffer.from(o, "utf8") : null;
    },
  }));
  const browser = await launch();
  for (const vp of vps) {
    for (const sc of scenarios) {
      const h = await openPage(browser, vp, { origin: srv.origin, skipCoach: true });
      const page = h.page;
      await page.evaluateOnNewDocument(`window.__detOpts={seed:1234};`);
      await page.evaluateOnNewDocument(DET);
      await page.evaluateOnNewDocument(() => { try { localStorage.setItem("gog_save_v1", JSON.stringify({ version: 1, settings: { sound: false, calmMode: false } })); } catch (e) {} });
      let note = "";
      try {
        await page.goto(`${srv.origin}/${def.file}${args.query || ""}`, { waitUntil: "load", timeout: 45000 });
        await pumpUntil(page, "document.readyState === 'complete'", 60);
        await step(page, 30);
        await sleep(400); // let image/audio network events land (they do not need the virtual clock)
        await step(page, 30);
        const ok = await dismissIntro(page);
        if (!ok) note += "intro not dismissed; ";
        await page.evaluate(() => window.__det.reseed(1234));
        const dbgReady = await pumpUntil(page, "window.__dbg && window.__dbg.ready()", 240);
        if (!dbgReady) note += "dbg not ready; ";
        const key = `${stage}/${vp.name}/${sc}`;
        const dir = path.join(out, stage, vp.name);
        const st = () => page.evaluate(() => (window.__dbg ? window.__dbg.getState() : null));
        if (sc === "play60") { await step(page, 60); }
        else if (sc === "play300") { await step(page, 300); }
        else if (sc === "input") { await scriptedInput(page, def.input, vp.name); }
        else if (sc === "boost") { await step(page, 40); await page.evaluate(() => document.getElementById("boostBtn").click()); await step(page, 14); }
        else if (sc === "win") { await page.evaluate(() => window.__dbg.forceWin()); await step(page, 240); }
        else if (sc === "lose") { await page.evaluate(() => window.__dbg.forceLose()); await step(page, 240); }
        await sleep(150);
        await shoot(page, dir, sc);
        traces[key] = { state: await st(), clock: await page.evaluate(() => window.__det.clock()), errors: h.log.pageErrors, note };
        console.log(key, note || "ok", h.log.pageErrors.length ? "PAGEERRORS " + h.log.pageErrors.join(" | ") : "");
      } catch (e) {
        console.error(`${stage}/${vp.name}/${sc} FAILED`, e.message);
        traces[`${stage}/${vp.name}/${sc}`] = { error: String(e.message) };
      }
      await h.close();
      // save after every scenario so a long run that gets interrupted keeps what it captured
      fs.mkdirSync(out, { recursive: true });
      const tfi = path.join(out, "traces.json");
      const prevI = fs.existsSync(tfi) ? JSON.parse(fs.readFileSync(tfi, "utf8")) : {};
      fs.writeFileSync(tfi, JSON.stringify({ ...prevI, ...traces }, null, 1));
    }
  }
  await browser.close().catch(() => {});
  await srv.close();
}
fs.mkdirSync(out, { recursive: true });
const tf = path.join(out, "traces.json");
const prev = fs.existsSync(tf) ? JSON.parse(fs.readFileSync(tf, "utf8")) : {};
fs.writeFileSync(tf, JSON.stringify({ ...prev, ...traces }, null, 1));
console.log("golden written to", out);
