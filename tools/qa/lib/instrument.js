/* Injected into every page via evaluateOnNewDocument (run.mjs / play.mjs). Counters + observers only;
   never modifies game behaviour. Exposes window.__qa. Options arrive as window.__qaOpts = { skipCoach }. */
(function () {
  if (window.__qa) return;
  var opts = window.__qaOpts || {};
  var qa = (window.__qa = {
    frames: [],            // rAF timestamps (ms)
    longTasks: [],         // {start, dur}
    counters: { filter: 0, shadowBlur: 0, radialGradient: 0, linearGradient: 0, getImageData: 0, createPattern: 0 },
    firstFrameAt: null,    // ms since navigation start when the main canvas first held non-blank pixels
    heapSamples: [],
    created: { canvas: 0, canvasBytes: 0 },
    images: [],            // WeakRefs to Image / <img> objects
    canvases: [],          // WeakRefs to document.createElement('canvas') results
    mark: null,
  });

  /* ---- coach lesson skip (sessionStorage key gog_coach_done_<stage>) ---- */
  if (opts.skipCoach) {
    try {
      var origGet = Storage.prototype.getItem;
      Storage.prototype.getItem = function (k) {
        if (typeof k === "string" && k.indexOf("gog_coach_done_") === 0) return "1";
        if (k === "gog_story_intro_seen") return "true"; // hub first-visit story overlay
        return origGet.apply(this, arguments);
      };
    } catch (e) {}
  }

  /* ---- canvas 2D counters ---- */
  var origGID = CanvasRenderingContext2D.prototype.getImageData;
  try {
    var P = CanvasRenderingContext2D.prototype;
    var wrapSetter = function (prop, key, isActive) {
      var d = Object.getOwnPropertyDescriptor(P, prop);
      if (!d || !d.set) return;
      Object.defineProperty(P, prop, {
        configurable: true, enumerable: d.enumerable, get: d.get,
        set: function (v) { if (isActive(v)) qa.counters[key]++; return d.set.call(this, v); },
      });
    };
    wrapSetter("filter", "filter", function (v) { return v !== "none" && v !== "" && v != null; });
    wrapSetter("shadowBlur", "shadowBlur", function (v) { return +v > 0; });
    ["createRadialGradient:radialGradient", "createLinearGradient:linearGradient", "getImageData:getImageData", "createPattern:createPattern"].forEach(function (s) {
      var parts = s.split(":"), orig = P[parts[0]];
      if (typeof orig !== "function") return;
      P[parts[0]] = function () { qa.counters[parts[1]]++; return orig.apply(this, arguments); };
    });
  } catch (e) {}

  /* ---- image + offscreen canvas tracking ---- */
  try {
    var OrigImage = window.Image;
    var WrappedImage = function (w, h) {
      var img = arguments.length ? new OrigImage(w, h) : new OrigImage();
      qa.images.push(new WeakRef(img));
      return img;
    };
    WrappedImage.prototype = OrigImage.prototype;
    window.Image = WrappedImage;
    var origCreate = Document.prototype.createElement;
    Document.prototype.createElement = function (tag) {
      var el = origCreate.apply(this, arguments);
      try {
        var t = typeof tag === "string" ? tag.toLowerCase() : "";
        if (t === "canvas") { qa.canvases.push(new WeakRef(el)); qa.created.canvas++; }
        else if (t === "img") qa.images.push(new WeakRef(el));
      } catch (e) {}
      return el;
    };
  } catch (e) {}

  /* ---- rAF timeline, first-frame detection, heap sampling ---- */
  var probe = null;
  function nonBlank(c) {
    try {
      if (!c || !c.width || !c.height) return false;
      if (!probe) { probe = Document.prototype.createElement.call(document, "canvas"); probe.width = 16; probe.height = 16; }
      var x = probe.getContext("2d", { willReadFrequently: true });
      x.clearRect(0, 0, 16, 16);
      x.drawImage(c, 0, 0, 16, 16);
      var d = origGID.call(x, 0, 0, 16, 16).data, r = d[0], g = d[1], b = d[2], a = d[3], any = false;
      for (var i = 0; i < d.length; i += 4) {
        if (d[i + 3] > 0) { any = true; if (d[i] !== r || d[i + 1] !== g || d[i + 2] !== b || d[i + 3] !== a) return true; }
      }
      return false;
    } catch (e) { return false; }
  }
  function mainCanvas() {
    return document.querySelector("#canvasFrame canvas, .canvas-frame canvas, #gameCanvas, #game");
  }
  var n = 0;
  function tick(t) {
    qa.frames.push(t);
    n++;
    if (qa.firstFrameAt == null && n % 3 === 0) {
      var c = mainCanvas();
      if (c && nonBlank(c)) qa.firstFrameAt = performance.now();
    }
    if (n % 60 === 0 && performance.memory) qa.heapSamples.push({ t: t, used: performance.memory.usedJSHeapSize });
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);

  try {
    new PerformanceObserver(function (list) {
      list.getEntries().forEach(function (e) { qa.longTasks.push({ start: e.startTime, dur: e.duration }); });
    }).observe({ type: "longtask", buffered: true });
  } catch (e) {}

  /* ---- measurement window ---- */
  qa.start = function () {
    qa.mark = {
      t: performance.now(), frame: qa.frames.length, counters: Object.assign({}, qa.counters),
      longTask: qa.longTasks.length, heap: performance.memory ? performance.memory.usedJSHeapSize : null,
      heapSample: qa.heapSamples.length,
    };
  };
  function pct(sorted, p) { return sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] : null; }
  qa.stop = function () {
    var m = qa.mark || { t: 0, frame: 0, counters: {}, longTask: 0, heap: null, heapSample: 0 };
    var now = performance.now(), secs = (now - m.t) / 1000;
    var f = qa.frames.slice(m.frame), dts = [];
    for (var i = 1; i < f.length; i++) dts.push(f[i] - f[i - 1]);
    var s = dts.slice().sort(function (a, b) { return a - b; });
    var sum = dts.reduce(function (a, b) { return a + b; }, 0);
    var lt = qa.longTasks.slice(m.longTask);
    var perSec = {};
    Object.keys(qa.counters).forEach(function (k) { perSec[k] = +(((qa.counters[k] - (m.counters[k] || 0)) / secs).toFixed(2)); });
    var heapMax = m.heap || 0;
    qa.heapSamples.slice(m.heapSample).forEach(function (h) { if (h.used > heapMax) heapMax = h.used; });
    var heapEnd = performance.memory ? performance.memory.usedJSHeapSize : null;
    if (heapEnd && heapEnd > heapMax) heapMax = heapEnd;
    return {
      seconds: +secs.toFixed(2),
      frames: f.length,
      fps: f.length > 1 ? +(((f.length - 1) / ((f[f.length - 1] - f[0]) / 1000)).toFixed(2)) : 0,
      frameMs: { avg: dts.length ? +(sum / dts.length).toFixed(2) : null, p50: pct(s, 50), p95: pct(s, 95), p99: pct(s, 99), max: s.length ? s[s.length - 1] : null },
      over33: dts.filter(function (d) { return d > 33.5; }).length,
      longTasks: lt.length, longTaskMs: +lt.reduce(function (a, b) { return a + b.dur; }, 0).toFixed(1),
      longTaskMax: lt.reduce(function (a, b) { return Math.max(a, b.dur); }, 0),
      heapStartMB: m.heap != null ? +(m.heap / 1048576).toFixed(2) : null,
      heapEndMB: heapEnd != null ? +(heapEnd / 1048576).toFixed(2) : null,
      heapMaxMB: heapMax ? +(heapMax / 1048576).toFixed(2) : null,
      perSec: perSec,
    };
  };

  /* ---- memory snapshot (decoded images + offscreen canvases) ---- */
  qa.memory = function () {
    var seen = new Set(), imgs = [], imgBytes = 0;
    function add(img) {
      if (!img || seen.has(img)) return;
      seen.add(img);
      if (!img.complete || !img.naturalWidth) return;
      var b = img.naturalWidth * img.naturalHeight * 4;
      imgBytes += b;
      imgs.push({ src: (img.currentSrc || img.src || "").replace(location.origin, ""), w: img.naturalWidth, h: img.naturalHeight, bytes: b });
    }
    qa.images.forEach(function (r) { add(r.deref()); });
    Array.prototype.forEach.call(document.images, add);
    // dedupe by src (the same file loaded twice still holds two decodes, so keep a raw count too)
    var cvBytes = 0, cvCount = 0, cvTop = [];
    var main = mainCanvas();
    var cvSeen = new Set();
    qa.canvases.forEach(function (r) {
      var c = r.deref();
      if (!c || cvSeen.has(c)) return;
      cvSeen.add(c);
      if (c === probe || c.isConnected) return;
      var b = c.width * c.height * 4;
      cvBytes += b; cvCount++;
      cvTop.push({ w: c.width, h: c.height, bytes: b });
    });
    cvTop.sort(function (a, b) { return b.bytes - a.bytes; });
    imgs.sort(function (a, b) { return b.bytes - a.bytes; });
    var allConnected = Array.prototype.slice.call(document.querySelectorAll("canvas")).map(function (c) { return { id: c.id, w: c.width, h: c.height, bytes: c.width * c.height * 4 }; });
    return {
      imageCount: imgs.length, imageMB: +(imgBytes / 1048576).toFixed(2), imageTop: imgs.slice(0, 8),
      offscreenCanvasCount: cvCount, offscreenCanvasMB: +(cvBytes / 1048576).toFixed(2), offscreenCanvasTop: cvTop.slice(0, 5),
      canvasesCreatedTotal: qa.created.canvas,
      mainCanvas: main ? { id: main.id, w: main.width, h: main.height, MB: +((main.width * main.height * 4) / 1048576).toFixed(2) } : null,
      domCanvases: allConnected,
    };
  };
})();
