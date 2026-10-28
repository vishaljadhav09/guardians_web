/* ============================================================
   GUARDIANS OF GAIA — SHARED ENGINE
   The reusable core every stage imports. Fixed-timestep loop,
   unified pointer/keyboard input, lightweight collision helpers,
   a pooled particle system, and a mute-aware audio wrapper.
   No build step — plain script, works on file:// and on any cheap
   host. The only library is the vendored src/vendor/howler.min.js
   (Howler.js core, MIT), loaded before this file; if it is missing
   the audio wrapper falls back to plain HTMLAudio.

   PERFORMANCE HELPERS for stages (all optional, all cheap):

     GOGEngine.visible                  true while the page is shown.
     GOGEngine.onVisibility(fn)         fn(visible) on every show/hide;
                                        returns an unsubscribe function.
                                        A stage with its own RAF loop should
                                        cancel the RAF when hidden and
                                        restart it (resetting its last-time)
                                        when shown.
     GOGEngine.requestDraw()            Tells every GameLoop to draw on its
                                        next frame even if no fixed step ran
                                        (GameLoop skips draw() when nothing
                                        was updated). fitCanvas calls it on
                                        a bitmap resize. loop.forceDraw()
                                        does the same for one loop.
     GOGEngine.bake(w, h, drawFn, scale)
                                        Paints drawFn(ctx, w, h) ONCE into an
                                        offscreen canvas (scale = bitmap
                                        multiplier, e.g. hiDpi.scale) and
                                        returns it. canvas.gw / canvas.gh hold
                                        the logical size: blit with
                                        ctx.drawImage(c, x, y, c.gw, c.gh).
     GOGEngine.glowSprite(color, radius)
                                        Cached soft round glow (any CSS
                                        color), 2*radius logical px square.
                                        Replaces shadowBlur / per-frame
                                        radial gradients. Bounded cache.
     GOGEngine.drawGlow(ctx, color, radius, x, y, alpha)
                                        Draws a glowSprite centred on x,y.
     GOGEngine.tint(img, filter)        Runs ctx.filter (e.g. "hue-rotate(
                                        90deg)") ONCE into an offscreen canvas
                                        and returns it (cached per image +
                                        filter, bounded). Never call a filter
                                        per frame; call tint() once and reuse.
     EmojiSprite.getHi(glyph, size)     Like get() but rasterised at the
                                        device pixel ratio (cap 2); the canvas
                                        has .gw/.gh logical size.
     EmojiSprite.draw(ctx, glyph, size, x, y)
                                        Draws a crisp emoji centred on x,y.
     GOGUi.setText/setStyle/setClass    DOM writes only on change (ui.js).
   ============================================================ */

(function (global) {
  "use strict";

  var EmojiSprite = (function () {
    var cache = {};
    var count = 0;
    var CACHE_MAX = 400; // glyph x size combos; cleared wholesale if exceeded
    function remember(key, c) {
      if (count >= CACHE_MAX) { cache = {}; count = 0; }
      cache[key] = c;
      count++;
      return c;
    }
    function render(glyph, rounded, s) {
      var pad = rounded * 0.4;
      var c = document.createElement("canvas");
      c.width = (rounded + pad * 2) * s;
      c.height = (rounded + pad * 2) * s;
      var cctx = c.getContext("2d");
      cctx.font = (rounded * s) + "px sans-serif";
      cctx.textAlign = "center";
      cctx.textBaseline = "middle";
      cctx.fillText(glyph, c.width / 2, c.height / 2);
      return c;
    }
    // 1x canvas whose width/height ARE the logical size (callers rely on that).
    function get(glyph, size) {
      var rounded = Math.round(size / 2) * 2; // round to nearest 2px to maximize cache hits
      var key = glyph + "_" + rounded;
      if (cache[key]) return cache[key];
      return remember(key, render(glyph, rounded, 1));
    }
    function dprScale() {
      var d = global.devicePixelRatio || 1;
      return d > 2 ? 2 : (d < 1 ? 1 : d);
    }
    // Device-pixel-ratio aware raster. Bitmap is larger than the logical
    // size, so draw it with c.gw / c.gh: ctx.drawImage(c, x, y, c.gw, c.gh).
    function getHi(glyph, size) {
      var rounded = Math.round(size / 2) * 2;
      var s = dprScale();
      var key = glyph + "_" + rounded + "@" + s;
      if (cache[key]) return cache[key];
      var c = render(glyph, rounded, s);
      c.gw = rounded + rounded * 0.4 * 2;
      c.gh = c.gw;
      return remember(key, c);
    }
    function draw(ctx, glyph, size, x, y) {
      var c = getHi(glyph, size);
      ctx.drawImage(c, x - c.gw / 2, y - c.gh / 2, c.gw, c.gh);
    }
    return { get: get, getHi: getHi, draw: draw };
  })();
  global.EmojiSprite = EmojiSprite; // expose alongside GOGEngine

  /* ---------------- Draw requests / visibility ---------------- */
  // A GameLoop skips draw() when no fixed step ran; anything that invalidates
  // the picture without a state change (a canvas resize clears it) calls
  // requestDraw() so every loop repaints once.
  var drawEpoch = 0;
  function requestDraw() { drawEpoch++; }

  var visListeners = [];
  var visBound = false;
  function onVisibility(fn) {
    if (!visBound && global.document) {
      visBound = true;
      global.document.addEventListener("visibilitychange", function () {
        var v = !global.document.hidden;
        var list = visListeners.slice();
        for (var i = 0; i < list.length; i++) {
          try { list[i](v); } catch (e) {}
        }
      });
    }
    visListeners.push(fn);
    return function () {
      var i = visListeners.indexOf(fn);
      if (i >= 0) visListeners.splice(i, 1);
    };
  }

  /* ---------------- GameLoop ---------------- */
  // Fixed-timestep update with delta-time normalization, RAF-driven.
  // draw() only runs on frames where at least one step ran (or after
  // start/resume, forceDraw(), or GOGEngine.requestDraw()). RAF is not
  // scheduled while the page is hidden.
  function GameLoop(opts) {
    this.update = opts.update || function () {};
    this.draw = opts.draw || function () {};
    this.stepMs = opts.stepMs || (1000 / 60);
    this._acc = 0;
    this._last = 0;
    this._running = false;
    this._paused = false;
    this._dirty = true;
    this._epoch = -1;
    this._raf = null;
    this._maxStepsPerFrame = 5; // avoid spiral-of-death on tab-resume
    this._onVisibility = this._onVisibility.bind(this);
    var self = this;
    this._frame = function (now) { self._tick(now); };
  }

  GameLoop.prototype._tick = function (now) {
    this._raf = null;
    if (!this._running || this._paused || document.hidden) return;
    var dtMs = now - this._last;
    this._last = now;
    if (dtMs < 0) dtMs = 0;
    if (dtMs > 250) dtMs = 250; // clamp huge gaps (tab was hidden)
    this._acc += dtMs;
    var steps = 0;
    while (this._acc >= this.stepMs && steps < this._maxStepsPerFrame) {
      this.update(this.stepMs / 1000);
      this._acc -= this.stepMs;
      steps++;
    }
    if (steps >= this._maxStepsPerFrame && this._acc >= this.stepMs) {
      this._acc = 0;
    }
    if (steps > 0 || this._dirty || this._epoch !== drawEpoch) {
      this._dirty = false;
      this._epoch = drawEpoch;
      this.draw();
    }
    this._schedule();
  };

  GameLoop.prototype._schedule = function () {
    if (this._running && !this._paused && !document.hidden && this._raf == null) {
      this._raf = requestAnimationFrame(this._frame);
    }
  };

  GameLoop.prototype._cancel = function () {
    if (this._raf != null) cancelAnimationFrame(this._raf);
    this._raf = null;
  };

  GameLoop.prototype.start = function () {
    if (this._running) return;
    this._running = true;
    this._paused = false;
    this._dirty = true;
    this._last = performance.now();
    document.addEventListener("visibilitychange", this._onVisibility);
    this._schedule();
  };

  GameLoop.prototype.stop = function () {
    this._running = false;
    this._cancel();
    document.removeEventListener("visibilitychange", this._onVisibility);
  };

  // pause()/resume(): stop stepping + RAF without tearing the loop down.
  GameLoop.prototype.pause = function () {
    this._paused = true;
    this._cancel();
  };

  GameLoop.prototype.resume = function () {
    if (!this._paused) return;
    this._paused = false;
    this._last = performance.now();
    this._acc = 0;
    this._dirty = true;
    this._schedule();
  };

  // Ask for a draw on the next frame even if no step runs.
  GameLoop.prototype.forceDraw = function () { this._dirty = true; };

  GameLoop.prototype._onVisibility = function () {
    if (document.hidden) {
      this._cancel(); // no RAF while hidden
    } else {
      this._last = performance.now(); // don't accumulate the hidden gap
      this._acc = 0;
      this._dirty = true;
      this._schedule();
    }
  };

  /* ---------------- Input ---------------- */
  // Unified pointer (mouse/touch/pen) + keyboard. Reads canvas-relative
  // coordinates so stages don't each re-derive bounding rects. The canvas
  // client rect is cached (moves/touchmoves would otherwise force a layout
  // read each): it is refreshed on pointerdown, on resize / scroll /
  // orientationchange / ResizeObserver, and when older than RECT_TTL_MS.
  var RECT_TTL_MS = 250;
  function Input(canvas) {
    this.canvas = canvas;
    this.pointer = { x: 0, y: 0, down: false, active: false };
    this.keys = {};
    this._rect = null;
    this._rectAt = 0;
    this._bind();
  }

  // Drop the cached rect (call after moving/resizing the canvas frame).
  Input.prototype.invalidateRect = function () { this._rect = null; };

  Input.prototype._getRect = function (fresh) {
    var now = performance.now();
    if (fresh || !this._rect || now - this._rectAt > RECT_TTL_MS) {
      this._rect = this.canvas.getBoundingClientRect();
      this._rectAt = now;
    }
    return this._rect;
  };

  Input.prototype._toCanvasXY = function (clientX, clientY, fresh) {
    var rect = this._getRect(fresh);
    var cw = this.canvas._gogW || this.canvas.width; // fitCanvas records the logical size
    var ch = this.canvas._gogH || this.canvas.height;
    var scaleX = cw / rect.width;
    var scaleY = ch / rect.height;
    return {
      x: (clientX - rect.left) * scaleX,
      y: (clientY - rect.top) * scaleY
    };
  };

  Input.prototype._bind = function () {
    var self = this;

    function setFromEvent(e, down) {
      var point = e.touches && e.touches[0] ? e.touches[0] : e;
      var xy = self._toCanvasXY(point.clientX, point.clientY, down === true);
      self.pointer.x = xy.x;
      self.pointer.y = xy.y;
      self.pointer.active = true;
      if (down !== undefined) self.pointer.down = down;
    }

    this.canvas.addEventListener("mousemove", function (e) { setFromEvent(e); });
    this.canvas.addEventListener("mousedown", function (e) { setFromEvent(e, true); });
    window.addEventListener("mouseup", function () { self.pointer.down = false; });

    this.canvas.addEventListener("touchstart", function (e) {
      e.preventDefault();
      setFromEvent(e, true);
    }, { passive: false });
    this.canvas.addEventListener("touchmove", function (e) {
      e.preventDefault();
      setFromEvent(e);
    }, { passive: false });
    this.canvas.addEventListener("touchend", function (e) {
      e.preventDefault();
      self.pointer.down = false;
    }, { passive: false });

    window.addEventListener("keydown", function (e) { self.keys[e.key] = true; });
    window.addEventListener("keyup", function (e) { self.keys[e.key] = false; });

    // Layout events that can move the canvas: just drop the cache (cheap).
    function inval() { self._rect = null; }
    window.addEventListener("resize", inval);
    window.addEventListener("orientationchange", inval);
    window.addEventListener("scroll", inval, { passive: true, capture: true });
    if (typeof ResizeObserver === "function") {
      new ResizeObserver(inval).observe(this.canvas);
    }
  };

  Input.prototype.isDown = function (key) { return !!this.keys[key]; };

  /* ---------------- Collision helpers ---------------- */
  var Collision = {
    circleHit: function (ax, ay, ar, bx, by, br) {
      var dx = ax - bx, dy = ay - by;
      var rr = ar + br;
      return (dx * dx + dy * dy) <= (rr * rr);
    },
    distance: function (ax, ay, bx, by) {
      var dx = ax - bx, dy = ay - by;
      return Math.sqrt(dx * dx + dy * dy);
    },
    clamp: function (v, min, max) {
      return Math.max(min, Math.min(max, v));
    },
    lerp: function (a, b, t) { return a + (b - a) * t; }
  };

  /* ---------------- Particles ---------------- */
  // Simple pooled emoji/shape burst system. No sprite sheets needed.
  function ParticleSystem(maxParticles) {
    this.max = maxParticles || 120;
    this.pool = [];
    for (var i = 0; i < this.max; i++) this.pool.push(this._fresh());
  }

  ParticleSystem.prototype._fresh = function () {
    return { active: false, x: 0, y: 0, vx: 0, vy: 0, life: 0, maxLife: 1, text: "", size: 16, rotation: 0, vr: 0 };
  };

  ParticleSystem.prototype.burst = function (x, y, opts) {
    opts = opts || {};
    var count = opts.count || 8;
    for (var i = 0; i < count; i++) {
      var p = null;
      for (var j = 0; j < this.pool.length; j++) {
        if (!this.pool[j].active) { p = this.pool[j]; break; }
      }
      if (!p) return; // pool exhausted, drop silently — keeps perf bounded
      var angle = (opts.angle != null ? opts.angle : Math.random() * Math.PI * 2);
      var spread = opts.spread != null ? opts.spread : Math.PI * 2;
      var a = angle + (Math.random() - 0.5) * spread;
      var speed = (opts.minSpeed || 40) + Math.random() * ((opts.maxSpeed || 140) - (opts.minSpeed || 40));
      p.active = true;
      p.x = x; p.y = y;
      p.vx = Math.cos(a) * speed;
      p.vy = Math.sin(a) * speed - (opts.lift || 60);
      p.life = 0;
      p.maxLife = (opts.life || 700) / 1000;
      p.text = Array.isArray(opts.glyphs) ? opts.glyphs[Math.floor(Math.random() * opts.glyphs.length)] : (opts.glyph || "✨");
      p.size = (opts.minSize || 14) + Math.random() * ((opts.maxSize || 22) - (opts.minSize || 14));
      p.rotation = Math.random() * Math.PI;
      p.vr = (Math.random() - 0.5) * 6;
      p.gravity = opts.gravity != null ? opts.gravity : 220;
    }
  };

  ParticleSystem.prototype.update = function (dt) {
    for (var i = 0; i < this.pool.length; i++) {
      var p = this.pool[i];
      if (!p.active) continue;
      p.life += dt;
      if (p.life >= p.maxLife) { p.active = false; continue; }
      p.vy += p.gravity * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rotation += p.vr * dt;
    }
  };

  // No ctx.save()/restore() per particle: the base transform is read once,
  // each particle composes translate(x,y) * rotate(r) onto it by hand
  // (identical result), then the base transform and alpha are put back.
  ParticleSystem.prototype.draw = function (ctx) {
    var base = typeof ctx.getTransform === "function" ? ctx.getTransform() : null;
    var prevAlpha = ctx.globalAlpha;
    var drew = false;
    for (var i = 0; i < this.pool.length; i++) {
      var p = this.pool[i];
      if (!p.active) continue;
      var alpha = 1 - p.life / p.maxLife;
      ctx.globalAlpha = Math.max(0, alpha);
      var sprite = EmojiSprite.getHi(p.text, p.size);
      var gw = sprite.gw, gh = sprite.gh;
      if (base) {
        var cos = Math.cos(p.rotation), sin = Math.sin(p.rotation);
        ctx.setTransform(
          base.a * cos + base.c * sin, base.b * cos + base.d * sin,
          -base.a * sin + base.c * cos, -base.b * sin + base.d * cos,
          base.a * p.x + base.c * p.y + base.e, base.b * p.x + base.d * p.y + base.f
        );
        ctx.drawImage(sprite, -gw / 2, -gh / 2, gw, gh);
      } else {
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rotation);
        ctx.drawImage(sprite, -gw / 2, -gh / 2, gw, gh);
        ctx.restore();
      }
      drew = true;
    }
    if (drew) {
      if (base) ctx.setTransform(base);
      ctx.globalAlpha = prevAlpha;
    }
  };

  /* ---------------- Offscreen caches (bake / glow / tint) ---------------- */
  function bake(w, h, drawFn, scale) {
    scale = scale || 1;
    var c = document.createElement("canvas");
    c.width = Math.max(1, Math.ceil(w * scale));
    c.height = Math.max(1, Math.ceil(h * scale));
    c.gw = w;
    c.gh = h;
    var cctx = c.getContext("2d");
    if (scale !== 1) cctx.scale(scale, scale);
    if (drawFn) drawFn(cctx, w, h);
    return c;
  }

  var glowCache = {};
  var glowCount = 0;
  var GLOW_MAX = 48;
  // Soft round glow: solid colour masked by a radial alpha ramp. Rasterised
  // at the device pixel ratio (cap 2); logical size is 2*radius.
  function glowSprite(color, radius) {
    var r = Math.max(2, Math.round(radius));
    var s = Math.min(2, Math.max(1, global.devicePixelRatio || 1));
    var key = color + "|" + r + "|" + s;
    if (glowCache[key]) return glowCache[key];
    if (glowCount >= GLOW_MAX) { glowCache = {}; glowCount = 0; }
    var c = bake(r * 2, r * 2, function (g) {
      g.fillStyle = color;
      g.fillRect(0, 0, r * 2, r * 2);
      var grad = g.createRadialGradient(r, r, 0, r, r, r);
      grad.addColorStop(0, "rgba(0,0,0,1)");
      grad.addColorStop(0.4, "rgba(0,0,0,0.7)");
      grad.addColorStop(1, "rgba(0,0,0,0)");
      g.globalCompositeOperation = "destination-in";
      g.fillStyle = grad;
      g.fillRect(0, 0, r * 2, r * 2);
    }, s);
    glowCache[key] = c;
    glowCount++;
    return c;
  }

  function drawGlow(ctx, color, radius, x, y, alpha) {
    var c = glowSprite(color, radius);
    var prev = ctx.globalAlpha;
    if (alpha != null) ctx.globalAlpha = prev * alpha;
    ctx.drawImage(c, x - c.gw / 2, y - c.gh / 2, c.gw, c.gh);
    if (alpha != null) ctx.globalAlpha = prev;
  }

  var tintCache = typeof WeakMap === "function" ? new WeakMap() : null;
  var tintCount = 0;
  var TINT_MAX = 32;
  // ctx.filter runs once here, never per frame. Returns an offscreen canvas
  // (with .gw/.gh = source size). If the browser has no ctx.filter the copy
  // comes back unfiltered, so callers never need a branch.
  function tint(img, filter) {
    var w = img.naturalWidth || img.width;
    var h = img.naturalHeight || img.height;
    if (!w || !h) return img; // not loaded yet: don't cache, caller retries
    var byFilter = tintCache && tintCache.get(img);
    if (byFilter && byFilter[filter]) return byFilter[filter];
    if (tintCache && tintCount >= TINT_MAX) { tintCache = new WeakMap(); tintCount = 0; byFilter = null; }
    var c = bake(w, h, function (g) {
      if ("filter" in g) g.filter = filter;
      g.drawImage(img, 0, 0, w, h);
    }, 1);
    if (tintCache) {
      if (!byFilter) { byFilter = {}; tintCache.set(img, byFilter); }
      byFilter[filter] = c;
      tintCount++;
    }
    return c;
  }

  var hasUserGesture = false;
  function registerUserGesture() {
    hasUserGesture = true;
    if (global.document) {
      ["click", "keydown", "pointerdown", "touchstart"].forEach(function (e) {
        global.document.removeEventListener(e, registerUserGesture, { capture: true });
      });
    }
  }
  if (global.document) {
    ["click", "keydown", "pointerdown", "touchstart"].forEach(function (e) {
      global.document.addEventListener(e, registerUserGesture, { capture: true, passive: true });
    });
  }

  // Runs fn once, on the next input the browser accepts as a user gesture for
  // media playback (autoplay policy). Returns a cancel function. These are the
  // "activation-triggering" events only: a touch's pointerdown does not unlock
  // audio, its touchend/pointerup does. "click" is left out on purpose: real
  // taps always fire one of these first, and a bare click (assistive tech) is
  // handled by whichever button received it.
  var GESTURE_EVENTS = ["mousedown", "pointerup", "touchend", "keydown"];
  function onNextGesture(fn) {
    if (!global.document) return function () {};
    var armed = true;
    function disarm() {
      armed = false;
      GESTURE_EVENTS.forEach(function (e) {
        global.document.removeEventListener(e, fire, true);
      });
    }
    function fire() {
      if (!armed) return;
      disarm();
      fn();
    }
    GESTURE_EVENTS.forEach(function (e) {
      global.document.addEventListener(e, fire, true);
    });
    return disarm;
  }

  /* ---------------- Audio ---------------- */
  // File-based sound (music loops, ambience, narration, stingers) goes through
  // a tiny "player" abstraction with two backends: Howler (vendored,
  // src/vendor/howler.min.js) and plain HTMLAudio (used only if Howler did not
  // load). A player is { want, play(), shot(), restart(), pause(), stop(),
  // setVolume(v), fadeTo(from, to, ms), unload() }; `want` is true between
  // play() and pause()/stop()/end/blocked, and play() is idempotent while it
  // is true. Callbacks (options): onend, onerror (load/decoding failure),
  // onblocked (the browser refused to start sound before a user gesture).
  // Streaming/long files use HTML5 mode (no full decode in memory, like the
  // old <audio>); short stingers use WebAudio with an HTML5 fallback (a
  // WebAudio load needs XHR, which file:// refuses).
  var BGM_FADE_MS = 2200;
  var SFX_CACHE_MAX = 8;
  var STINGERS = ["assets/audio/winning.mp3", "assets/audio/failed.mp3"];

  function now() { return global.performance ? global.performance.now() : Date.now(); }
  function clampVol(v) { v = +v; return v > 0 ? (v > 1 ? 1 : v) : 0; }
  function userActivated() {
    var ua = global.navigator && global.navigator.userActivation;
    return ua ? ua.hasBeenActive : hasUserGesture;
  }

  var howlerSetUp = false;
  function hasHowler() {
    if (!(global.Howl && global.Howler) || global.Howler.noAudio) return false;
    if (!howlerSetUp) {
      howlerSetUp = true;
      // Howler would suspend the shared AudioContext after 30 s without a
      // Howler sound, cutting off oscillator SFX / stage ambience that use
      // audio.ctx. Visibility suspend/resume is handled by Audio itself.
      try { global.Howler.autoSuspend = false; } catch (e) {}
    }
    return true;
  }

  // Howler quirk this works around: pause()/stop()/volume()/fade() called
  // while a load or a play() promise is still pending are put on Howler's
  // internal queue, which only advances on its own task events, so they can
  // wait forever. So nothing but play() ever goes to Howler unless the Howl is
  // "ready" (loaded and not mid-play); otherwise the wish is remembered
  // (want / rewind / vol / fade) and sync() applies it from the next
  // load / play event.
  // Howler's volume() ends a running fade by jumping to the fade's END value
  // (after applying the new one), which would pop. Stop the fade quietly first.
  function killFade(h) {
    var snds = h._sounds || [];
    for (var i = 0; i < snds.length; i++) {
      if (snds[i]._interval) {
        clearInterval(snds[i]._interval);
        snds[i]._interval = null;
        snds[i]._fadeTo = null;
      }
    }
  }

  function howlerPlayer(path, o) {
    var self = {
      want: false,
      rewind: false,
      pendingVol: false,
      fade: null,
      vol: clampVol(o.volume != null ? o.volume : 1),
      fellBack: false,
      h: null
    };
    function sync() {
      var h = self.h;
      if (!h || h.state() !== "loaded" || h._playLock) return;
      if (self.rewind) { self.rewind = false; h.stop(); }
      if (self.pendingVol) { self.pendingVol = false; killFade(h); h.volume(self.vol); }
      var playing = h.playing();
      if (self.want && !playing) { h.play(); return; } // continues on the 'play' event
      if (!self.want && playing) { h.pause(); playing = false; }
      if (self.fade && playing) {
        var f = self.fade;
        self.fade = null;
        self.vol = f[1];
        h.fade(f[0], f[1], f[2]);
      }
    }
    function build(html5) {
      return new global.Howl({
        src: [path],
        html5: html5,
        loop: !!o.loop,
        volume: self.vol,
        preload: true,
        onload: sync,
        onplay: sync,
        onend: function () {
          if (!o.loop) self.want = false;
          if (o.onend) o.onend();
        },
        onloaderror: function () {
          if (!html5 && !self.fellBack) {
            // WebAudio load failed (file://, decode error): retry streaming.
            self.fellBack = true;
            var old = self.h;
            self.h = build(true);
            try { old.unload(); } catch (e) {}
            return;
          }
          self.want = false;
          if (o.onerror) o.onerror();
        },
        onplayerror: function () {
          self.want = false;
          if (o.onblocked) o.onblocked();
        }
      });
    }
    self.h = build(!!o.html5);
    self.play = function () {
      if (self.want) return;
      self.want = true;
      sync();
    };
    self.shot = function () { self.h.play(); }; // overlapping one-shots
    self.pause = function () { self.want = false; sync(); };
    self.stop = function () { self.want = false; self.rewind = true; sync(); };
    self.restart = function () {
      self.want = true;
      self.rewind = true;
      sync();
    };
    self.setVolume = function (v) {
      self.vol = clampVol(v);
      self.pendingVol = true;
      self.fade = null; // an explicit volume ends a fade, as in Howler
      sync();
    };
    self.fadeTo = function (from, to, ms) {
      self.fade = [clampVol(from), clampVol(to), ms];
      sync();
    };
    self.unload = function () {
      self.want = false;
      self.fade = null;
      try { self.h.unload(); } catch (e) {}
    };
    return self;
  }

  function legacyPlayer(path, o) {
    var a = new global.Audio(path);
    a.loop = !!o.loop;
    a.preload = "auto";
    var self = { want: false, vol: clampVol(o.volume != null ? o.volume : 1), fade: null, a: a };
    a.volume = self.vol;
    function clearFade() {
      if (self.fade) { clearInterval(self.fade); self.fade = null; }
    }
    a.addEventListener("ended", function () {
      if (!o.loop) self.want = false;
      if (o.onend) o.onend();
    });
    a.addEventListener("error", function () {
      self.want = false;
      if (o.onerror) o.onerror();
    });
    function start(el) {
      var pr;
      try { pr = el.play(); } catch (e) {
        self.want = false;
        if (o.onerror) o.onerror();
        return;
      }
      if (pr && typeof pr.catch === "function") {
        pr.catch(function (err) {
          if (el !== a) return;
          self.want = false;
          if (err && err.name === "NotAllowedError") { if (o.onblocked) o.onblocked(); }
          else if (!(err && err.name === "AbortError") && o.onerror) o.onerror();
        });
      }
    }
    self.play = function () {
      if (self.want) return;
      self.want = true;
      start(a);
    };
    self.shot = function () {
      var c = new global.Audio(path);
      c.volume = self.vol;
      var pr = c.play();
      if (pr && typeof pr.catch === "function") pr.catch(function () {});
    };
    self.pause = function () { self.want = false; clearFade(); a.pause(); };
    self.stop = function () {
      self.want = false;
      clearFade();
      a.pause();
      try { a.currentTime = 0; } catch (e) {}
    };
    self.restart = function () { self.stop(); self.play(); };
    self.setVolume = function (v) { clearFade(); self.vol = clampVol(v); a.volume = self.vol; };
    self.fadeTo = function (from, to, ms) {
      clearFade();
      var t0 = now();
      from = clampVol(from);
      self.vol = clampVol(to);
      a.volume = from;
      self.fade = setInterval(function () {
        var t = (now() - t0) / ms;
        if (t >= 1) { clearFade(); a.volume = self.vol; return; }
        a.volume = from + (self.vol - from) * t;
      }, 100);
    };
    self.unload = function () {
      self.stop();
      a.removeAttribute("src");
      try { a.load(); } catch (e) {}
    };
    return self;
  }

  function makePlayer(path, o) {
    if (hasHowler()) {
      try { return howlerPlayer(path, o); } catch (e) {}
    }
    return legacyPlayer(path, o);
  }

  function Audio(muted) {
    this.muted = !!muted;
    this._ctx = null;
    this._bgmPlaying = false;
    this._bgmMaxVol = 0.35;
    this._bgmVol = this._bgmMaxVol;
    this._ambVol = this._bgmMaxVol;
    this._bgmApplied = -1;
    this._ambApplied = -1;
    this._fadeStart = 0;
    this._bgPlayer = null;
    this._ambPlayer = null;
    this._bgMusic = null;      // compatibility shim, see initBgm
    this._ambientMusic = null; // compatibility shim, see initBgm
    this._introBgm = null;
    this._introBgmCancel = null;
    this._narr = null;
    this._sfx = {};
    this._sfxOrder = [];
    this._warmTimer = null;
    this._warmed = false;
    this._hiddenResume = null;
    this._ctxSuspended = false;
    var self = this;
    onVisibility(function (visible) { self._onVisibility(visible); });
  }

  // The one shared AudioContext (Howler's, so oscillator SFX, Howler sounds
  // and a stage's own WebAudio never open a second context). null until the
  // browser has seen a user gesture. Falls back to an own context only when
  // Howler is not present.
  Audio.prototype._ensureCtx = function () {
    if (!userActivated()) return null;

    // Howler replaces its context once, early on (it rebuilds it when the
    // device sample rate is not 44100): never keep a stale/closed one.
    if (this._ctx && (this._ctx.state === "closed" ||
        (hasHowler() && global.Howler.ctx && this._ctx !== global.Howler.ctx))) {
      this._ctx = null;
    }
    if (!this._ctx) {
      if (hasHowler()) {
        if (!global.Howler.ctx) global.Howler.volume(); // creates Howler.ctx
        if (global.Howler.ctx) this._ctx = global.Howler.ctx;
      }
      if (!this._ctx) {
        var AC = global.AudioContext || global.webkitAudioContext;
        if (AC) this._ctx = new AC();
      }
    }
    if (this._ctx && this._ctx.state === "suspended" && !document.hidden) {
      this._ctx.resume().catch(function(){});
    }
    return this._ctx;
  };

  // `audio.ctx` for stages that build their own WebAudio graph (stage 5 wind):
  // same as _ensureCtx(), i.e. the shared context or null before a gesture.
  Object.defineProperty(Audio.prototype, "ctx", {
    get: function () { return this._ensureCtx(); }
  });

  // Pause on hide / resume on show: music + ambience (music only if it was
  // meant to be playing), the intro bed, a running narration clip, and the
  // shared AudioContext (silences stage ambience and SFX too).
  Audio.prototype._onVisibility = function (visible) {
    var c = this._ctx || (global.Howler && global.Howler.ctx) || null;
    if (!visible) {
      this._hiddenResume = {
        intro: !!(this._introBgm && this._introBgm.want),
        narr: !!(this._narr && this._narr.want)
      };
      if (this._bgPlayer) this._bgPlayer.pause();
      if (this._ambPlayer) this._ambPlayer.pause();
      if (this._introBgm) this._introBgm.pause();
      if (this._narr) this._narr.pause();
      if (c && c.state === "running" && typeof c.suspend === "function") {
        this._ctxSuspended = true;
        c.suspend().catch(function () {});
      }
      return;
    }
    if (c && this._ctxSuspended) {
      this._ctxSuspended = false;
      c.resume().catch(function () {});
    }
    var r = this._hiddenResume;
    this._hiddenResume = null;
    if (!this.muted && this._bgmPlaying) {
      if (this._bgPlayer) this._bgPlayer.play();
      if (this._ambPlayer) this._ambPlayer.play();
    }
    if (!r) return;
    if (r.intro && this._introBgm && !this.muted) this._introBgm.play();
    if (r.narr && this._narr) this._narr.play();
  };

  // Effective volume = stage-set volume x fade-in factor (the factor is only
  // below 1 for BGM_FADE_MS after playBgm, and is evaluated on every call so
  // stages that set the volume each frame still get a smooth fade-in).
  Audio.prototype._fadeMul = function () {
    if (!this._fadeStart) return 1;
    var t = (now() - this._fadeStart) / BGM_FADE_MS;
    if (t >= 1) { this._fadeStart = 0; return 1; }
    return t < 0 ? 0 : t;
  };

  // Music volume, 0..1 (before the global mute: muted music is paused).
  // Cheap to call every frame: unchanged values are ignored.
  Audio.prototype.setBgmVolume = function (v) {
    v = clampVol(v);
    if (v === this._bgmVol && !this._fadeStart) return;
    this._bgmVol = v;
    if (!this._bgPlayer) return;
    var eff = v * this._fadeMul();
    if (eff === this._bgmApplied) return;
    this._bgmApplied = eff;
    this._bgPlayer.setVolume(eff);
  };

  Audio.prototype.setAmbientVolume = function (v) {
    v = clampVol(v);
    if (v === this._ambVol && !this._fadeStart) return;
    this._ambVol = v;
    if (!this._ambPlayer) return;
    var eff = v * this._fadeMul();
    if (eff === this._ambApplied) return;
    this._ambApplied = eff;
    this._ambPlayer.setVolume(eff);
  };

  Audio.prototype.initBgm = function (musicPath, ambientPath, maxVolume) {
    var self = this;
    if (maxVolume !== undefined) {
      this._bgmMaxVol = maxVolume;
    }
    this._bgmVol = this._bgmMaxVol;
    this._ambVol = this._bgmMaxVol;
    this._bgmApplied = this._ambApplied = -1;
    if (this._bgPlayer) { this._bgPlayer.unload(); this._bgPlayer = null; }
    if (this._ambPlayer) { this._ambPlayer.unload(); this._ambPlayer = null; }
    this._bgMusic = this._ambientMusic = null;

    if (musicPath) {
      this._bgPlayer = makePlayer(musicPath, { loop: true, html5: true, volume: this._bgmVol });
      // Compatibility shim: stages 2/3 still assign audio._bgMusic.volume
      // every step. Forwards to setBgmVolume (which ignores unchanged values).
      this._bgMusic = {
        get volume() { return self._bgmVol; },
        set volume(v) { self.setBgmVolume(v); },
        get paused() { return !(self._bgPlayer && self._bgPlayer.want); },
        play: function () { if (self._bgPlayer) self._bgPlayer.play(); },
        pause: function () { if (self._bgPlayer) self._bgPlayer.pause(); }
      };
    }

    if (ambientPath) {
      this._ambPlayer = makePlayer(ambientPath, { loop: true, html5: true, volume: this._ambVol });
      this._ambientMusic = {
        get volume() { return self._ambVol; },
        set volume(v) { self.setAmbientVolume(v); },
        get paused() { return !(self._ambPlayer && self._ambPlayer.want); },
        play: function () { if (self._ambPlayer) self._ambPlayer.play(); },
        pause: function () { if (self._ambPlayer) self._ambPlayer.pause(); }
      };
    }

    this._scheduleWarm();

    // Gesture fallback listener to kick off background music and context
    function resumeAudioOnGesture() {
      self._ensureCtx();
      if (!self.muted && self._bgmPlaying) {
        if (self._bgPlayer) self._bgPlayer.play();
        if (self._ambPlayer) self._ambPlayer.play();
      }
      ["click", "keydown", "pointerdown", "touchstart"].forEach(function (e) {
        document.removeEventListener(e, resumeAudioOnGesture);
      });
    }
    ["click", "keydown", "pointerdown", "touchstart"].forEach(function (e) {
      document.addEventListener(e, resumeAudioOnGesture);
    });
  };

  // Preload the shared win/lose stingers a moment after the stage is up, so
  // the page load itself is never held back by them.
  Audio.prototype._scheduleWarm = function () {
    if (this._warmed || this._warmTimer || this.muted) return;
    var self = this;
    this._warmTimer = setTimeout(function () {
      self._warmTimer = null;
      if (self.muted || self._warmed) return;
      self._warmed = true;
      STINGERS.forEach(function (p) { self._sfxPlayer(p); });
    }, 1500);
  };

  Audio.prototype._sfxPlayer = function (path) {
    var p = this._sfx[path];
    if (p) return p;
    // WebAudio needs XHR, which file:// refuses: stream there instead.
    p = this._sfx[path] = makePlayer(path, { html5: global.location.protocol === "file:", volume: 0.65 });
    this._sfxOrder.push(path);
    if (this._sfxOrder.length > SFX_CACHE_MAX) {
      var old = this._sfxOrder.shift();
      if (this._sfx[old]) { this._sfx[old].unload(); delete this._sfx[old]; }
    }
    return p;
  };

  Audio.prototype.playBgm = function () {
    this._bgmPlaying = true;
    if (this.muted) return;

    // Fade both beds in from silence (Howler does the ramp; no timers here).
    this._fadeStart = now();
    this._bgmApplied = this._ambApplied = -1;
    if (this._bgPlayer) {
      this._bgPlayer.setVolume(0);
      this._bgPlayer.restart();
      this._bgPlayer.fadeTo(0, this._bgmVol, BGM_FADE_MS);
    }
    if (this._ambPlayer) {
      this._ambPlayer.setVolume(0);
      this._ambPlayer.restart();
      this._ambPlayer.fadeTo(0, this._ambVol, BGM_FADE_MS);
    }
  };

  Audio.prototype.stopBgm = function () {
    this._bgmPlaying = false;
    this._fadeStart = 0;
    if (this._bgPlayer) this._bgPlayer.stop();
    if (this._ambPlayer) this._ambPlayer.stop();
  };

  Audio.prototype.setMuted = function (muted) {
    this.muted = !!muted;
    if (this.muted) {
      if (this._bgPlayer) this._bgPlayer.pause();
      if (this._ambPlayer) this._ambPlayer.pause();
      if (this._introBgm) this._introBgm.pause();
    } else {
      this._scheduleWarm();
      if (this._bgmPlaying) {
        // a fade that was cut short by the mute must not leave the music quiet
        this._fadeStart = 0;
        this._bgmApplied = this._ambApplied = -1;
        if (this._bgPlayer) { this._bgPlayer.setVolume(this._bgmVol); this._bgPlayer.play(); }
        if (this._ambPlayer) { this._ambPlayer.setVolume(this._ambVol); this._ambPlayer.play(); }
      }
    }
  };

  // A quiet, looping music bed for the pre-game "meet the guardian" beat.
  // Kept on its own channel (separate from initBgm/playBgm's gameplay music)
  // since it plays underneath spoken narration and must stay low enough for
  // the guardian's voice line to read clearly over it.
  Audio.prototype.playIntroBgm = function (path, volume) {
    this.stopIntroBgm();
    if (this.muted) return null;
    try {
      var self = this;
      var clip = makePlayer(path, {
        loop: true,
        html5: true,
        volume: volume != null ? volume : 0.08,
        onblocked: function () {
          // Autoplay blocked (direct page load, iOS/Safari): start on the first tap.
          if (self._introBgm !== clip) return;
          if (self._introBgmCancel) self._introBgmCancel();
          self._introBgmCancel = onNextGesture(function () {
            self._introBgmCancel = null;
            setTimeout(function () { if (self._introBgm === clip && !self.muted) clip.play(); }, 80);
          });
        }
      });
      this._introBgm = clip;
      clip.play();
      return clip;
    } catch (e) {
      return null;
    }
  };

  Audio.prototype.stopIntroBgm = function () {
    if (this._introBgmCancel) {
      this._introBgmCancel();
      this._introBgmCancel = null;
    }
    if (this._introBgm) {
      var clip = this._introBgm;
      this._introBgm = null;
      try { clip.stop(); } catch (e) {}
      setTimeout(function () { clip.unload(); }, 0);
    }
  };

  Audio.prototype.tone = function (freq, dur, type, peak, glideTo, delay) {
    if (this.muted) return;
    var ctx = this._ensureCtx();
    if (!ctx) return;
    var t0 = ctx.currentTime + (delay || 0);
    var osc = ctx.createOscillator();
    var g = ctx.createGain();
    osc.type = type || "sine";
    osc.frequency.setValueAtTime(freq, t0);
    if (glideTo) {
      osc.frequency.exponentialRampToValueAtTime(glideTo, t0 + dur);
    }
    var p = peak != null ? peak : 0.05;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(p, t0 + Math.min(0.02, dur * 0.15));
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g);
    g.connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.03);

    osc.onended = function () {
      osc.disconnect();
      g.disconnect();
    };
  };

  Audio.prototype.blip = function (freq, durationMs, type) {
    this.tone(freq || 660, (durationMs || 140) / 1000, type || "sine");
  };

  Audio.prototype.collect = function () {
    this.tone(660, 0.14, 'triangle', 0.1, 880);
    this.tone(990, 0.13, 'triangle', 0.08, 1200, 0.06);
  };
  Audio.prototype.hazard = function () {
    this.tone(180, 0.22, 'sawtooth', 0.06, 110);
  };
  Audio.prototype.oops = function () {
    this.tone(300, 0.15, 'sawtooth', 0.08, 150);
    this.tone(200, 0.22, 'sawtooth', 0.07, 100, 0.08);
  };
  Audio.prototype.heal = function () {
    this.tone(440, 0.12, 'sine', 0.08, 660);
    this.tone(554, 0.12, 'sine', 0.08, 880, 0.06);
    this.tone(659, 0.16, 'sine', 0.06, 1100, 0.12);
  };
  Audio.prototype.grow = function () {
    this.tone(160, 0.5, 'sine', 0.1, 420);
  };
  Audio.prototype.fly = function () {
    this.tone(500, 0.35, 'sine', 0.08, 900);
  };
  Audio.prototype.bloom = function () {
    var self = this;
    [523, 659, 784, 1046].forEach(function (f, i) {
      self.tone(f, 0.22, 'triangle', 0.08, null, i * 0.09);
    });
  };
  Audio.prototype.playSfxFile = function (path) {
    if (this.muted) return;
    try {
      this._sfxPlayer(path).shot();
    } catch (e) {
      console.warn("SFX play failed:", e);
    }
  };

  // Plays a one-shot narration clip and reports back when the stage is clear
  // to proceed. Per project requirement, intro/outro narration gates progression:
  // callers must not let the player continue until onEnded fires. If sound is
  // muted there is nothing to wait on, so onEnded fires immediately; a load/
  // playback error also resolves immediately rather than soft-locking the stage,
  // and a safety timeout covers a clip whose "ended" event never fires for any
  // other reason. onEnded(reason) says why: "ended" | "muted" | "error" |
  // "blocked" | "timeout".
  //
  // Intro lines are meant to start on their own, but browsers refuse sound
  // before the first tap (direct page load, iOS/Safari). A caller that passes
  // opts.onBlocked(resume) opts in to waiting for that tap instead of skipping
  // the line: the clip starts on the first tap anywhere (or when the caller
  // invokes resume() from its own button), and opts.onResume() fires just
  // before it does, so the UI can flip back to its "listening" state. A caller
  // without onBlocked keeps the old behavior (resolve immediately as "blocked").
  //
  // (Howler reports a refused start as a generic "playerror", so any play
  // error counts as blocked, as a NotAllowedError did before.)
  Audio.prototype.playNarration = function (path, opts) {
    opts = opts || {};
    var onEnded = opts.onEnded || function () {};
    if (this.muted) {
      onEnded("muted");
      return null;
    }
    var self = this;
    var done = false;
    var waiting = false;
    var retries = 0;
    var safety = null;
    var cancelGesture = null;
    var clip;

    function finish(reason) {
      if (done) return;
      done = true;
      clearTimeout(safety);
      if (cancelGesture) cancelGesture();
      if (self._narr === clip) self._narr = null;
      setTimeout(function () { if (clip) clip.unload(); }, 0);
      onEnded(typeof reason === "string" ? reason : "ended");
    }

    function resume() {
      if (done || !waiting) return;
      waiting = false;
      if (cancelGesture) {
        cancelGesture();
        cancelGesture = null;
      }
      if (opts.onResume) opts.onResume();
      // Let Howler's own first-gesture unlock (it re-loads its pooled <audio> nodes)
      // finish before we start, otherwise it aborts our play() on the very same tap.
      setTimeout(begin, 80);
    }

    function blocked() {
      if (done) return;
      if (opts.onBlocked && retries < 3) {
        retries++;
        waiting = true;
        clearTimeout(safety); // waiting on the child, not on the clip
        cancelGesture = onNextGesture(resume);
        opts.onBlocked(resume);
      } else {
        finish("blocked");
      }
    }

    function begin() {
      if (done) return;
      clearTimeout(safety);
      safety = setTimeout(function () { finish("timeout"); }, opts.maxWaitMs || 20000);
      try {
        clip.play();
      } catch (e) {
        finish("error");
      }
    }

    try {
      clip = makePlayer(path, {
        html5: true,
        volume: 1,
        onend: function () { finish("ended"); },
        onerror: function () { finish("error"); },
        onblocked: blocked
      });
    } catch (e) {
      onEnded("error");
      return null;
    }
    this._narr = clip;
    begin();
    return clip;
  };

  Audio.prototype.win = function () {
    this.bloom();
    this.playSfxFile("assets/audio/winning.mp3");
  };

  Audio.prototype.lose = function () {
    this.oops();
    this.playSfxFile("assets/audio/failed.mp3");
  };

  /* ---------------- Sharp (hi-DPI) canvas ---------------- */
  // Keeps the stage's fixed logical coordinate space (e.g. 800x600) but sizes
  // the canvas backing store to the pixels actually shown on screen
  // (css size x devicePixelRatio). Without this the browser bilinear-stretches
  // a small bitmap to fill the frame, which is what makes sprites and
  // backgrounds look soft. Stages keep drawing in logical coordinates because
  // the context transform is scaled for them; call onResize(scale) to rebuild
  // any cached offscreen art at the new resolution.
  //
  // Fill-rate budget (Android WebView): the scale is capped at maxScale (default
  // 1.5) AND so that bitmap pixels stay under maxPixels (default 1.3 Mpx), but
  // never goes below 1. imageSmoothingQuality is "low": "high" costs a lot per
  // drawImage on mobile GPUs for a difference nobody sees at <= 1.5x.
  function fitCanvas(canvas, ctx, logicalW, logicalH, opts) {
    opts = opts || {};
    var maxScale = opts.maxScale || 1.5;
    var maxPixels = opts.maxPixels || 1.3e6;
    var api = { scale: 1 };
    canvas._gogW = logicalW; // Input maps pointers to logical coordinates with these
    canvas._gogH = logicalH;

    function apply() {
      var rect = canvas.getBoundingClientRect();
      if (!rect.width) return;
      var dpr = global.devicePixelRatio || 1;
      var scale = Math.max(1, Math.min(maxScale, (rect.width * dpr) / logicalW));
      scale = Math.round(scale * 4) / 4; // snap so tiny layout shifts don't realloc the bitmap
      while (scale > 1 && logicalW * logicalH * scale * scale > maxPixels) {
        scale = Math.max(1, scale - 0.25);
      }
      var pw = Math.round(logicalW * scale);
      var ph = Math.round(logicalH * scale);
      if (canvas.width !== pw || canvas.height !== ph) {
        canvas.width = pw; // also clears the canvas: make every loop repaint
        canvas.height = ph;
        requestDraw();
      }
      ctx.setTransform(scale, 0, 0, scale, 0, 0);
      ctx.imageSmoothingEnabled = true;
      if ("imageSmoothingQuality" in ctx) ctx.imageSmoothingQuality = "low";
      if (scale !== api.scale || !api.ready) {
        api.scale = scale;
        api.ready = true;
        if (opts.onResize) opts.onResize(scale);
      }
    }

    apply();
    if (typeof ResizeObserver === "function") {
      new ResizeObserver(apply).observe(canvas); // also fires on window resize / rotate
    } else {
      global.addEventListener("resize", apply);
    }
    api.refit = apply;
    return api;
  }

  /* ---------------- Phone-portrait full-screen canvas ---------------- */
  // On phones held upright the stage's canvas frame fills the whole screen (see
  // the body[data-gog-fullscreen] block in styles.css). A fixed landscape canvas
  // (960x600 / 800x600) would be shrunk to ~40% there, so match the canvas'
  // internal aspect to the frame instead: height stays at the stage's tuned value
  // and only the world gets narrower. Call BEFORE reading canvas.width/height.
  // Rotating across the phone-portrait breakpoint reloads, because the size is
  // fixed at load. Returns true when the canvas was resized.
  var PHONE_PORTRAIT_QUERY = "(max-width: 768px) and (orientation: portrait)";
  function fitCanvasToScreen(canvas, frame, opts) {
    opts = opts || {};
    var mq = window.matchMedia(PHONE_PORTRAIT_QUERY);
    var wasPhone = mq.matches;
    function onChange() {
      if (mq.matches !== wasPhone) window.location.reload();
    }
    if (mq.addEventListener) mq.addEventListener("change", onChange);
    else if (mq.addListener) mq.addListener(onChange);

    if (!wasPhone || !frame) return false;
    var fw = frame.clientWidth, fh = frame.clientHeight;
    if (fw < 100 || fh < 100) return false;
    var baseH = opts.height || canvas.height;
    var maxW = opts.maxWidth || canvas.width;
    var minW = opts.minWidth || 300;
    canvas.height = baseH;
    canvas.width = Math.round(Math.max(minW, Math.min(maxW, (baseH * fw) / fh)));
    return true;
  }

  var GOGEngine = {
    fitCanvasToScreen: fitCanvasToScreen,
    GameLoop: GameLoop,
    Input: Input,
    Collision: Collision,
    ParticleSystem: ParticleSystem,
    Audio: Audio,
    onNextGesture: onNextGesture,
    fitCanvas: fitCanvas,
    EmojiSprite: EmojiSprite,
    onVisibility: onVisibility,
    requestDraw: requestDraw,
    bake: bake,
    glowSprite: glowSprite,
    drawGlow: drawGlow,
    tint: tint
  };
  // GOGEngine.visible: true while the page is shown (live getter).
  Object.defineProperty(GOGEngine, "visible", {
    enumerable: true,
    get: function () { return !(global.document && global.document.hidden); }
  });
  global.GOGEngine = GOGEngine;
})(window);
