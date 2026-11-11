/* Injected via evaluateOnNewDocument by golden.mjs (dev-only, never shipped).
   Makes a stage frame-exact reproducible:
   - Math.random is a seeded PRNG,
   - performance.now / Date.now / requestAnimationFrame / setTimeout / setInterval run on a virtual clock,
   - nothing advances until the harness calls window.__det.step(n) (n frames of 1000/60 ms).
   Options arrive as window.__detOpts = { seed }. */
(function () {
  if (window.__det) return;
  var opts = window.__detOpts || {};
  var seed = (opts.seed == null ? 0x9e3779b9 : opts.seed) | 0;

  function mulberry() {
    seed = (seed + 0x6d2b79f5) | 0;
    var t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  Math.random = mulberry;

  var clock = 1000;
  var EPOCH = 1.7e12;
  performance.now = function () { return clock; };
  Date.now = function () { return EPOCH + clock; };

  var rafQ = [];
  var rafId = 0;
  window.requestAnimationFrame = function (cb) { rafQ.push({ id: ++rafId, cb: cb }); return rafId; };
  window.cancelAnimationFrame = function (id) { rafQ = rafQ.filter(function (r) { return r.id !== id; }); };

  var timers = [];
  var timerId = 0;
  function addTimer(cb, ms, repeat, args) {
    var t = { id: ++timerId, at: clock + Math.max(0, +ms || 0), cb: cb, ms: Math.max(1, +ms || 0), repeat: repeat, args: args };
    timers.push(t);
    return t.id;
  }
  window.setTimeout = function (cb, ms) { return addTimer(cb, ms, false, Array.prototype.slice.call(arguments, 2)); };
  window.setInterval = function (cb, ms) { return addTimer(cb, ms, true, Array.prototype.slice.call(arguments, 2)); };
  window.clearTimeout = window.clearInterval = function (id) { timers = timers.filter(function (t) { return t.id !== id; }); };

  function runTimers() {
    for (;;) {
      var due = null;
      for (var i = 0; i < timers.length; i++) if (timers[i].at <= clock && (!due || timers[i].at < due.at)) due = timers[i];
      if (!due) return;
      if (due.repeat) due.at += due.ms; else timers = timers.filter(function (t) { return t !== due; });
      try { if (typeof due.cb === "function") due.cb.apply(window, due.args); } catch (e) { console.error(e); }
    }
  }

  window.__det = {
    reseed: function (s) { seed = s | 0; },
    clock: function () { return clock; },
    step: function (n) {
      for (var k = 0; k < (n || 1); k++) {
        clock += 1000 / 60;
        runTimers();
        var cur = rafQ;
        rafQ = [];
        for (var j = 0; j < cur.length; j++) {
          try { cur[j].cb(clock); } catch (e) { console.error(e); }
        }
      }
    },
  };
})();
