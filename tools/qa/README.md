# GOG QA harness (dev-only)

Headless-Chrome harness for performance, layout and smoke checks of the web game. It lives in `tools/qa/`,
has its own `package.json` (deps: `puppeteer-core`, `pngjs`) and is **not** part of the shipped site / APK
(`tools/qa/node_modules` and `tools/qa/out` are git-ignored). It never modifies game files: instrumentation is
injected with `evaluateOnNewDocument`, and the optional `window.__dbg` hook is added by the QA static server on the
fly.

Requirements: Node 22, Google Chrome (default `C:/Program Files/Google/Chrome/Application/chrome.exe`, override with
`CHROME_PATH`). Do **not** use `python` on this machine (Store stub hangs).

```
cd tools/qa && npm install        # once
```

## Run a measurement

```
node run.mjs --root <siteRoot> --out <outDir> [--only stage01,hub] [--viewports small|all|1366x768,390x844]
              [--throttle 4] [--perf-seconds 8] [--no-perf] [--no-layout] [--software]
```

| flag | meaning |
|---|---|
| `--root` | directory served as the site root (repo root, or a `git archive` snapshot for a pristine baseline) |
| `--out` | output dir (`results.json`, `summary.md`, `<page>/<viewport>.png`). Re-running into an existing dir merges/overwrites per page+viewport |
| `--only` | pages: `hub, stage01, stage02, stage03, stage04, stage05` (default all) |
| `--viewports` | `all` (23 sizes, default), `small` (1920x1080, 1366x768, 1024x768, 844x390, 390x844), or a comma list of names |
| `--throttle` | CPU slowdown (CDP `Emulation.setCPUThrottlingRate`) for the extra perf pass run on the 5 "small" viewports only. `1` disables |
| `--perf-seconds` | length of the measured play window (default 8) |
| `--no-perf` / `--no-layout` | skip a pass (layout-only runs are ~10 s per page x viewport) |
| `--software` | force SwiftShader software GL (see "Environment notes") |

Parallel runs: use different `--out` dirs and combine with `node merge.mjs <intoDir> <partA> <partB>`.

Other entry points:

```
node lib/report.mjs <outDir>                         # regenerate summary.md from results.json
node compare.mjs <baselineDir> <newDir>              # writes <newDir>/compare.md
node play.mjs --root <siteRoot> --stage stage03 --mode smoke --seconds 20 --viewport 390x844 --shots <dir>
node play.mjs --root <siteRoot> --stage stage05 --mode win|lose   # uses window.__dbg.forceWin()/forceLose()
```

Typical per-stage workflow: baseline once from a pristine snapshot
(`git archive HEAD | tar -x -C <dir>`), then re-run with `--root <repo> --out <newDir> --only stageNN`, then
`node compare.mjs <baselineDir> <newDir>`.

## What is measured, per page x viewport

Each page x viewport gets up to three fresh browser contexts (no shared state):

1. **Layout pass** (coach lesson ON, i.e. the real first-run experience; guardian intro button force-enabled and
   clicked): screenshot `<out>/<page>/<viewport>.png` (full page; the hub also gets `<viewport>-intro.png` of its
   first-visit story overlay), layout metrics, console/network health, decoded-image and canvas memory.
2. **Perf pass** (coach skipped via the sessionStorage key `gog_coach_done_*`, so the stage is not in learning mode):
   after intro + 1 s warm-up, `perf-seconds` of random pointer movement/taps over the canvas (stage 4: holds
   ArrowRight + jumps; stages 1/2 use 90 ms press/release because their input is polled).
3. **Throttled perf pass** (small viewports only): same as 2 with CPU throttle.

Metrics (all in `results.json`; `summary.md` renders them):

| metric | meaning |
|---|---|
| `fps` | rAF callbacks per second over the window (page-side rAF loop, game untouched) |
| `frameMs avg/p50/p95/p99/max` | distribution of rAF-to-rAF deltas; `over33` = frames slower than ~2 vsyncs |
| `longTasks` | `PerformanceObserver('longtask')` count (> 50 ms main-thread blocks) |
| `heapStart/End/MaxMB` | `performance.memory.usedJSHeapSize` (Chrome launched with precise memory info) |
| `perSec.filter / shadowBlur / radialGradient / linearGradient / getImageData / createPattern` | counts per second of Canvas2D `ctx.filter = <non-none>`, `shadowBlur = >0`, `createRadialGradient()`, `createLinearGradient()`, `getImageData()`, `createPattern()` during the window. **Key before/after metric**: the Stage 3 recipe wants filter/shadowBlur/radial gradients at ~0 per frame |
| `memory.imageMB` | sum of `naturalWidth*naturalHeight*4` over every `new Image()` / `<img>` loaded (decoded size, not file size); `cssBackgroundMB` adds CSS `background-image` files |
| `memory.offscreenCanvasMB/Count` | live `document.createElement('canvas')` canvases not in the DOM (w*h*4); `canvasesCreatedTotal` counts all ever created |
| `memory.mainCanvas` | the on-page game canvas bitmap size (w, h, MB) |
| `timing.firstFrameMs` | ms from navigation start until the main canvas held non-uniform pixels (null on the hub, which has no canvas); also `navLoadMs`, `introShownMs` |
| `layout.scroll` | `scrollWidth/Height` vs viewport; `overflowX/Y` and pixel amounts |
| `layout.frame` | rect of `#canvasFrame`, its aspect, whether fully in the viewport, % of the viewport it covers |
| `layout.canvas` | bitmap size vs CSS size; `stretchPct` = aspect mismatch (stage 1/2 960x600 bitmaps are CSS-scaled) |
| `layout.hud` | `.stage-hud` (`.hud` on the hub) height and **row count** (vertical clustering of visible leaf elements; `directChildTopCount` = distinct `offsetTop` of direct children) and clipped items |
| `layout.cards` | visibility of `.gog-guardian-card`, `.gog-play-card`, `#infoBtn` |
| `layout.tapTargets` | every visible `button`/`.icon-btn`/`.brutal-btn`/`[role=button]` smaller than 48 px (44 px on compact landscape: landscape and height <= 520); `small[]` lists them |
| `health` | console errors/warnings, page errors, failed requests, HTTP >= 400, request count, **cross-origin** URLs, transfer KB. `pages.<p>.requestUrls` lists every URL requested |
| `assets` (top level) | bytes of `stages/assets` by type and by stage, code size, largest files (APK size) |

Viewports: desktop 2560x1440, 1920x1080, 1600x900, 1536x864, 1440x900, 1366x768, 1280x800, 1280x720; compact
1194x834, 1180x820, 1024x768, 993x700, 992x700, 1280x600; tablet portrait 768x1024, 820x1180; phone portrait 390x844,
360x640, 430x932; phone landscape 844x390, 932x430, 667x375, 740x360. DPR 1 on desktop/tablet, 2 + `isMobile` +
`hasTouch` on phones.

## Pass thresholds

| check | pass when |
|---|---|
| fps | >= 55 |
| p95 frame time | <= 20 ms |
| max frame time | <= 33 ms (the code allows 33.5: a clean two-vsync hitch reads 33.4) |
| overflow | no horizontal overflow; phone portrait must not scroll vertically either (desktop pages scroll vertically by design: cards sit below the canvas) |
| console | zero console errors / page errors / failed or 4xx requests |
| network | zero cross-origin requests |
| tap targets | every button >= 48 px (>= 44 px on compact landscape) |

`results.json` stores `failures[]` per page x viewport with whatever tripped.

## compare.mjs

`node compare.mjs <baselineDir> <newDir>` writes `compare.md`: a verdict line, **frozen-art screenshots changed**
(stages 1, 2, 4 by default; `--frozen` to change), per-metric regressions and improvements (relative + absolute
thresholds in the `M` table at the top of the file), per-page mean deltas, and every screenshot beyond threshold.
The screenshot diff is dependency-light: PNG dimensions must match (otherwise "size changed", which means the layout
moved) and then each image is reduced to 24x24 block mean colours; flagged when the mean block distance exceeds
`--shot-mean` (0.03) or more than `--shot-blocks` (25%) of blocks differ by > 0.08. Animated canvases add some noise,
so use the numbers as a "look at this" flag, not as a pixel-exact test.

## play.mjs (reusable by stage agents)

```js
import { openStage, waitForOutcomeOverlay } from "<repo>/tools/qa/play.mjs";
const s = await openStage({ root: "<repo>", stage: "stage03", viewport: "390x844", shotsDir: "<tmp>" });
const smoke = await s.smoke(20);        // intro dismissed, 20 s of random input, console clean, HUD/state changed?
console.log(await s.state());           // window.__dbg.getState()
await s.playToWin();                    // __dbg.forceWin() -> waits for the win popup, screenshot
await s.page.evaluate(() => window.__dbg.forceLose());   // or drive things yourself with s.page
await s.close();
```

The hook technique: the QA server rewrites `stages/stageNN-*.html` in the response (never on disk) and inserts the
snippet from `lib/dbg-hooks.mjs` before the last `})();` of the last inline script, so it can read the stage's private
variables. Each hook exposes `ready()`, `getState()`, `forceWin()`, `forceLose()` that call the stage's own
`endWin/endLose/triggerWin/triggerFail/winGame/failGame`. Every reference is wrapped in try/catch, so a renamed
variable gives `undefined` rather than breaking the stage. **When a stage is built or refactored, update its entry in
`lib/dbg-hooks.mjs`.** `smoke` works even without a hook (it then compares the HUD text only).

## Environment notes

* Default launch uses the machine's real GPU path. Forcing SwiftShader (`--software`) makes Canvas2D crawl
  (stage 1 idles at ~5 fps on this box), which is not representative; the earlier "harmless" flags are therefore opt-in.
* Headless Chrome has no user gesture, so audio is blocked: the guardian button is force-enabled (`btn.disabled=false`)
  and clicked. Stage 5's missing intro mp3 shows up as a 404 + console error until it is recorded.
* A busy machine (other Chromes/agents running) adds noise to fps numbers; compare runs made under similar load, and
  rely on the per-second canvas counters and memory numbers, which are deterministic enough to diff.
* The instrumentation (call counters, rAF logger, WeakRef trackers) is active in every run, baseline and new, so the
  overhead cancels out in comparisons.
* Chrome's `Emulation.setCPUThrottlingRate` only slows the main thread, so the 4x passes show JS/draw-call cost, which
  is the part this project can reduce.
