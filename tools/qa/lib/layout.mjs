// Page-side layout metrics. `layoutMetrics` is serialised by puppeteer and runs inside the page.
export function layoutMetrics(minTap) {
  const vw = window.innerWidth, vh = window.innerHeight;
  const de = document.documentElement;
  const r = (x) => Math.round(x * 100) / 100;
  const rectOf = (el) => {
    if (!el) return null;
    const b = el.getBoundingClientRect();
    return { x: r(b.left + scrollX), y: r(b.top + scrollY), w: r(b.width), h: r(b.height), right: r(b.right + scrollX), bottom: r(b.bottom + scrollY) };
  };
  const visible = (el) => {
    const cs = getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden" || +cs.opacity === 0) return false;
    const b = el.getBoundingClientRect();
    if (b.width < 1 || b.height < 1) return false;
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
      const ps = getComputedStyle(p);
      if (ps.display === "none" || ps.visibility === "hidden" || +ps.opacity === 0) return false;
    }
    return true;
  };
  const sel = (el) => {
    let s = el.tagName.toLowerCase();
    if (el.id) s += "#" + el.id;
    else if (el.className && typeof el.className === "string") s += "." + el.className.trim().split(/\s+/).slice(0, 2).join(".");
    return s;
  };

  const out = { viewport: { w: vw, h: vh, dpr: window.devicePixelRatio } };
  out.scroll = {
    scrollW: de.scrollWidth, scrollH: de.scrollHeight, bodyScrollW: document.body.scrollWidth,
    overflowX: Math.max(de.scrollWidth, document.body.scrollWidth) > vw + 1,
    overflowY: de.scrollHeight > vh + 1,
    overflowYpx: Math.max(0, de.scrollHeight - vh),
    overflowXpx: Math.max(0, Math.max(de.scrollWidth, document.body.scrollWidth) - vw),
  };

  // canvas frame + canvas
  const frame = document.querySelector("#canvasFrame, .canvas-frame");
  const canvas = frame ? frame.querySelector("canvas") : document.querySelector("canvas");
  if (frame) {
    const b = frame.getBoundingClientRect();
    out.frame = Object.assign(rectOf(frame), {
      aspect: r(b.width / b.height),
      fullyInViewport: b.top >= -1 && b.bottom <= vh + 1 && b.left >= -1 && b.right <= vw + 1,
      topInViewport: b.top < vh,
      viewportAreaPct: r((Math.max(0, Math.min(b.right, vw) - Math.max(b.left, 0)) * Math.max(0, Math.min(b.bottom, vh) - Math.max(b.top, 0))) / (vw * vh) * 100),
      fracOfViewportH: r(Math.min(b.height, vh) / vh),
    });
  } else out.frame = null;
  if (canvas) {
    const b = canvas.getBoundingClientRect();
    out.canvas = {
      bitmapW: canvas.width, bitmapH: canvas.height, bitmapAspect: r(canvas.width / canvas.height),
      cssW: r(b.width), cssH: r(b.height), cssAspect: r(b.width / b.height),
      stretchPct: r(Math.abs(b.width / b.height - canvas.width / canvas.height) / (canvas.width / canvas.height) * 100),
      bitmapToCssRatio: r(canvas.width / Math.max(1, b.width)),
    };
  }

  // HUD rows
  const hud = document.querySelector(".stage-hud, .hud");
  if (hud) {
    const kids = Array.from(hud.children).filter(visible);
    const tops = new Set(kids.map((k) => k.offsetTop));
    // leaf-level clustering by vertical centre (tolerance 10px)
    const leaves = Array.from(hud.querySelectorAll("*")).filter((e) => visible(e) && !Array.from(e.children).some(visible) && getComputedStyle(e).position !== "absolute" && getComputedStyle(e).position !== "fixed");
    const centres = leaves.map((e) => { const b = e.getBoundingClientRect(); return b.top + b.height / 2; }).sort((a, b) => a - b);
    let rows = 0, last = -1e9;
    centres.forEach((c) => { if (c - last > 10) { rows++; } last = c; });
    const clipped = leaves.filter((e) => { const b = e.getBoundingClientRect(); return b.right > vw + 1 || b.left < -1; }).map(sel).slice(0, 6);
    out.hud = { rect: rectOf(hud), height: r(hud.getBoundingClientRect().height), directChildTopCount: tops.size, rows, clipped, visibleLeafCount: leaves.length };
  } else out.hud = null;

  // cards
  const cardInfo = (q) => {
    const el = document.querySelector(q);
    if (!el) return { exists: false, visible: false };
    const v = visible(el), b = el.getBoundingClientRect();
    return { exists: true, visible: v, top: r(b.top + scrollY), h: r(b.height), belowFold: b.top >= vh };
  };
  out.cards = { guardian: cardInfo(".gog-guardian-card"), play: cardInfo(".gog-play-card"), infoBtn: cardInfo("#infoBtn") };

  // tap targets
  const targets = Array.from(document.querySelectorAll("button, a.brutal-btn, .icon-btn, .brutal-btn, [role=button]")).filter(visible);
  const seen = new Set();
  const list = [];
  targets.forEach((el) => {
    if (seen.has(el)) return;
    seen.add(el);
    const b = el.getBoundingClientRect();
    list.push({ el: sel(el), text: (el.getAttribute("aria-label") || el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 24), w: r(b.width), h: r(b.height), min: r(Math.min(b.width, b.height)), onScreen: b.bottom > 0 && b.top < vh && b.right > 0 && b.left < vw });
  });
  out.tapTargets = { count: list.length, threshold: minTap, minSize: list.length ? Math.min(...list.map((t) => t.min)) : null, small: list.filter((t) => t.min < minTap) };

  // lingering overlays (should be none once the intro is dismissed)
  out.overlays = Array.from(document.querySelectorAll(".gog-overlay")).filter(visible).map(sel);
  out.title = document.title;
  return out;
}

/** CSS background images -> decoded size estimate (async, page-side). */
export async function cssBackgrounds() {
  const urls = new Set();
  document.querySelectorAll("*").forEach((el) => {
    for (const pseudo of [null, "::before", "::after"]) {
      const bg = getComputedStyle(el, pseudo).backgroundImage;
      if (!bg || bg === "none") continue;
      for (const m of bg.matchAll(/url\(["']?([^"')]+)["']?\)/g)) urls.add(m[1]);
    }
  });
  const out = [];
  await Promise.all(Array.from(urls).filter((u) => !u.startsWith("data:")).map((u) => new Promise((res) => {
    const i = new Image();
    i.onload = () => { out.push({ src: u.replace(location.origin, ""), w: i.naturalWidth, h: i.naturalHeight, bytes: i.naturalWidth * i.naturalHeight * 4 }); res(); };
    i.onerror = () => res();
    i.src = u;
  })));
  return out;
}
