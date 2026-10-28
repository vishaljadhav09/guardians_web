#!/usr/bin/env node
// Play a stage headlessly. CLI:
//   node play.mjs --root <siteRoot> --stage stage03 [--mode smoke|win|lose] [--seconds 20] [--viewport 1366x768]
//                 [--shots <dir>] [--coach] [--software]
// Library (import from a stage agent's own script):
//   import { openStage, smokePlay, playToWin, playToLose } from "<repo>/tools/qa/play.mjs";
//   const s = await openStage({ root, stage: "stage03", viewport: "390x844" });
//   await s.smoke(20); await s.close();
//
// The window.__dbg hook technique: the static server rewrites the stage HTML on the fly (the file on disk is
// untouched) and inserts lib/dbg-hooks.mjs's snippet just before the stage IIFE's closing `})();`, so
// getState()/forceWin()/forceLose() can see the stage's private variables. Add a hook entry for new stages.
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { startServer } from "./lib/server.mjs";
import { launch, openPage, dismissIntro, playActivity, crossOrigin, sleep, PAGES } from "./lib/driver.mjs";
import { ALL, pick } from "./lib/viewports.mjs";
import { injectHook, HOOKS } from "./lib/dbg-hooks.mjs";

/** Opens a stage with the dbg hook, dismisses the guardian intro, returns a session with helpers. */
export async function openStage({ root, stage, viewport = "1366x768", coach = false, dbg = true, shotsDir = null, throttle = 1 }) {
  const def = PAGES[stage];
  if (!def || def.kind !== "stage") throw new Error(`unknown stage "${stage}" (known: ${Object.keys(PAGES).filter((k) => k !== "hub").join(", ")})`);
  const vp = pick(viewport)[0];
  const stageFile = def.file.replace(/^stages\//, "");
  const srv = await startServer(path.resolve(root), {
    transform: (rel, body) => {
      if (!dbg || !rel.endsWith(stageFile) || !rel.startsWith("stages/")) return null;
      const out = injectHook(body.toString("utf8"), stage);
      return out ? Buffer.from(out, "utf8") : null;
    },
  });
  const browser = await launch();
  const h = await openPage(browser, vp, { origin: srv.origin, skipCoach: !coach, throttle });
  const page = h.page;
  await page.goto(`${srv.origin}/${def.file}`, { waitUntil: "load", timeout: 45000 });
  const intro = await dismissIntro(page);
  await sleep(1000);
  const shots = [];
  const session = {
    page, vp, def, intro, log: h.log, origin: srv.origin,
    hasDbg: await page.evaluate(() => !!window.__dbg),
    state: () => page.evaluate(() => (window.__dbg ? window.__dbg.getState() : null)),
    hud: () => page.evaluate(() => (document.querySelector(".stage-hud") || document.body).innerText.replace(/\s+/g, " ").trim()),
    shot: async (name) => { if (!shotsDir) return null; fs.mkdirSync(shotsDir, { recursive: true }); const f = path.join(shotsDir, `${stage}-${vp.name}-${name}.png`); await page.screenshot({ path: f }); shots.push(f); return f; },
    health: () => ({
      consoleErrors: h.log.console.filter((c) => c.type === "error"), pageErrors: h.log.pageErrors, failedRequests: h.log.failed,
      badStatus: h.log.badStatus, crossOrigin: crossOrigin(h.log.requests, srv.origin),
    }),
    /** random inputs for `seconds`; resolves with state/HUD before+after */
    smoke: async (seconds = 20) => smokePlay(session, seconds),
    playToWin: async () => playToOutcome(session, "forceWin"),
    playToLose: async () => playToOutcome(session, "forceLose"),
    close: async () => { await h.close(); await browser.close().catch(() => {}); await srv.close(); },
  };
  return session;
}

/** Waits for the win/lose popup (GOGUi.showOverlay: .gog-overlay that is not the guardian beat). */
export async function waitForOutcomeOverlay(page, timeout = 25000) {
  try {
    await page.waitForFunction(() => {
      const o = Array.from(document.querySelectorAll(".gog-overlay:not(.gog-guardian-beat):not(.gog-info-modal)")).find((e) => e.offsetParent !== null || getComputedStyle(e).position === "fixed");
      return !!o;
    }, { timeout });
  } catch { return null; }
  return page.evaluate(() => {
    const o = document.querySelector(".gog-overlay:not(.gog-guardian-beat):not(.gog-info-modal)");
    return { title: (o.querySelector("h1,h2,h3,.gog-overlay-title")?.textContent || "").trim(), text: o.innerText.replace(/\s+/g, " ").slice(0, 240), buttons: Array.from(o.querySelectorAll("button, a")).map((b) => b.textContent.trim()) };
  });
}

export async function smokePlay(s, seconds = 20) {
  const before = { state: await s.state(), hud: await s.hud() };
  await s.shot("smoke-start");
  await s.page.evaluate(() => window.__qa.start());
  await playActivity(s.page, s.def.input, seconds * 1000);
  const after = { state: await s.state(), hud: await s.hud() };
  await s.shot("smoke-end");
  const firstFrame = await s.page.evaluate(() => window.__qa && window.__qa.firstFrameAt);
  const frames = await s.page.evaluate(() => window.__qa.stop());
  const health = s.health();
  const hudChanged = before.hud !== after.hud;
  const stateChanged = JSON.stringify(before.state) !== JSON.stringify(after.state);
  const problems = [];
  if (!s.intro.shown) problems.push("guardian intro never appeared");
  if (s.intro.stuck) problems.push("guardian intro would not dismiss");
  if (firstFrame == null) problems.push("canvas never painted");
  if (health.consoleErrors.length || health.pageErrors.length) problems.push(`${health.consoleErrors.length + health.pageErrors.length} console/page error(s)`);
  if (health.failedRequests.length || health.badStatus.length) problems.push("failed/4xx requests");
  if (health.crossOrigin.length) problems.push("cross-origin requests: " + health.crossOrigin.join(", "));
  if (!hudChanged && !stateChanged) problems.push("HUD/state did not change during play");
  return { ok: problems.length === 0, problems, hudChanged, stateChanged, before, after, health, perf: { fps: frames.fps, p95: frames.frameMs.p95, max: frames.frameMs.max } };
}

async function playToOutcome(s, fn) {
  if (!s.hasDbg) throw new Error("no window.__dbg hook for this stage (see lib/dbg-hooks.mjs)");
  // give the stage a moment of real play so counters/state are non-trivial
  await playActivity(s.page, s.def.input, 3000);
  await s.page.evaluate((f) => window.__dbg[f](), fn);
  const overlay = await waitForOutcomeOverlay(s.page);
  await sleep(600);
  await s.shot(fn === "forceWin" ? "win" : "lose");
  return { overlay, state: await s.state(), health: s.health() };
}

export const smokePlayFn = smokePlay;

/* ---------------- CLI ---------------- */
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const a = { mode: "smoke", seconds: 20, viewport: "1366x768" };
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === "--root") a.root = argv[++i];
    else if (k === "--stage") a.stage = argv[++i];
    else if (k === "--mode") a.mode = argv[++i];
    else if (k === "--seconds") a.seconds = Number(argv[++i]);
    else if (k === "--viewport") a.viewport = argv[++i];
    else if (k === "--shots") a.shots = argv[++i];
    else if (k === "--coach") a.coach = true;
    else if (k === "--software") process.env.QA_SOFTWARE = "1";
    else { console.error("unknown arg " + k); process.exit(2); }
  }
  if (!a.root || !a.stage) { console.error("usage: node play.mjs --root <dir> --stage stage03 [--mode smoke|win|lose] [--seconds 20] [--viewport 1366x768] [--shots dir] [--coach]"); process.exit(2); }
  const s = await openStage({ root: a.root, stage: a.stage, viewport: a.viewport, coach: !!a.coach, shotsDir: a.shots ? path.resolve(a.shots) : null });
  let code = 0;
  try {
    console.log(`dbg hook: ${s.hasDbg ? "yes" : "NO (no entry in lib/dbg-hooks.mjs, or anchor not found)"}; intro shown: ${s.intro.shown}`);
    if (a.mode === "smoke") {
      const r = await s.smoke(a.seconds);
      console.log(JSON.stringify({ ok: r.ok, problems: r.problems, hudChanged: r.hudChanged, stateChanged: r.stateChanged, stateBefore: r.before.state, stateAfter: r.after.state, perf: r.perf, errors: r.health.consoleErrors.concat(r.health.pageErrors) }, null, 1));
      code = r.ok ? 0 : 1;
    } else if (a.mode === "win" || a.mode === "lose") {
      const r = await (a.mode === "win" ? s.playToWin() : s.playToLose());
      console.log(JSON.stringify({ overlay: r.overlay, state: r.state, errors: r.health.consoleErrors.concat(r.health.pageErrors) }, null, 1));
      code = r.overlay ? 0 : 1;
    } else { console.error("mode must be smoke|win|lose"); code = 2; }
  } catch (e) { console.error(e); code = 1; }
  await s.close();
  process.exit(code);
}
