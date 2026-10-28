#!/usr/bin/env node
// GOG QA harness: serves a site root and, for every page x viewport, collects screenshots, layout metrics,
// console/network health, fps/frame-time/heap, decoded-image + offscreen-canvas memory, load time, and
// runtime canvas-cost counters (ctx.filter / shadowBlur / gradients per second). See README.md.
import fs from "node:fs";
import path from "node:path";
import { startServer } from "./lib/server.mjs";
import { ALL, SMALL_NAMES, pick } from "./lib/viewports.mjs";
import { launch, openPage, dismissIntro, playActivity, crossOrigin, sleep, PAGES } from "./lib/driver.mjs";
import { layoutMetrics, cssBackgrounds } from "./lib/layout.mjs";
import { assetSizes } from "./lib/assets.mjs";
import { writeSummary } from "./lib/report.mjs";

function parseArgs(argv) {
  const a = { root: null, out: null, only: null, viewports: "all", throttle: 4, perfSeconds: 8, layout: true, perf: true, timeout: 120000 };
  for (let i = 2; i < argv.length; i++) {
    const k = argv[i];
    const v = () => argv[++i];
    if (k === "--root") a.root = v();
    else if (k === "--out") a.out = v();
    else if (k === "--only") a.only = v().split(",");
    else if (k === "--viewports") a.viewports = v();
    else if (k === "--throttle") a.throttle = Number(v());
    else if (k === "--perf-seconds") a.perfSeconds = Number(v());
    else if (k === "--no-perf") a.perf = false;
    else if (k === "--resume") a.resume = true;
    else if (k === "--software") process.env.QA_SOFTWARE = "1";
    else if (k === "--no-layout") a.layout = false;
    else if (k === "--timeout") a.timeout = Number(v());
    else if (k === "-h" || k === "--help") { console.log("node run.mjs --root <dir> --out <dir> [--only stage01,hub] [--viewports small|all|1920x1080,...] [--throttle 4] [--perf-seconds 8] [--no-perf] [--no-layout] [--resume] [--software]"); process.exit(0); }
    else throw new Error("unknown arg " + k);
  }
  if (!a.root || !a.out) throw new Error("--root and --out are required");
  a.root = path.resolve(a.root); a.out = path.resolve(a.out);
  return a;
}

const withTimeout = (p, ms, label) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`timeout ${label} after ${ms}ms`)), ms))]);

async function gotoPage(h, url) {
  await h.page.goto(url, { waitUntil: "load", timeout: 45000 });
}

async function waitFirstFrame(page, ms = 6000) {
  if (!(await page.evaluate(() => !!document.querySelector("canvas")).catch(() => false))) return null;
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const t = await page.evaluate(() => window.__qa && window.__qa.firstFrameAt).catch(() => null);
    if (t != null) return t;
    await sleep(150);
  }
  return null;
}

function healthOf(h, origin) {
  const consoleErrors = h.log.console.filter((c) => c.type === "error");
  return {
    consoleErrors, consoleWarnings: h.log.console.filter((c) => c.type === "warning"),
    pageErrors: h.log.pageErrors, failedRequests: h.log.failed, badStatus: h.log.badStatus,
    requestCount: h.log.requests.length, crossOrigin: crossOrigin(h.log.requests, origin), transferKB: Math.round(h.log.bytes / 1024),
  };
}

/** Hub only: the first-visit story overlay. Capture its layout + a screenshot, then skip it. */
async function hubStory(h, vp, outFile, args) {
  try { await h.page.waitForSelector(".intro-btn-secondary", { timeout: 20000 }); } catch { return { shown: false }; }
  const minTap = vp.compactLandscape ? 44 : 48;
  const layout = await h.page.evaluate(layoutMetrics, minTap);
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  await h.page.screenshot({ path: outFile.replace(/.png$/, "-intro.png"), fullPage: true });
  await h.page.evaluate(() => document.querySelector(".intro-btn-secondary").click());
  await sleep(900);
  return { shown: true, tapTargets: layout.tapTargets, overflow: layout.scroll };
}

async function layoutPass(browser, def, vp, origin, outFile, args) {
  const h = await openPage(browser, vp, { origin, skipCoach: false });
  try {
    const t0 = Date.now();
    await gotoPage(h, `${origin}/${def.file}`);
    const loadMs = Date.now() - t0;
    let intro = { shown: false };
    let hubIntro = null;
    if (def.kind === "stage") intro = await dismissIntro(h.page);
    else hubIntro = await hubStory(h, vp, outFile, args);
    const firstFrameMs = await waitFirstFrame(h.page);
    await sleep(1200); // let the coach banner / first frames settle
    const minTap = vp.compactLandscape ? 44 : 48;
    const layout = await h.page.evaluate(layoutMetrics, minTap);
    const memory = await h.page.evaluate(() => window.__qa.memory());
    const bg = await h.page.evaluate(cssBackgrounds).catch(() => []);
    memory.cssBackgroundMB = +(bg.reduce((s, b) => s + b.bytes, 0) / 1048576).toFixed(2);
    memory.cssBackgrounds = bg;
    const timing = await h.page.evaluate(() => {
      const n = performance.getEntriesByType("navigation")[0] || {};
      return { domContentLoadedMs: Math.round(n.domContentLoadedEventEnd || 0), loadEventMs: Math.round(n.loadEventEnd || 0) };
    });
    fs.mkdirSync(path.dirname(outFile), { recursive: true });
    await h.page.screenshot({ path: outFile, fullPage: true });
    return { layout, memory, intro, hubIntro, timing: { ...timing, navLoadMs: loadMs, firstFrameMs, introShownMs: intro.ms ?? null }, health: healthOf(h, origin), requestUrls: [...new Set(h.log.requests.map((u) => u.replace(origin, "")))] };
  } finally { await h.close(); }
}

async function perfPass(browser, def, vp, origin, throttle, args) {
  const h = await openPage(browser, vp, { origin, skipCoach: true, throttle });
  try {
    await gotoPage(h, `${origin}/${def.file}`);
    let intro = { shown: false };
    if (def.kind === "stage") intro = await dismissIntro(h.page);
    const firstFrameMs = await waitFirstFrame(h.page);
    await sleep(1000);
    await h.page.evaluate(() => window.__qa.start());
    if (def.kind === "hub") {
      // hover/scroll around the hub map
      const end = Date.now() + args.perfSeconds * 1000;
      while (Date.now() < end) {
        await h.page.mouse.move(Math.random() * vp.width, Math.random() * vp.height, { steps: 5 }).catch(() => {});
        await sleep(120);
      }
    } else {
      await playActivity(h.page, def.input, args.perfSeconds * 1000);
    }
    const stats = await h.page.evaluate(() => window.__qa.stop());
    const memory = await h.page.evaluate(() => window.__qa.memory());
    const endState = await h.page.evaluate(() => ({ overlay: Array.from(document.querySelectorAll(".gog-overlay")).map((o) => (o.querySelector("h2,h3")?.textContent || "").slice(0, 40)) }));
    return { stats, memory, endState, firstFrameMs, introStuck: !!intro.stuck, throttle, health: healthOf(h, origin) };
  } finally { await h.close(); }
}

// 33ms budget + 0.5ms for rAF timestamp quantisation (a clean 2-frame hitch reads 33.4)
const MAX_FRAME_MS = 33.5;
const P95_MS = 20;

function evaluate(entry, vp) {
  const f = [];
  const L = entry.layout?.layout, P = entry.perf?.stats;
  if (P) {
    if (P.fps < 55) f.push(`fps ${P.fps}<55`);
    if (P.frameMs.p95 > P95_MS) f.push(`p95 ${P.frameMs.p95.toFixed(1)}>20`);
    if (P.frameMs.max > MAX_FRAME_MS) f.push(`max ${P.frameMs.max.toFixed(1)}>33`);
  }
  if (L) {
    if (L.scroll.overflowX) f.push(`overflowX +${L.scroll.overflowXpx}px`);
    if (vp.kind === "phonePortrait" && L.scroll.overflowY) f.push(`overflowY +${L.scroll.overflowYpx}px (phone portrait should fit)`);
    if (L.tapTargets.small.length) f.push(`${L.tapTargets.small.length} tap target(s) <${L.tapTargets.threshold}px`);
  }
  const hi = entry.layout?.hubIntro;
  if (hi?.tapTargets?.small?.length) f.push(`${hi.tapTargets.small.length} tap target(s) <${hi.tapTargets.threshold}px in hub intro overlay`);
  const hl = entry.layout?.health;
  const errs = [...(hl?.consoleErrors || []), ...(entry.perf?.health?.consoleErrors || [])].length + (hl?.pageErrors?.length || 0) + (hl?.failedRequests?.length || 0) + (hl?.badStatus?.length || 0);
  if (errs) f.push(`${errs} console/network error(s)`);
  const xo = new Set([...(hl?.crossOrigin || []), ...(entry.perf?.health?.crossOrigin || [])]);
  if (xo.size) f.push(`${xo.size} cross-origin request(s)`);
  return f;
}

async function main() {
  const args = parseArgs(process.argv);
  const vps = pick(args.viewports);
  const names = args.only || Object.keys(PAGES);
  for (const n of names) if (!PAGES[n]) throw new Error(`unknown page ${n}; known: ${Object.keys(PAGES).join(", ")}`);
  fs.mkdirSync(args.out, { recursive: true });
  const resultsFile = path.join(args.out, "results.json");
  let results = { meta: {}, assets: null, pages: {} };
  try { results = JSON.parse(fs.readFileSync(resultsFile, "utf8")); } catch {}
  results.meta = { root: args.root, date: new Date().toISOString(), args: { ...args, root: undefined, out: undefined }, node: process.version };
  results.assets = assetSizes(args.root);

  const srv = await startServer(args.root);
  const browser = await launch();
  results.meta.chrome = await browser.version();
  console.log(`serving ${args.root} at ${srv.origin}; ${names.length} page(s) x ${vps.length} viewport(s)`);
  const save = () => fs.writeFileSync(resultsFile, JSON.stringify(results, null, 1));

  try {
    for (const name of names) {
      const def = PAGES[name];
      const pageRes = (results.pages[name] ||= { file: def.file, viewports: {} });
      for (const vp of vps) {
        // a partial run (--no-layout / --no-perf) keeps the passes it did not redo
        const prev = pageRes.viewports[vp.name];
        if (args.resume && prev && prev.layout && !prev.layout.error && prev.perf && !prev.perf.error && (!SMALL_NAMES.includes(vp.name) || args.throttle <= 1 || (prev.perfThrottled && !prev.perfThrottled.error))) continue;
        const entry = args.layout && args.perf ? {} : { ...(pageRes.viewports[vp.name] || {}) };
        const tag = `${name} @ ${vp.name}`;
        const t0 = Date.now();
        if (args.layout) {
          try {
            entry.layout = await withTimeout(layoutPass(browser, def, vp, srv.origin, path.join(args.out, name, `${vp.name}.png`), args), args.timeout, "layout");
            if (!pageRes.requestUrls) pageRes.requestUrls = entry.layout.requestUrls;
            delete entry.layout.requestUrls;
          } catch (e) { entry.layout = { error: String(e.message || e) }; console.log(`  ! layout failed ${tag}: ${entry.layout.error}`); }
        }
        if (args.perf) {
          try { entry.perf = await withTimeout(perfPass(browser, def, vp, srv.origin, 1, args), args.timeout, "perf"); }
          catch (e) { entry.perf = { error: String(e.message || e) }; console.log(`  ! perf failed ${tag}: ${entry.perf.error}`); }
          if (SMALL_NAMES.includes(vp.name) && args.throttle > 1) {
            try { entry.perfThrottled = await withTimeout(perfPass(browser, def, vp, srv.origin, args.throttle, args), args.timeout, "perfThrottled"); }
            catch (e) { entry.perfThrottled = { error: String(e.message || e) }; console.log(`  ! throttled perf failed ${tag}: ${entry.perfThrottled.error}`); }
          }
        }
        entry.viewport = { name: vp.name, kind: vp.kind, w: vp.width, h: vp.height, dpr: vp.deviceScaleFactor, compactLandscape: vp.compactLandscape };
        entry.failures = evaluate(entry, vp);
        pageRes.viewports[vp.name] = entry;
        save();
        const p = entry.perf?.stats;
        console.log(`${tag.padEnd(24)} ${((Date.now() - t0) / 1000).toFixed(0)}s  fps ${p ? p.fps : "-"} p95 ${p ? p.frameMs.p95?.toFixed(1) : "-"} max ${p ? p.frameMs.max?.toFixed(0) : "-"}  ${entry.failures.length ? "FAIL: " + entry.failures.join("; ") : "ok"}`);
      }
    }
  } finally {
    save();
    await browser.close().catch(() => {});
    await srv.close();
  }
  writeSummary(args.out);
  console.log(`done. results: ${resultsFile}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
