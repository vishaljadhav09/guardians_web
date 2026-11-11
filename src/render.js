/* ============================================================
   GUARDIANS OF GAIA — RENDER (PixiJS v8 adapter)
   The only file that talks to Pixi. Stages call GOGRender.create() instead of
   canvas.getContext("2d") and build a retained scene graph; GOGEngine.GameLoop
   still owns the fixed-step update and calls R.render() from draw().

   Load order: vendor/pixi.min.js (global PIXI), engine.js, scenery.js (optional), render.js.

   Rules of the house (see CLAUDE.md "Rendering"):
     - Static art is painted ONCE with Canvas2D (GOGEngine.bake / GOGScenery painters) and
       becomes a texture; per frame we only move sprites. No per-frame gradients.
     - Dynamic shapes use a pooled Graphics/Sprite list (GOGRender.pool) or one Graphics that is cleared + redrawn.
     - Pixi v8 has no Canvas fallback: create() rejects and shows a friendly message when WebGL is missing.
     - Effects stay flat/crisp (ColorMatrix grade, squash/stretch, hard-edged sparkles). No blur, no glow.
   ============================================================ */
(function (global) {
  "use strict";

  var P = global.PIXI;
  var INK = 0x111111;

  /* ---------------- capability ---------------- */
  function webglOk() {
    try {
      var c = document.createElement("canvas");
      return !!(c.getContext("webgl2") || c.getContext("webgl"));
    } catch (e) {
      return false;
    }
  }

  function showUnsupported(frame) {
    if (!frame || frame.querySelector(".gog-nowebgl")) return;
    var d = document.createElement("div");
    d.className = "gog-nowebgl";
    d.setAttribute("role", "alert");
    d.style.cssText =
      "position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;" +
      "gap:10px;padding:20px;text-align:center;background:#FFFDF8;color:#111;font:700 1.1rem Baloo 2,sans-serif;z-index:50";
    d.innerHTML = "<div style='font-size:3rem'>🌍</div><div>This device can't show the game yet.</div>" +
      "<div style='font:600 .9rem Quicksand,sans-serif'>Please update your browser.</div>";
    frame.appendChild(d);
  }

  /* ---------------- scale policy (same budget as the old fitCanvas) ---------------- */
  function pickScale(rectW, W, H, o) {
    var dpr = global.devicePixelRatio || 1;
    var maxScale = o.maxScale || 1.5;
    var maxPixels = o.maxPixels || 1.3e6;
    var s = Math.max(1, Math.min(maxScale, (rectW * dpr) / W));
    s = Math.round(s * 4) / 4;
    while (s > 1 && W * H * s * s > maxPixels) s = Math.max(1, s - 0.25);
    return s;
  }

  function requestDraw() {
    if (global.GOGEngine && typeof global.GOGEngine.requestDraw === "function") global.GOGEngine.requestDraw();
  }

  /* ---------------- textures ---------------- */
  var texCache = typeof WeakMap === "function" ? new WeakMap() : null;

  // Texture for an HTMLImageElement / HTMLCanvasElement / ImageBitmap (cached per source).
  // o.nearest: crisp pixel art (no smoothing).
  function tex(src, o) {
    if (src && src.source && src.frame) return src; // already a Pixi Texture
    var t = texCache && texCache.get(src);
    if (!t) {
      t = P.Texture.from(src);
      if (o && o.nearest) t.source.scaleMode = "nearest";
      if (texCache) texCache.set(src, t);
    }
    return t;
  }

  // Sub-rectangle of a texture/image (sprite-sheet frame), in source pixels.
  function frame(base, x, y, w, h) {
    var b = tex(base);
    return new P.Texture({ source: b.source, frame: new P.Rectangle(x, y, w, h) });
  }

  // Uniform grid sheet -> array of frame textures (row-major). count defaults to cols*rows.
  function sheet(base, fw, fh, count, o) {
    var b = tex(base, o);
    var sw = b.source.pixelWidth || b.width;
    var sh = b.source.pixelHeight || b.height;
    var cols = Math.floor(sw / fw), rows = Math.floor(sh / fh);
    var n = count || cols * rows;
    var out = [];
    for (var i = 0; i < n; i++) out.push(frame(b, (i % cols) * fw, Math.floor(i / cols) * fh, fw, fh));
    return out;
  }

  // Paint once with Canvas2D at `scale`, return {tex, canvas, w, h} (w/h = logical size).
  function paint(w, h, scale, fn) {
    var c = global.GOGEngine.bake(w, h, fn, scale || 1);
    return { tex: tex(c), canvas: c, w: w, h: h };
  }

  function sprite(t, o) {
    var s = new P.Sprite(t && t.source && t.frame ? t : tex(t));
    o = o || {};
    if (o.anchor != null) s.anchor.set(o.anchor);
    if (o.ax != null) s.anchor.set(o.ax, o.ay);
    if (o.x != null) s.x = o.x;
    if (o.y != null) s.y = o.y;
    if (o.w != null) s.width = o.w;
    if (o.h != null) s.height = o.h;
    return s;
  }

  // Emoji glyph as a centred sprite (reuses EmojiSprite's cached hi-dpi raster).
  function emoji(glyph, size) {
    var c = global.EmojiSprite.getHi(glyph, size);
    var s = new P.Sprite(tex(c));
    s.anchor.set(0.5);
    s.width = c.gw;
    s.height = c.gh;
    return s;
  }
  function emojiTex(glyph, size) {
    var c = global.EmojiSprite.getHi(glyph, size);
    return { tex: tex(c), w: c.gw, h: c.gh };
  }

  function text(str, style, o) {
    var st = {
      fontFamily: "Baloo 2, Quicksand, sans-serif",
      fontSize: 16,
      fontWeight: "800",
      fill: "#111111",
      align: "center",
    };
    for (var k in style) st[k] = style[k];
    var t = new P.Text({ text: str, style: st });
    o = o || {};
    if (o.anchor != null) t.anchor.set(o.anchor);
    if (o.x != null) t.x = o.x;
    if (o.y != null) t.y = o.y;
    return t;
  }

  /* ---------------- pooling (per-frame dynamic things) ---------------- */
  // pool.begin(); for (...) { var s = pool.next(); s.texture = ...; s.position.set(...) } pool.end();
  function Pool(parent, make) {
    this.parent = parent;
    this.make = make;
    this.items = [];
    this.used = 0;
  }
  Pool.prototype.begin = function () { this.used = 0; };
  Pool.prototype.next = function () {
    var o = this.items[this.used];
    if (!o) {
      o = this.make();
      this.items.push(o);
      this.parent.addChild(o);
    }
    o.visible = true;
    this.used++;
    return o;
  };
  Pool.prototype.end = function () {
    for (var i = this.used; i < this.items.length; i++) this.items[i].visible = false;
  };

  /* ---------------- app ---------------- */
  // Resolves to R = { app, stage, world, fx, W, H, scale, render(), onResize(fn), ... }.
  //   stage
  //    └ world  (game content; shaken as a unit)
  //    └ fx     (full-screen flashes / wipes, never shaken)
  function create(canvas, W, H, o) {
    o = o || {};
    var frameEl = canvas.parentNode;
    if (!P || !webglOk()) {
      showUnsupported(frameEl);
      return Promise.reject(new Error("webgl-unavailable"));
    }
    canvas._gogW = W; // GOGEngine.Input maps pointers to logical coordinates with these
    canvas._gogH = H;

    var app = new P.Application();
    var rect0 = canvas.getBoundingClientRect();
    var scale = pickScale(rect0.width || W, W, H, o);
    var listeners = [];

    return app
      .init({
        canvas: canvas,
        width: W,
        height: H,
        resolution: scale,
        autoDensity: false, // CSS owns the on-screen size (.canvas-frame)
        antialias: o.antialias !== false,
        backgroundAlpha: o.background == null ? 0 : 1,
        background: o.background == null ? 0x000000 : o.background,
        preference: "webgl",
        autoStart: false,
        sharedTicker: false,
        powerPreference: "default",
      })
      .then(function () {
        app.ticker.stop(); // GOGEngine.GameLoop drives frames
        var world = new P.Container();
        var fx = new P.Container();
        app.stage.addChild(world, fx);

        var R = {
          app: app,
          renderer: app.renderer,
          stage: app.stage,
          world: world,
          fx: fx,
          canvas: canvas,
          W: W,
          H: H,
          scale: scale,
          flashG: null,
          ready: true,
        };

        R.render = function () { app.render(); };
        R.onResize = function (fn) { listeners.push(fn); };

        function apply() {
          var r = canvas.getBoundingClientRect();
          if (!r.width) return;
          var s = pickScale(r.width, W, H, o);
          if (Math.abs(s - R.scale) < 0.001) return;
          R.scale = s;
          app.renderer.resize(W, H, s);
          for (var i = 0; i < listeners.length; i++) listeners[i](s);
          app.render(); // resizing clears the canvas: repaint now so there is no blank frame
          requestDraw();
        }
        R.refit = apply;
        if (typeof ResizeObserver === "function") new ResizeObserver(apply).observe(canvas);
        else global.addEventListener("resize", apply);

        // WebGL context loss (Android background/foreground): Pixi re-uploads textures; we just repaint.
        canvas.addEventListener("webglcontextlost", function (e) { e.preventDefault(); });
        canvas.addEventListener("webglcontextrestored", function () { requestDraw(); });

        /* ---- screen shake: offsets the whole world, never the fx layer ---- */
        R.shake = function (x, y) { world.position.set(x || 0, y || 0); };

        /* ---- full-screen colour flash (hit / heal vignettes, win wipes) ---- */
        // `key` names an independent channel (hit + heal flashes can overlap); default "main".
        var flashes = {};
        R.flash = function (color, alpha, key) {
          key = key || "main";
          var g = flashes[key];
          if (!g) {
            g = flashes[key] = new P.Graphics().rect(0, 0, W, H).fill(0xffffff);
            g.visible = false;
            fx.addChild(g);
          }
          g.tint = color;
          g.alpha = alpha;
          g.visible = alpha > 0.003;
        };

        /* ---- emoji particles from GOGEngine.ParticleSystem (call view.sync() from draw) ---- */
        R.particleView = function (ps, parent) {
          var pool = new Pool(parent || world, function () {
            var s = new P.Sprite();
            s.anchor.set(0.5);
            return s;
          });
          return {
            sync: function () {
              pool.begin();
              for (var i = 0; i < ps.pool.length; i++) {
                var p = ps.pool[i];
                if (!p.active) continue;
                var c = global.EmojiSprite.getHi(p.text, p.size);
                var s = pool.next();
                s.texture = tex(c);
                s.width = c.gw;
                s.height = c.gh;
                s.position.set(p.x, p.y);
                s.rotation = p.rotation;
                s.alpha = Math.max(0, 1 - p.life / p.maxLife);
              }
              pool.end();
            },
          };
        };

        /* ---- flat colour grade (pastel haze -> candy bright). 0 = untouched. ---- */
        R.grade = function (container, o2) {
          var f = container.__grade;
          if (!f) {
            f = container.__grade = new P.ColorMatrixFilter();
            container.filters = [f];
          }
          f.reset();
          if (o2 && o2.saturation != null) f.saturate(o2.saturation, true);
          if (o2 && o2.brightness != null) f.brightness(o2.brightness, true);
          if (o2 && o2.off) container.filters = null, container.__grade = null;
          return f;
        };

        /* ---- 2D overlay canvas for coach hints etc. (same logical coords, transparent) ---- */
        R.overlay2d = function () {
          var c = document.createElement("canvas");
          c.className = "gog-overlay2d";
          c.setAttribute("aria-hidden", "true");
          c.style.cssText = "position:absolute;left:0;top:0;width:100%;height:100%;pointer-events:none;z-index:5;display:none";
          canvas.parentNode.insertBefore(c, canvas.nextSibling);
          var g = c.getContext("2d");
          var api = { canvas: c, ctx: g, visible: false };
          function size() {
            c.width = Math.round(W * R.scale);
            c.height = Math.round(H * R.scale);
            g.setTransform(R.scale, 0, 0, R.scale, 0, 0);
          }
          size();
          R.onResize(size);
          api.begin = function () {
            if (!api.visible) { c.style.display = "block"; api.visible = true; }
            g.clearRect(0, 0, W, H);
            return g;
          };
          api.hide = function () {
            if (api.visible) { g.clearRect(0, 0, W, H); c.style.display = "none"; api.visible = false; }
          };
          return api;
        };

        R.pool = function (parent, make) { return new Pool(parent || world, make); };
        return R;
      });
  }

  global.GOGRender = {
    INK: INK,
    available: webglOk,
    create: create,
    tex: tex,
    frame: frame,
    sheet: sheet,
    paint: paint,
    sprite: sprite,
    emoji: emoji,
    emojiTex: emojiTex,
    text: text,
    Pool: Pool,
    showUnsupported: showUnsupported,
  };
})(typeof window !== "undefined" ? window : this);
