/* ============================================================
   GUARDIANS OF GAIA — SHARED ENGINE
   The reusable core every stage imports. Fixed-timestep loop,
   unified pointer/keyboard input, lightweight collision helpers,
   a pooled particle system, and a mute-aware audio wrapper.
   No dependencies, no build step — plain script, works on file://
   and on any cheap host.
   ============================================================ */

(function (global) {
  "use strict";

  /* ---------------- GameLoop ---------------- */
  // Fixed-timestep update with delta-time normalization, RAF-driven.
  function GameLoop(opts) {
    this.update = opts.update || function () {};
    this.draw = opts.draw || function () {};
    this.stepMs = opts.stepMs || (1000 / 60);
    this._acc = 0;
    this._last = 0;
    this._running = false;
    this._raf = null;
    this._maxStepsPerFrame = 5; // avoid spiral-of-death on tab-resume
    this._onVisibility = this._onVisibility.bind(this);
  }

  GameLoop.prototype.start = function () {
    if (this._running) return;
    this._running = true;
    this._last = performance.now();
    document.addEventListener("visibilitychange", this._onVisibility);
    var self = this;
    function frame(now) {
      if (!self._running) return;
      var dtMs = now - self._last;
      self._last = now;
      if (dtMs > 250) dtMs = 250; // clamp huge gaps (tab was hidden)
      self._acc += dtMs;
      var steps = 0;
      while (self._acc >= self.stepMs && steps < self._maxStepsPerFrame) {
        self.update(self.stepMs / 1000);
        self._acc -= self.stepMs;
        steps++;
      }
      self.draw();
      self._raf = requestAnimationFrame(frame);
    }
    this._raf = requestAnimationFrame(frame);
  };

  GameLoop.prototype.stop = function () {
    this._running = false;
    if (this._raf) cancelAnimationFrame(this._raf);
    document.removeEventListener("visibilitychange", this._onVisibility);
  };

  GameLoop.prototype._onVisibility = function () {
    // Pause-friendly: when tab is hidden, just stop accumulating huge deltas.
    if (!document.hidden) this._last = performance.now();
  };

  /* ---------------- Input ---------------- */
  // Unified pointer (mouse/touch/pen) + keyboard. Reads canvas-relative
  // coordinates so stages don't each re-derive bounding rects.
  function Input(canvas) {
    this.canvas = canvas;
    this.pointer = { x: 0, y: 0, down: false, active: false };
    this.keys = {};
    this._bind();
  }

  Input.prototype._toCanvasXY = function (clientX, clientY) {
    var rect = this.canvas.getBoundingClientRect();
    var scaleX = this.canvas.width / rect.width;
    var scaleY = this.canvas.height / rect.height;
    return {
      x: (clientX - rect.left) * scaleX,
      y: (clientY - rect.top) * scaleY
    };
  };

  Input.prototype._bind = function () {
    var self = this;

    function setFromEvent(e, down) {
      var point = e.touches && e.touches[0] ? e.touches[0] : e;
      var xy = self._toCanvasXY(point.clientX, point.clientY);
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
      p.text = Array.isArray(opts.glyphs) ? opts.glyphs[Math.floor(Math.random() * opts.glyphs.length)] : (opts.glyph || "\u2728");
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

  ParticleSystem.prototype.draw = function (ctx) {
    for (var i = 0; i < this.pool.length; i++) {
      var p = this.pool[i];
      if (!p.active) continue;
      var t = p.life / p.maxLife;
      var alpha = 1 - t;
      ctx.save();
      ctx.globalAlpha = Math.max(0, alpha);
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rotation);
      ctx.font = p.size + "px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(p.text, 0, 0);
      ctx.restore();
    }
  };

  /* ---------------- Audio ---------------- */
  // Minimal Web Audio wrapper. Mute-aware, respects save settings.
  // v1 ships with simple synthesized blips so there's zero asset weight;
  // swapping in real SFX/ambient files later is a one-line change.
  function Audio(muted) {
    this.muted = !!muted;
    this._ctx = null;
  }

  Audio.prototype._ensureCtx = function () {
    if (!this._ctx) {
      var AC = global.AudioContext || global.webkitAudioContext;
      if (AC) this._ctx = new AC();
    }
    return this._ctx;
  };

  Audio.prototype.setMuted = function (muted) { this.muted = muted; };

  Audio.prototype.blip = function (freq, durationMs, type) {
    if (this.muted) return;
    var ctx = this._ensureCtx();
    if (!ctx) return;
    var osc = ctx.createOscillator();
    var gain = ctx.createGain();
    osc.type = type || "sine";
    osc.frequency.value = freq || 660;
    gain.gain.value = 0.05;
    osc.connect(gain);
    gain.connect(ctx.destination);
    var now = ctx.currentTime;
    gain.gain.setValueAtTime(0.06, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + (durationMs || 140) / 1000);
    osc.start(now);
    osc.stop(now + (durationMs || 140) / 1000);
  };

  Audio.prototype.collect = function () { this.blip(880, 110, "triangle"); };
  Audio.prototype.hazard = function () { this.blip(160, 180, "sawtooth"); };
  Audio.prototype.win = function () {
    var self = this;
    [523, 659, 784, 1046].forEach(function (f, i) {
      setTimeout(function () { self.blip(f, 160, "triangle"); }, i * 90);
    });
  };

  global.GOGEngine = {
    GameLoop: GameLoop,
    Input: Input,
    Collision: Collision,
    ParticleSystem: ParticleSystem,
    Audio: Audio
  };
})(window);
