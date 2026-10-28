// Builds summary.md from <dir>/results.json  (also usable as: node lib/report.mjs <dir>)
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const MB = (b) => (b / 1048576).toFixed(2);
const f1 = (x) => (x == null ? "-" : Number(x).toFixed(1));
const PAGE_ORDER = ["hub", "stage01", "stage02", "stage03", "stage04", "stage05"];

export function writeSummary(dir) {
  const res = JSON.parse(fs.readFileSync(path.join(dir, "results.json"), "utf8"));
  const L = [];
  const pages = PAGE_ORDER.filter((p) => res.pages[p]);
  const vpsOf = (p) => Object.entries(res.pages[p].viewports);
  const pick = (p, name) => res.pages[p].viewports[name];
  const imgMB = (e) => {
    const m = e.perf?.memory || e.layout?.memory;
    return m ? +(m.imageMB + (e.layout?.memory?.cssBackgroundMB || 0)).toFixed(2) : null;
  };

  L.push(`# GOG QA summary`, ``, `- root: \`${res.meta.root}\``, `- run: ${res.meta.date}  Chrome: ${res.meta.chrome}`,
    `- thresholds: fps>=55, p95<=20ms, max<=33ms, no overflow, no console errors, zero cross-origin, tap>=48 (44 compact landscape)`,
    `- counters are canvas-2D calls per second during the measured play window (instrumentation wrappers are active in every run)`, ``);

  const REF = ["1920x1080", "1366x768", "1280x720"].find((n) => pages.some((p) => pick(p, n))) || null;
  if (REF) {
    L.push(`## Per-stage headline @ ${REF} (4x CPU throttle in the last columns)`, ``,
      `| page | fps | p50 | p95 | max ms | >33ms | long tasks | heap MB | filter/s | shadowBlur/s | radialGrad/s | linearGrad/s | getImageData/s | img MB (n) | offscreen cv MB (n) | main cv MB | first frame ms | 4x fps | 4x p95 | 4x max |`,
      `|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|`);
    for (const p of pages) {
      const e = pick(p, REF);
      if (!e) continue;
      const s = e.perf?.stats, m = e.perf?.memory || e.layout?.memory, t = e.perfThrottled?.stats;
      if (!s) { L.push(`| ${p} | (perf failed: ${e.perf?.error || "n/a"}) |`); continue; }
      const c = s.perSec;
      L.push(`| ${p} | ${s.fps} | ${f1(s.frameMs.p50)} | ${f1(s.frameMs.p95)} | ${f1(s.frameMs.max)} | ${s.over33} | ${s.longTasks} | ${s.heapMaxMB ?? "-"} | ${c.filter} | ${c.shadowBlur} | ${c.radialGradient} | ${c.linearGradient} | ${c.getImageData} | ${imgMB(e) ?? "-"} (${m ? m.imageCount : "-"}) | ${m ? m.offscreenCanvasMB : "-"} (${m ? m.offscreenCanvasCount : "-"}) | ${m?.mainCanvas?.MB ?? "-"} | ${f1(e.perf.firstFrameMs)} | ${t ? t.fps : "-"} | ${t ? f1(t.frameMs.p95) : "-"} | ${t ? f1(t.frameMs.max) : "-"} |`);
    }
    L.push(``);
  }

  L.push(`## Worst case across all viewports (unthrottled)`, ``,
    `| page | viewports | min fps (at) | worst p95 (at) | worst max (at) | max filter/s | max shadowBlur/s | max gradients/s | max img MB | max offscreen MB | max main cv MB |`,
    `|---|---|---|---|---|---|---|---|---|---|---|`);
  for (const p of pages) {
    let minFps = [1e9, ""], p95 = [0, ""], mx = [0, ""], filt = 0, sb = 0, gr = 0, im = 0, off = 0, mc = 0, n = 0;
    for (const [vn, e] of vpsOf(p)) {
      const s = e.perf?.stats; if (!s) continue; n++;
      if (s.fps < minFps[0]) minFps = [s.fps, vn];
      if (s.frameMs.p95 > p95[0]) p95 = [s.frameMs.p95, vn];
      if (s.frameMs.max > mx[0]) mx = [s.frameMs.max, vn];
      filt = Math.max(filt, s.perSec.filter); sb = Math.max(sb, s.perSec.shadowBlur); gr = Math.max(gr, s.perSec.radialGradient + s.perSec.linearGradient);
      im = Math.max(im, imgMB(e) || 0); off = Math.max(off, e.perf.memory.offscreenCanvasMB); mc = Math.max(mc, e.perf.memory.mainCanvas?.MB || 0);
    }
    if (!n) { L.push(`| ${p} | 0 | no perf data |`); continue; }
    L.push(`| ${p} | ${n} | ${minFps[0]} (${minFps[1]}) | ${f1(p95[0])} (${p95[1]}) | ${f1(mx[0])} (${mx[1]}) | ${filt} | ${sb} | ${gr} | ${im.toFixed(2)} | ${off.toFixed(2)} | ${mc.toFixed(2)} |`);
  }
  L.push(``);

  const thr = [];
  for (const p of pages) for (const [vn, e] of vpsOf(p)) if (e.perfThrottled?.stats) thr.push([p, vn, e.perfThrottled.stats, e.perfThrottled.throttle]);
  if (thr.length) {
    L.push(`## CPU-throttled runs (small viewports)`, ``, `| page | viewport | rate | fps | p95 | max | >33ms | long tasks |`, `|---|---|---|---|---|---|---|---|`);
    for (const [p, vn, s, r] of thr) L.push(`| ${p} | ${vn} | ${r}x | ${s.fps} | ${f1(s.frameMs.p95)} | ${f1(s.frameMs.max)} | ${s.over33} | ${s.longTasks} |`);
    L.push(``);
  }

  L.push(`## Per-viewport fps / p95 (unthrottled)`, ``);
  const vpNames = [...new Set(pages.flatMap((p) => vpsOf(p).map(([n]) => n)))];
  L.push(`| viewport | ${pages.join(" | ")} |`, `|---|${pages.map(() => "---").join("|")}|`);
  for (const vn of vpNames) {
    L.push(`| ${vn} | ${pages.map((p) => { const s = pick(p, vn)?.perf?.stats; return s ? `${s.fps} / ${f1(s.frameMs.p95)}` : "-"; }).join(" | ")} |`);
  }
  L.push(``, `## Load time and memory (first-frame ms / decoded images MB / offscreen canvas MB) per viewport`, ``);
  L.push(`| viewport | ${pages.join(" | ")} |`, `|---|${pages.map(() => "---").join("|")}|`);
  for (const vn of vpNames) {
    L.push(`| ${vn} | ${pages.map((p) => {
      const e = pick(p, vn); if (!e) return "-";
      const m = e.perf?.memory || e.layout?.memory;
      const ff = e.perf?.firstFrameMs ?? e.layout?.timing?.firstFrameMs;
      return m ? `${ff != null ? Math.round(ff) : "-"} / ${imgMB(e)} / ${m.offscreenCanvasMB}` : "-";
    }).join(" | ")} |`);
  }
  L.push(``);

  L.push(`## Layout problems (per page, per viewport)`, ``, `Italic entries are informational (frame size / HUD rows); plain entries are problems.`, ``);
  for (const p of pages) {
    L.push(`### ${p}`, ``);
    let any = false;
    for (const [vn, e] of vpsOf(p)) {
      const lay = e.layout?.layout;
      if (!lay) { L.push(`- **${vn}**: layout pass failed (${e.layout?.error || "n/a"})`); any = true; continue; }
      const issues = [];
      if (lay.scroll.overflowX) issues.push(`horizontal overflow +${lay.scroll.overflowXpx}px`);
      if (lay.scroll.overflowY) issues.push(`page scrolls vertically +${lay.scroll.overflowYpx}px (doc ${lay.scroll.scrollH} vs viewport ${lay.viewport.h})`);
      if (lay.frame) {
        if (!lay.frame.fullyInViewport) issues.push(`canvas frame not fully in viewport (frame ${lay.frame.w}x${lay.frame.h} at y=${lay.frame.y}, bottom ${lay.frame.bottom}; viewport ${lay.viewport.w}x${lay.viewport.h})`);
        issues.push(`_frame ${lay.frame.w}x${lay.frame.h} aspect ${lay.frame.aspect}, ${lay.frame.viewportAreaPct}% of viewport_`);
      }
      if (lay.canvas && lay.canvas.stretchPct > 3) issues.push(`canvas bitmap ${lay.canvas.bitmapW}x${lay.canvas.bitmapH} (aspect ${lay.canvas.bitmapAspect}) stretched to CSS aspect ${lay.canvas.cssAspect} (${lay.canvas.stretchPct}% off)`);
      if (lay.hud) {
        const compact = e.viewport.compactLandscape || e.viewport.kind === "phonePortrait";
        if (lay.hud.rows > (compact ? 1 : 2)) issues.push(`HUD ${lay.hud.rows} rows (direct-child tops ${lay.hud.directChildTopCount}), ${lay.hud.height}px tall`);
        else issues.push(`_HUD ${lay.hud.rows} row(s), ${lay.hud.height}px_`);
        if (lay.hud.clipped.length) issues.push(`HUD clipped: ${lay.hud.clipped.join(", ")}`);
      }
      if (lay.tapTargets.small.length) issues.push(`small tap targets (<${lay.tapTargets.threshold}px): ` + lay.tapTargets.small.slice(0, 8).map((t) => `${t.el} "${t.text}" ${t.w}x${t.h}`).join("; "));
      if (e.layout.intro?.card?.clipped) issues.push(`guardian intro card clipped by viewport (${e.layout.intro.card.w}x${e.layout.intro.card.h})`);
      if (e.layout.intro?.stuck) issues.push(`intro overlay would not dismiss`);
      if (lay.overlays.length) issues.push(`overlay still visible after intro: ${lay.overlays.join(", ")}`);
      const hi = e.layout.hubIntro;
      if (hi?.tapTargets?.small?.length) issues.push(`hub first-visit story overlay: small tap targets: ` + hi.tapTargets.small.map((t) => `${t.el} "${t.text}" ${t.w}x${t.h}`).join("; "));
      if (hi?.overflow?.overflowX) issues.push(`hub intro overlay: horizontal overflow`);
      const cards = lay.cards;
      if (p !== "hub" && cards && !cards.infoBtn.visible && !(cards.guardian.visible || cards.play.visible)) issues.push(`neither guardian/play cards nor info button visible`);
      const real = issues.filter((i) => !i.startsWith("_"));
      if (real.length) any = true;
      L.push(`- **${vn}**${real.length ? "" : " (ok)"}: ${issues.join(" | ")}`);
    }
    if (!any) L.push(`_no layout problems_`);
    L.push(``);
  }

  L.push(`## Console / network issues`, ``);
  for (const p of pages) {
    const errs = new Map();
    const add = (k) => errs.set(k, (errs.get(k) || 0) + 1);
    const xo = new Set();
    for (const [, e] of vpsOf(p)) for (const h of [e.layout?.health, e.perf?.health]) {
      if (!h) continue;
      h.consoleErrors.forEach((c) => add(`console.error: ${c.text}`));
      h.consoleWarnings.forEach((c) => add(`console.warn: ${c.text}`));
      h.pageErrors.forEach((c) => add(`pageerror: ${c}`));
      h.failedRequests.forEach((c) => add(`request failed: ${c.url} ${c.err}`));
      h.badStatus.forEach((c) => add(`HTTP ${c.status}: ${c.url}`));
      h.crossOrigin.forEach((u) => xo.add(u));
    }
    L.push(`### ${p}`);
    if (!errs.size && !xo.size) L.push(`_clean_`);
    for (const [k, n] of errs) L.push(`- ${k} (x${n})`);
    if (xo.size) L.push(`- CROSS-ORIGIN: ${[...xo].join(", ")}`);
    L.push(`- distinct request URLs: ${res.pages[p].requestUrls?.length ?? "?"}`, ``);
  }

  const a = res.assets;
  if (a) {
    L.push(`## APK-relevant sizes (snapshot)`, ``, `- stages/assets total: **${MB(a.assetsBytes)} MB**; html/js/css code: ${MB(a.codeBytes)} MB; whole root: ${MB(a.totalBytes)} MB`,
      `- by type: ${Object.entries(a.byType).sort((x, y) => y[1] - x[1]).map(([k, v]) => `${k} ${MB(v)} MB`).join(", ")}`, ``,
      `| group | total MB | breakdown |`, `|---|---|---|`);
    for (const [k, v] of Object.entries(a.byStage).sort()) L.push(`| ${k} | ${MB(v.total)} | ${Object.entries(v.byType).sort((x, y) => y[1] - x[1]).map(([t, b]) => `${t} ${MB(b)}`).join(", ")} |`);
    L.push(``, `Largest files:`, ...a.largest.slice(0, 10).map((f) => `- ${f.file} - ${MB(f.bytes)} MB`), ``);
  }

  fs.writeFileSync(path.join(dir, "summary.md"), L.join("\n"));
  return path.join(dir, "summary.md");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href && process.argv[2]) {
  console.log(writeSummary(path.resolve(process.argv[2])));
}
