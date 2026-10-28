// Shared puppeteer helpers for run.mjs and play.mjs.
import puppeteer from "puppeteer-core";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const INSTRUMENT_SRC = fs.readFileSync(path.join(HERE, "instrument.js"), "utf8");

export const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "/usr/bin/google-chrome", "/usr/bin/chromium", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
].filter(Boolean);

export const PAGES = {
  hub: { file: "index.html", kind: "hub" },
  stage01: { file: "stages/stage01-ocean.html", kind: "stage", input: "pointerPolled" },
  stage02: { file: "stages/stage02-forest.html", kind: "stage", input: "pointerPolled" },
  stage03: { file: "stages/stage03-food.html", kind: "stage", input: "pointer" },
  stage04: { file: "stages/stage04-ice.html", kind: "stage", input: "keyboard" },
  stage05: { file: "stages/stage05-sky.html", kind: "stage", input: "pointer" },
};

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function launch() {
  const exe = CHROME_CANDIDATES.find((p) => fs.existsSync(p));
  if (!exe) throw new Error("Chrome not found; set CHROME_PATH");
  return puppeteer.launch({
    executablePath: exe,
    headless: "new",
    args: [
      "--no-sandbox", "--enable-precise-memory-info",
      ...(process.env.QA_SOFTWARE === "1" ? ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] : []),
      "--disable-background-timer-throttling", "--disable-renderer-backgrounding", "--disable-backgrounding-occluded-windows",
      "--mute-audio", "--hide-scrollbars=false",
    ],
    defaultViewport: null,
  });
}

/** Creates an isolated page in its own context with viewport + instrumentation + event collectors. */
export async function openPage(browser, vp, { origin, skipCoach = true, throttle = 1, collect = true } = {}) {
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  await page.setViewport({ width: vp.width, height: vp.height, deviceScaleFactor: vp.deviceScaleFactor || 1, isMobile: !!vp.isMobile, hasTouch: !!vp.hasTouch });
  const cdp = await page.createCDPSession();
  await cdp.send("Network.enable");
  if (throttle && throttle > 1) await cdp.send("Emulation.setCPUThrottlingRate", { rate: throttle });
  await page.evaluateOnNewDocument(`window.__qaOpts=${JSON.stringify({ skipCoach })};`);
  await page.evaluateOnNewDocument(INSTRUMENT_SRC);

  const log = { console: [], pageErrors: [], failed: [], badStatus: [], requests: [], bytes: 0 };
  if (collect) {
    page.on("console", (m) => {
      const t = m.type();
      if (t === "error" || t === "warning") log.console.push({ type: t, text: m.text().slice(0, 300), url: m.location()?.url?.replace(origin || "", "") });
    });
    page.on("pageerror", (e) => log.pageErrors.push(String(e.message || e).slice(0, 300)));
    page.on("requestfailed", (r) => log.failed.push({ url: r.url().replace(origin || "", ""), err: r.failure()?.errorText }));
    page.on("response", (r) => { if (r.status() >= 400) log.badStatus.push({ url: r.url().replace(origin || "", ""), status: r.status() }); });
    page.on("request", (r) => log.requests.push(r.url()));
    cdp.on("Network.loadingFinished", (e) => { log.bytes += e.encodedDataLength || 0; });
  }
  return { page, context, cdp, log, close: async () => { try { await context.close(); } catch {} } };
}

export function crossOrigin(urls, origin) {
  return [...new Set(urls)].filter((u) => {
    if (/^(data|blob|about|chrome-extension):/.test(u)) return false;
    try { return new URL(u).origin !== origin; } catch { return true; }
  });
}

/** Waits for the guardian-intro continue button, forces it enabled, clicks it. Returns timing info. */
export async function dismissIntro(page, { timeout = 20000 } = {}) {
  const t0 = Date.now();
  const sel = ".gog-guardian-beat [data-role=continue]";
  try {
    await page.waitForSelector(sel, { timeout });
  } catch {
    return { shown: false, ms: Date.now() - t0 };
  }
  const shownMs = Date.now() - t0;
  const fit = await page.evaluate(() => {
    const c = document.querySelector(".gog-guardian-beat .gog-overlay-card"); if (!c) return null;
    const b = c.getBoundingClientRect();
    return { w: Math.round(b.width), h: Math.round(b.height), clipped: b.top < -1 || b.bottom > innerHeight + 1 || b.left < -1 || b.right > innerWidth + 1 };
  });
  await page.evaluate((s) => { const b = document.querySelector(s); if (b) { b.disabled = false; b.click(); } }, sel);
  // the click may have been "tap to hear" (starts the line); click again if the overlay is still up
  for (let i = 0; i < 3; i++) {
    await sleep(350);
    const still = await page.evaluate(() => !!document.querySelector(".gog-guardian-beat"));
    if (!still) break;
    await page.evaluate((s) => { const b = document.querySelector(s); if (b) { b.disabled = false; b.click(); } }, sel);
  }
  const left = await page.evaluate(() => !!document.querySelector(".gog-guardian-beat"));
  return { shown: true, ms: shownMs, card: fit, stuck: left };
}

export async function canvasRect(page) {
  return page.evaluate(() => {
    const c = document.querySelector("#canvasFrame canvas, .canvas-frame canvas, canvas");
    if (!c) return null;
    const b = c.getBoundingClientRect();
    return { x: b.left, y: b.top, w: b.width, h: b.height };
  });
}

/** Random-ish input over `ms` milliseconds. mode: pointer | pointerPolled | keyboard. Cancellable via signal.stop. */
export async function playActivity(page, mode, ms, signal = {}) {
  const end = Date.now() + ms;
  let rect = await canvasRect(page);
  if (!rect) return;
  const rnd = (a, b) => a + Math.random() * (b - a);
  const pt = () => ({ x: rect.x + rnd(0.08, 0.92) * rect.w, y: rect.y + rnd(0.08, 0.92) * rect.h });
  if (mode === "keyboard") {
    await page.keyboard.down("ArrowRight");
    let n = 0;
    while (Date.now() < end && !signal.stop) {
      await sleep(300);
      n++;
      if (n % 3 === 0) { await page.keyboard.press("ArrowUp").catch(() => {}); await page.keyboard.press("Space").catch(() => {}); }
      // touch players: also tap the canvas
      if (n % 5 === 0) { const p = pt(); await page.mouse.click(p.x, p.y).catch(() => {}); }
    }
    await page.keyboard.up("ArrowRight").catch(() => {});
    return;
  }
  let i = 0;
  while (Date.now() < end && !signal.stop) {
    i++;
    const p = pt();
    if (i % 25 === 0) rect = (await canvasRect(page)) || rect;
    await page.mouse.move(p.x, p.y, { steps: 6 }).catch(() => {});
    if (i % 2 === 0) {
      await page.mouse.down().catch(() => {});
      await sleep(mode === "pointerPolled" ? 90 : 40);
      await page.mouse.up().catch(() => {});
    }
    await sleep(80);
  }
}

