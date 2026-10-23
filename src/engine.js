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

  var EmojiSprite = (function () {
    var cache = {};
    function get(glyph, size) {
      var rounded = Math.round(size / 2) * 2; // round to nearest 2px to maximize cache hits
      var key = glyph + "_" + rounded;
      if (cache[key]) return cache[key];
      var pad = rounded * 0.4;
      var c = document.createElement("canvas");
      c.width = c.height = rounded + pad * 2;
      var cctx = c.getContext("2d");
      cctx.font = rounded + "px sans-serif";
      cctx.textAlign = "center";
      cctx.textBaseline = "middle";
      cctx.fillText(glyph, c.width / 2, c.height / 2);
      cache[key] = c;
      return c;
    }
    return { get: get };
  })();
  global.EmojiSprite = EmojiSprite; // expose alongside GOGEngine

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
      if (steps >= self._maxStepsPerFrame && self._acc >= self.stepMs) {
        self._acc = 0;
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
      var sprite = EmojiSprite.get(p.text, p.size);
      ctx.drawImage(sprite, -sprite.width / 2, -sprite.height / 2);
      ctx.restore();
    }
  };

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

  function Audio(muted) {
    this.muted = !!muted;
    this._ctx = null;
    this._bgmPlaying = false;
    this._bgmMaxVol = 0.35;
    this._bgMusic = null;
    this._ambientMusic = null;
    this._introBgm = null;
    this._introBgmCancel = null;
  }

  Audio.prototype._ensureCtx = function () {
    var activated = false;
    if (global.navigator && global.navigator.userActivation) {
      activated = global.navigator.userActivation.hasBeenActive;
    } else {
      activated = hasUserGesture;
    }

    if (!activated) {
      return null;
    }

    if (!this._ctx) {
      var AC = global.AudioContext || global.webkitAudioContext;
      if (AC) this._ctx = new AC();
    }
    if (this._ctx && this._ctx.state === "suspended") {
      this._ctx.resume().catch(function(){});
    }
    return this._ctx;
  };

  Audio.prototype.initBgm = function (musicPath, ambientPath, maxVolume) {
    var self = this;
    if (maxVolume !== undefined) {
      this._bgmMaxVol = maxVolume;
    }

    if (musicPath) {
      this._bgMusic = new global.Audio(musicPath);
      this._bgMusic.loop = true;
      this._bgMusic.volume = this._bgmMaxVol;
      this._bgMusic.preload = "auto";
    }

    if (ambientPath) {
      this._ambientMusic = new global.Audio(ambientPath);
      this._ambientMusic.loop = true;
      this._ambientMusic.volume = this._bgmMaxVol;
      this._ambientMusic.preload = "auto";
    }

    // Auto pause/resume background music on visibility changes
    document.addEventListener("visibilitychange", function () {
      if (document.hidden) {
        if (self._bgMusic) self._bgMusic.pause();
        if (self._ambientMusic) self._ambientMusic.pause();
      } else if (!self.muted && self._bgmPlaying) {
        if (self._bgMusic) self._bgMusic.play().catch(function () {});
        if (self._ambientMusic) self._ambientMusic.play().catch(function () {});
      }
    });

    // Gesture fallback listener to kick off background music and context
    function resumeAudioOnGesture() {
      self._ensureCtx();
      if (!self.muted && self._bgmPlaying) {
        if (self._bgMusic && self._bgMusic.paused) self._bgMusic.play().catch(function () {});
        if (self._ambientMusic && self._ambientMusic.paused) self._ambientMusic.play().catch(function () {});
      }
      ["click", "keydown", "pointerdown", "touchstart"].forEach(function (e) {
        document.removeEventListener(e, resumeAudioOnGesture);
      });
    }
    ["click", "keydown", "pointerdown", "touchstart"].forEach(function (e) {
      document.addEventListener(e, resumeAudioOnGesture);
    });
  };

  Audio.prototype.playBgm = function () {
    this._bgmPlaying = true;
    if (this.muted) return;
    
    var self = this;
    var plays = [];
    if (this._bgMusic) {
      this._bgMusic.volume = 0;
      this._bgMusic.currentTime = 0;
      plays.push(this._bgMusic.play());
    }
    if (this._ambientMusic) {
      this._ambientMusic.volume = 0;
      this._ambientMusic.currentTime = 0;
      plays.push(this._ambientMusic.play());
    }

    if (plays.length > 0) {
      Promise.all(plays)
        .then(function () {
          var v = 0;
          var fade = setInterval(function () {
            v += 0.02;
            if (self._bgMusic) self._bgMusic.volume = Math.min(v, self._bgmMaxVol);
            if (self._ambientMusic) self._ambientMusic.volume = Math.min(v, self._bgmMaxVol);
            if (v >= self._bgmMaxVol) clearInterval(fade);
          }, 120);
        })
        .catch(function () {});
    }
  };

  Audio.prototype.stopBgm = function () {
    this._bgmPlaying = false;
    if (this._bgMusic) {
      this._bgMusic.pause();
      this._bgMusic.currentTime = 0;
    }
    if (this._ambientMusic) {
      this._ambientMusic.pause();
      this._ambientMusic.currentTime = 0;
    }
  };

  Audio.prototype.setMuted = function (muted) {
    this.muted = !!muted;
    if (this.muted) {
      if (this._bgMusic) this._bgMusic.pause();
      if (this._ambientMusic) this._ambientMusic.pause();
      if (this._introBgm) this._introBgm.pause();
    } else if (this._bgmPlaying) {
      if (this._bgMusic && this._bgMusic.paused) this._bgMusic.play().catch(function () {});
      if (this._ambientMusic && this._ambientMusic.paused) this._ambientMusic.play().catch(function () {});
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
      var clip = new global.Audio(path);
      clip.loop = true;
      clip.volume = volume != null ? volume : 0.08;
      var self = this;
      var playPromise = clip.play();
      if (playPromise && typeof playPromise.catch === "function") {
        playPromise.catch(function (err) {
          // Autoplay blocked (direct page load, iOS/Safari): start on the first tap.
          if (err && err.name === "NotAllowedError" && self._introBgm === clip) {
            self._introBgmCancel = onNextGesture(function () {
              self._introBgmCancel = null;
              if (self._introBgm === clip && !self.muted) clip.play().catch(function () {});
            });
          }
        });
      }
      this._introBgm = clip;
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
      try {
        this._introBgm.pause();
        this._introBgm.currentTime = 0;
      } catch (e) {}
      this._introBgm = null;
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
      var sfx = new global.Audio(path);
      sfx.volume = 0.65;
      sfx.play();
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
  Audio.prototype.playNarration = function (path, opts) {
    opts = opts || {};
    var onEnded = opts.onEnded || function () {};
    if (this.muted) {
      onEnded("muted");
      return null;
    }
    var clip;
    try {
      clip = new global.Audio(path);
    } catch (e) {
      onEnded("error");
      return null;
    }
    var done = false;
    var waiting = false;
    var retries = 0;
    var safety = null;
    var cancelGesture = null;

    function finish(reason) {
      if (done) return;
      done = true;
      clearTimeout(safety);
      if (cancelGesture) cancelGesture();
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
      begin();
    }

    function begin() {
      if (done) return;
      clearTimeout(safety);
      safety = setTimeout(function () { finish("timeout"); }, opts.maxWaitMs || 20000);
      var playPromise;
      try {
        playPromise = clip.play();
      } catch (e) {
        finish("error");
        return;
      }
      if (playPromise && typeof playPromise.catch === "function") {
        playPromise.catch(function (err) {
          if (done) return;
          var blocked = !!(err && err.name === "NotAllowedError");
          if (blocked && opts.onBlocked && retries < 3) {
            retries++;
            waiting = true;
            clearTimeout(safety); // waiting on the child, not on the clip
            cancelGesture = onNextGesture(resume);
            opts.onBlocked(resume);
          } else {
            finish(blocked ? "blocked" : "error");
          }
        });
      }
    }

    clip.addEventListener("ended", function () { finish("ended"); });
    clip.addEventListener("error", function () { finish("error"); });
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
  function fitCanvas(canvas, ctx, logicalW, logicalH, opts) {
    opts = opts || {};
    var maxScale = opts.maxScale || 2;
    var api = { scale: 1 };

    function apply() {
      var rect = canvas.getBoundingClientRect();
      if (!rect.width) return;
      var dpr = global.devicePixelRatio || 1;
      var scale = Math.max(1, Math.min(maxScale, (rect.width * dpr) / logicalW));
      scale = Math.round(scale * 4) / 4; // snap so tiny layout shifts don't realloc the bitmap
      var pw = Math.round(logicalW * scale);
      var ph = Math.round(logicalH * scale);
      if (canvas.width !== pw || canvas.height !== ph) {
        canvas.width = pw;
        canvas.height = ph;
      }
      ctx.setTransform(scale, 0, 0, scale, 0, 0);
      ctx.imageSmoothingEnabled = true;
      if ("imageSmoothingQuality" in ctx) ctx.imageSmoothingQuality = "high";
      if (scale !== api.scale || !api.ready) {
        api.scale = scale;
        api.ready = true;
        if (opts.onResize) opts.onResize(scale);
      }
    }

    apply();
    if (typeof ResizeObserver === "function") {
      new ResizeObserver(apply).observe(canvas);
    }
    global.addEventListener("resize", apply);
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

  global.GOGEngine = {
    fitCanvasToScreen: fitCanvasToScreen,
    GameLoop: GameLoop,
    Input: Input,
    Collision: Collision,
    ParticleSystem: ParticleSystem,
    Audio: Audio,
    onNextGesture: onNextGesture,
    fitCanvas: fitCanvas
  };
})(window);
