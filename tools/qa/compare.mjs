#!/usr/bin/env node
// node compare.mjs <baselineDir> <newDir> [--out compare.md] [--shot-mean 0.03] [--shot-blocks 0.25] [--frozen stage01,stage02,stage04]
// Diffs two run dirs (results.json + screenshots) and writes <newDir>/compare.md (or --out).
import fs from "node:fs";
import path from "node:path";
import { PNG } from "pngjs";

const argv = process.argv.slice(2);
const pos = [];
const o = { out: null, shotMean: 0.03, shotBlocks: 0.25, frozen: ["stage01", "stage02", "stage04"] };
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === "--out") o.out = argv[++i];
  else if (argv[i] === "--shot-mean") o.shotMean = Number(argv[++i]);
  else if (argv[i] === "--shot-blocks") o.shotBlocks = Number(argv[++i]);
  else if (argv[i] === "--frozen") o.frozen = argv[++i].split(",");
  else pos.push(argv[i]);
}
if (pos.length < 2) { console.error("usage: node compare.mjs <baselineDir> <newDir> [--out file] [--shot-mean 0.03] [--shot-blocks 0.25] [--frozen stage01,stage02,stage04]"); process.exit(2); }
const [baseDir, newDir] = pos.map((p) => path.resolve(p));
const A = JSON.parse(fs.readFileSync(path.join(baseDir, "results.json"), "utf8"));
const B = JSON.parse(fs.readFileSync(path.join(newDir, "results.json"), "utf8"));

/* metric extractors: dir = which direction is better; rel = relative change needed; abs = absolute change needed */
const M = [
  { k: "fps", get: (e) => e.perf?.stats?.fps, better: "up", rel: 0.03, abs: 2 },
  { k: "p95 ms", get: (e) => e.perf?.stats?.frameMs?.p95, better: "down", rel: 0.1, abs: 1 },
  { k: "max ms", get: (e) => e.perf?.stats?.frameMs?.max, better: "down", rel: 0.25, abs: 17 },
  { k: "frames>33ms", get: (e) => e.perf?.stats?.over33, better: "down", rel: 0.25, abs: 2 },
  { k: "long tasks", get: (e) => e.perf?.stats?.longTasks, better: "down", rel: 0.25, abs: 2 },
  { k: "heap max MB", get: (e) => e.perf?.stats?.heapMaxMB, better: "down", rel: 0.15, abs: 2 },
  { k: "filter/s", get: (e) => e.perf?.stats?.perSec?.filter, better: "down", rel: 0.05, abs: 0.5 },
  { k: "shadowBlur/s", get: (e) => e.perf?.stats?.perSec?.shadowBlur, better: "down", rel: 0.05, abs: 0.5 },
  { k: "radialGrad/s", get: (e) => e.perf?.stats?.perSec?.radialGradient, better: "down", rel: 0.05, abs: 0.5 },
  { k: "linearGrad/s", get: (e) => e.perf?.stats?.perSec?.linearGradient, better: "down", rel: 0.05, abs: 0.5 },
  { k: "getImageData/s", get: (e) => e.perf?.stats?.perSec?.getImageData, better: "down", rel: 0.05, abs: 0.5 },
  { k: "decoded img MB", get: (e) => { const m = e.perf?.memory; return m ? +(m.imageMB + (e.layout?.memory?.cssBackgroundMB || 0)).toFixed(2) : undefined; }, better: "down", rel: 0.05, abs: 0.25 },
  { k: "offscreen cv MB", get: (e) => e.perf?.memory?.offscreenCanvasMB, better: "down", rel: 0.1, abs: 0.25 },
  { k: "offscreen cv n", get: (e) => e.perf?.memory?.offscreenCanvasCount, better: "down", rel: 0.2, abs: 3 },
  { k: "main cv MB", get: (e) => e.perf?.memory?.mainCanvas?.MB, better: "down", rel: 0.1, abs: 0.25 },
  { k: "first frame ms", get: (e) => e.perf?.firstFrameMs ?? e.layout?.timing?.firstFrameMs, better: "down", rel: 0.2, abs: 150 },
  { k: "4x fps", get: (e) => e.perfThrottled?.stats?.fps, better: "up", rel: 0.05, abs: 3 },
  { k: "4x p95 ms", get: (e) => e.perfThrottled?.stats?.frameMs?.p95, better: "down", rel: 0.1, abs: 2 },
  { k: "4x max ms", get: (e) => e.perfThrottled?.stats?.frameMs?.max, better: "down", rel: 0.25, abs: 17 },
  { k: "HUD rows", get: (e) => e.layout?.layout?.hud?.rows, better: "down", rel: 0, abs: 1 },
  { k: "HUD height px", get: (e) => e.layout?.layout?.hud?.height, better: "down", rel: 0.1, abs: 8 },
  { k: "overflowX px", get: (e) => e.layout?.layout?.scroll?.overflowXpx, better: "down", rel: 0, abs: 1 },
  { k: "overflowY px", get: (e) => e.layout?.layout?.scroll?.overflowYpx, better: "down", rel: 0, abs: 8 },
  { k: "frame area %vp", get: (e) => e.layout?.layout?.frame?.viewportAreaPct, better: "up", rel: 0.05, abs: 2 },
  { k: "canvas stretch %", get: (e) => e.layout?.layout?.canvas?.stretchPct, better: "down", rel: 0, abs: 1 },
  { k: "small tap targets", get: (e) => e.layout?.layout?.tapTargets?.small?.length, better: "down", rel: 0, abs: 1 },
  { k: "console/net errors", get: (e) => errCount(e), better: "down", rel: 0, abs: 1 },
  { k: "cross-origin reqs", get: (e) => xoCount(e), better: "down", rel: 0, abs: 1 },
];
function errCount(e) {
  const h = [e.layout?.health, e.perf?.health].filter(Boolean);
  if (!h.length) return undefined;
  return h.reduce((s, x) => s + x.consoleErrors.length + x.pageErrors.length + x.failedRequests.length + x.badStatus.length, 0);
}
function xoCount(e) {
  const h = [e.layout?.health, e.perf?.health].filter(Boolean);
  if (!h.length) return undefined;
  return new Set(h.flatMap((x) => x.crossOrigin)).size;
}
const fmt = (v) => (v == null ? "-" : Number.isInteger(v) ? String(v) : (+v).toFixed(2));

function classify(m, a, b) {
  if (a == null || b == null) return "n/a";
  const d = b - a;
  if (Math.abs(d) < m.abs) return "same";
  const rel = a === 0 ? (d === 0 ? 0 : 1) : Math.abs(d) / Math.abs(a);
  if (rel < m.rel) return "same";
  const worse = m.better === "down" ? d > 0 : d < 0;
  return worse ? "REGRESSION" : "improved";
}

/* ---- screenshot diff ---- */
function readPng(f) { return PNG.sync.read(fs.readFileSync(f)); }
function blockMeans(png, gx, gy) {
  const { width: w, height: h, data } = png;
  const out = new Float32Array(gx * gy * 3), cnt = new Float32Array(gx * gy);
  const step = Math.max(1, Math.floor(Math.min(w, h) / 400)); // subsample for speed
  for (let y = 0; y < h; y += step) {
    const by = Math.min(gy - 1, Math.floor((y / h) * gy));
    for (let x = 0; x < w; x += step) {
      const bx = Math.min(gx - 1, Math.floor((x / w) * gx));
      const i = (y * w + x) * 4, bi = by * gx + bx;
      out[bi * 3] += data[i]; out[bi * 3 + 1] += data[i + 1]; out[bi * 3 + 2] += data[i + 2]; cnt[bi]++;
    }
  }
  for (let i = 0; i < gx * gy; i++) if (cnt[i]) { out[i * 3] /= cnt[i]; out[i * 3 + 1] /= cnt[i]; out[i * 3 + 2] /= cnt[i]; }
  return out;
}
function diffShots(fa, fb) {
  const pa = readPng(fa), pb = readPng(fb);
  if (pa.width !== pb.width || pa.height !== pb.height) return { sizeChanged: true, a: `${pa.width}x${pa.height}`, b: `${pb.width}x${pb.height}` };
  const gx = 24, gy = 24, ma = blockMeans(pa, gx, gy), mb = blockMeans(pb, gx, gy);
  let sum = 0, max = 0, changed = 0;
  for (let i = 0; i < gx * gy; i++) {
    const d = Math.hypot(ma[i * 3] - mb[i * 3], ma[i * 3 + 1] - mb[i * 3 + 1], ma[i * 3 + 2] - mb[i * 3 + 2]) / 441.67;
    sum += d; if (d > max) max = d; if (d > 0.08) changed++;
  }
  return { sizeChanged: false, mean: sum / (gx * gy), max, changedFrac: changed / (gx * gy) };
}

/* ---- main ---- */
const L = [`# GOG QA compare`, ``, `- baseline: \`${baseDir}\` (${A.meta?.date || "?"})`, `- new: \`${newDir}\` (${B.meta?.date || "?"})`,
  `- change classes: REGRESSION / improved judged per metric with a relative + absolute threshold (see METRICS in compare.mjs)`,
  `- screenshots: 24x24 block mean-colour distance (0..1), flagged when mean > ${o.shotMean} or > ${o.shotBlocks * 100}% of blocks differ by > 0.08, or when the size changed. Animated canvases add some noise; sizeChanged means the layout moved.`, ``];
const regs = [], imps = [], shotFlags = [], frozenFlags = [];
const pagesBoth = Object.keys(B.pages).filter((p) => A.pages[p]);
const perPage = [];
for (const p of pagesBoth) {
  const rows = [];
  const vA = A.pages[p].viewports, vB = B.pages[p].viewports;
  for (const vn of Object.keys(vB)) {
    if (!vA[vn]) continue;
    for (const m of M) {
      const a = m.get(vA[vn]), b = m.get(vB[vn]);
      const c = classify(m, a, b);
      if (c === "n/a") continue;
      rows.push({ vn, k: m.k, a, b, c });
      if (c === "REGRESSION") regs.push({ p, vn, k: m.k, a, b });
      if (c === "improved") imps.push({ p, vn, k: m.k, a, b });
    }
    // screenshots
    for (const suffix of ["", "-intro"]) {
      const fa = path.join(baseDir, p, `${vn}${suffix}.png`), fb = path.join(newDir, p, `${vn}${suffix}.png`);
      if (!fs.existsSync(fa) || !fs.existsSync(fb)) continue;
      try {
        const d = diffShots(fa, fb);
        const flagged = d.sizeChanged || d.mean > o.shotMean || d.changedFrac > o.shotBlocks;
        const rec = { p, vn: vn + suffix, d, flagged };
        if (flagged) { shotFlags.push(rec); if (o.frozen.includes(p)) frozenFlags.push(rec); }
      } catch (e) { shotFlags.push({ p, vn: vn + suffix, d: { error: String(e.message || e) }, flagged: true }); }
    }
  }
  perPage.push({ p, rows });
}
const missing = [...Object.keys(A.pages).filter((p) => !B.pages[p]).map((p) => `${p} (missing in new)`), ...Object.keys(B.pages).filter((p) => !A.pages[p]).map((p) => `${p} (new page)`)];

L.push(`## Verdict`, ``, `- regressions: **${regs.length}**, improvements: **${imps.length}**, screenshots flagged: **${shotFlags.length}** (frozen-art stages ${o.frozen.join("/")}: **${frozenFlags.length}**)`);
if (missing.length) L.push(`- pages not in both runs: ${missing.join(", ")}`);
L.push(``);

const shotLine = (r) => r.d.error ? `${r.p} @ ${r.vn}: could not diff (${r.d.error})` : r.d.sizeChanged ? `${r.p} @ ${r.vn}: size ${r.d.a} -> ${r.d.b}` : `${r.p} @ ${r.vn}: mean ${r.d.mean.toFixed(3)}, max block ${r.d.max.toFixed(2)}, ${(r.d.changedFrac * 100).toFixed(0)}% blocks changed`;
L.push(`## Frozen-art screenshots changed (stages ${o.frozen.join(", ")})`, ``, ...(frozenFlags.length ? frozenFlags.map((r) => `- ${shotLine(r)}`) : [`_none beyond threshold_`]), ``);

L.push(`## Regressions`, ``, ...(regs.length ? [`| page | viewport | metric | baseline | new |`, `|---|---|---|---|---|`, ...regs.map((r) => `| ${r.p} | ${r.vn} | ${r.k} | ${fmt(r.a)} | ${fmt(r.b)} |`)] : [`_none_`]), ``);
L.push(`## Improvements`, ``, ...(imps.length ? [`| page | viewport | metric | baseline | new |`, `|---|---|---|---|---|`, ...imps.map((r) => `| ${r.p} | ${r.vn} | ${r.k} | ${fmt(r.a)} | ${fmt(r.b)} |`)] : [`_none_`]), ``);

// per-page averages table
L.push(`## Per-page means across shared viewports (baseline -> new)`, ``);
const keyMetrics = ["fps", "p95 ms", "max ms", "filter/s", "shadowBlur/s", "radialGrad/s", "linearGrad/s", "decoded img MB", "offscreen cv MB", "main cv MB", "first frame ms", "4x fps", "4x p95 ms", "HUD rows", "small tap targets"];
L.push(`| page | ${keyMetrics.join(" | ")} |`, `|---|${keyMetrics.map(() => "---").join("|")}|`);
for (const { p, rows } of perPage) {
  const cells = keyMetrics.map((k) => {
    const r = rows.filter((x) => x.k === k);
    if (!r.length) return "-";
    const avg = (arr) => arr.reduce((s, v) => s + v, 0) / arr.length;
    const a = avg(r.map((x) => x.a)), b = avg(r.map((x) => x.b));
    return `${fmt(a)} -> ${fmt(b)}`;
  });
  L.push(`| ${p} | ${cells.join(" | ")} |`);
}
L.push(``, `## All screenshot changes beyond threshold`, ``, ...(shotFlags.length ? shotFlags.map((r) => `- ${shotLine(r)}${o.frozen.includes(r.p) ? "  **(frozen art)**" : ""}`) : [`_none_`]), ``);

const outFile = path.resolve(o.out || path.join(newDir, "compare.md"));
fs.writeFileSync(outFile, L.join("\n"));
console.log(`wrote ${outFile}\nregressions ${regs.length}, improvements ${imps.length}, screenshots flagged ${shotFlags.length} (frozen ${frozenFlags.length})`);
