/* ============================================================
   GUARDIANS OF GAIA — SCENERY HELPERS
   The flat, bright "toy diorama" look that Stage 3 (Buzz) set as the
   quality bar, packaged so every stage can build its world the same way:

     - layers are painted ONCE into offscreen canvases at the on-screen
       resolution (see GOGEngine.fitCanvas) and just blitted each frame;
     - a world has two palettes — "sick" (polluted, but still a soft
       lilac-grey, never dark) and "well" (candy bright). The two layers are
       cross-faded by health, so healing is a palette change that works on
       every browser (no ctx.filter, no per-frame gradients);
     - everything is flat fills + ink outlines + hard offset shadows. No blur.

   Stages own their layout and call these to paint. Nothing here touches
   game state.
   ============================================================ */

(function (global) {
  "use strict";

  var INK = "#111111";
  var TAU = Math.PI * 2;

  function seededRng(seed) {
    var s = seed % 2147483647;
    if (s <= 0) s += 2147483646;
    return function () {
      s = (s * 16807) % 2147483647;
      return (s - 1) / 2147483646;
    };
  }

  /* ---------------- colour ---------------- */
  var colorCache = {};
  function parse(hex) {
    var c = colorCache[hex];
    if (c) return c;
    var h = hex.charAt(0) === "#" ? hex.slice(1) : hex;
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    c = [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
    colorCache[hex] = c;
    return c;
  }
  // Blend two #hex colours; t = 0 → a, 1 → b.
  function mix(a, b, t) {
    var A = parse(a), B = parse(b);
    t = Math.max(0, Math.min(1, t));
    return "rgb(" + Math.round(A[0] + (B[0] - A[0]) * t) + "," +
      Math.round(A[1] + (B[1] - A[1]) * t) + "," +
      Math.round(A[2] + (B[2] - A[2]) * t) + ")";
  }

  /* ---------------- offscreen layers ---------------- */
  // Paint a w×h logical layer at `scale`. paint(g, P) is called with a context
  // already scaled to logical coordinates; P(sick, well) returns the colour for
  // this palette, so one paint function builds both worlds.
  function paintLayer(w, h, scale, paint, state) {
    var c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(w * scale));
    c.height = Math.max(1, Math.round(h * scale));
    var g = c.getContext("2d");
    g.setTransform(scale, 0, 0, scale, 0, 0);
    var healed = state === "well";
    paint(g, function (sick, well) { return healed ? well : sick; });
    c.logicalW = w;
    c.logicalH = h;
    return c;
  }

  // Builds {sick, well} for one layer.
  function layerPair(w, h, scale, paint) {
    return {
      sick: paintLayer(w, h, scale, paint, "sick"),
      well: paintLayer(w, h, scale, paint, "well"),
      w: w,
      h: h
    };
  }

  // Draw a layer pair cross-faded by `health` (0 sick … 1 well) at (x, y).
  // `tileX` repeats it horizontally across `viewW` (for parallax strips).
  function drawPair(ctx, pair, x, y, health, tileX, viewW) {
    if (!pair) return;
    var w = pair.w, h = pair.h;
    var positions = [];
    if (tileX) {
      var start = ((x % w) + w) % w;
      for (var px = -start; px < viewW; px += w) positions.push(px);
    } else {
      positions.push(x);
    }
    var hl = Math.max(0, Math.min(1, health));
    for (var i = 0; i < positions.length; i++) {
      ctx.drawImage(pair.sick, positions[i], y, w, h);
      if (hl > 0.01) {
        ctx.globalAlpha = hl;
        ctx.drawImage(pair.well, positions[i], y, w, h);
        ctx.globalAlpha = 1;
      }
    }
  }

  /* ---------------- shapes ---------------- */
  // Rolling hills that tile seamlessly across `w` (frequencies are whole
  // numbers of periods). Returns crestY(x) so trees can sit on the ridge.
  function hills(g, w, floorY, baseY, amp, topCol, botCol, seed, ink) {
    var rng = seededRng(seed);
    var k1 = 1 + Math.floor(rng() * 2), k2 = 3 + Math.floor(rng() * 3);
    var p1 = rng() * TAU, p2 = rng() * TAU;
    function crest(x) {
      return baseY - amp * (0.55 + 0.3 * Math.sin(x * k1 * TAU / w + p1) + 0.15 * Math.sin(x * k2 * TAU / w + p2));
    }
    var grad = g.createLinearGradient(0, baseY - amp, 0, floorY);
    grad.addColorStop(0, topCol);
    grad.addColorStop(1, botCol);
    g.fillStyle = grad;
    g.beginPath();
    g.moveTo(0, floorY + 4);
    for (var x = 0; x <= w; x += 5) g.lineTo(x, crest(x));
    g.lineTo(w, floorY + 4);
    g.closePath();
    g.fill();
    if (ink) {
      g.strokeStyle = ink;
      g.lineWidth = 3;
      g.lineJoin = "round";
      g.beginPath();
      for (var x2 = 0; x2 <= w; x2 += 5) {
        if (x2 === 0) g.moveTo(x2, crest(x2));
        else g.lineTo(x2, crest(x2));
      }
      g.stroke();
    }
    return crest;
  }

  // A cluster of circles drawn as ONE flat shape: ink outline (union), optional
  // hard offset shadow, body fill, underside shade and a highlight. circles are
  // [dx, dy, r] relative to (x, y). Used for clouds, Smog puffs, tree canopies.
  function blob(g, x, y, s, circles, o) {
    o = o || {};
    var lw = o.ink === false ? 0 : (o.lw == null ? 3 : o.lw) * (o.lwScale == null ? 1 : o.lwScale);
    var i, c;
    // part: "shadow" / "outline" / "body" draw one layer of the blob each.
    // Drawing every shadow, then every outline, then every body merges
    // overlapping blobs (a smoke column) into one clean silhouette with no ink
    // lines inside it. Use an opaque shadow colour for that, so overlaps don't
    // stack up darker.
    var part = o.part || "both";
    var doShadow = part === "both" || part === "shadow";
    var doOutline = part === "both" || part === "outline";
    var doBody = part === "both" || part === "body";
    if (doShadow && o.shadow) {
      g.fillStyle = o.shadow;
      var sx = (o.shadowDx == null ? 4 : o.shadowDx), sy = (o.shadowDy == null ? 5 : o.shadowDy);
      for (i = 0; i < circles.length; i++) {
        c = circles[i];
        g.beginPath();
        g.arc(x + c[0] * s + sx, y + c[1] * s + sy, c[2] * s + lw, 0, TAU);
        g.fill();
      }
    }
    if (doOutline && lw > 0) {
      g.fillStyle = INK;
      for (i = 0; i < circles.length; i++) {
        c = circles[i];
        g.beginPath();
        g.arc(x + c[0] * s, y + c[1] * s, c[2] * s + lw, 0, TAU);
        g.fill();
      }
    }
    if (!doBody) return;
    if (o.shade) {
      g.fillStyle = o.shade;
      for (i = 0; i < circles.length; i++) {
        c = circles[i];
        g.beginPath();
        g.arc(x + c[0] * s, y + c[1] * s + (o.shadeDy == null ? 3 : o.shadeDy) * s, c[2] * s, 0, TAU);
        g.fill();
      }
    }
    g.fillStyle = o.fill || "#fff";
    for (i = 0; i < circles.length; i++) {
      c = circles[i];
      g.beginPath();
      g.arc(x + c[0] * s, y + c[1] * s, c[2] * s, 0, TAU);
      g.fill();
    }
    if (o.light) {
      g.fillStyle = o.light;
      g.beginPath();
      g.arc(x + circles[0][0] * s - circles[0][2] * s * 0.25, y + circles[0][1] * s - circles[0][2] * s * 0.3,
        circles[0][2] * s * 0.5, 0, TAU);
      g.fill();
    }
  }

  var CLOUD = [[0, 0, 26], [-30, 8, 19], [30, 8, 20], [-14, -12, 17], [16, -10, 18]];
  function cloud(g, x, y, s, o) {
    o = o || {};
    blob(g, x, y, s, CLOUD, {
      fill: o.fill || "#fff", shade: o.shade || "#DCEBFA", light: o.light, ink: o.ink === true ? true : false,
      lw: o.lw, shadow: o.shadow, shadowDx: o.shadowDx, shadowDy: o.shadowDy
    });
    // flat base so it reads as a cloud, not a bush
    g.fillStyle = o.fill || "#fff";
    g.fillRect(x - 46 * s, y + 8 * s, 92 * s, 18 * s);
  }

  // Faceless Smog puff: soft grey-lilac, ink outline, hard offset shadow.
  // Never a face, never black — this is the project's Smog rule.
  var PUFF = [[0, 0, 20], [-17, 6, 14], [17, 6, 15], [-6, -12, 13], [10, -11, 13]];
  function smogPuff(g, x, y, s, o) {
    o = o || {};
    blob(g, x, y, s, PUFF, {
      fill: o.fill || "#B9B3CF", shade: o.shade || "#9F98BC", light: o.light || "#D6D1E6",
      ink: true, lw: o.lw == null ? 3 : o.lw, shadow: o.shadow === false ? null : (o.shadow || "rgba(17,17,17,0.35)"),
      shadowDx: 4, shadowDy: 5, part: o.part
    });
  }

  // Round-canopy tree (Stage 3's recipe) with optional ink outline.
  function roundTree(g, x, baseY, s, o) {
    o = o || {};
    var lw = o.ink ? (o.lw || 2.5) : 0;
    g.fillStyle = o.trunk || "#8B6B4A";
    if (lw) {
      g.fillStyle = INK;
      g.fillRect(x - 2.5 * s - lw, baseY - 10 * s - lw, 5 * s + lw * 2, 12 * s + lw);
      g.fillStyle = o.trunk || "#8B6B4A";
    }
    g.fillRect(x - 2.5 * s, baseY - 9 * s, 5 * s, 11 * s);
    var puffs = [[0, -24, 14], [-11, -15, 11], [11, -15, 11]];
    blob(g, x, baseY, s, puffs, {
      fill: o.main || "#5FAE4E", shade: o.dark || "#4A9440", light: o.lite || "#80CE69",
      ink: !!o.ink, lw: lw, shadeDy: 3
    });
  }

  // Big-leaf rainforest tree: tall trunk, wide layered canopy, hanging leaves.
  function jungleTree(g, x, baseY, s, o) {
    o = o || {};
    var lw = o.ink ? (o.lw || 3) : 0;
    var trunkH = (o.trunkH || 46) * s;
    var tw = 7 * s;
    if (lw) {
      g.fillStyle = INK;
      g.fillRect(x - tw / 2 - lw, baseY - trunkH - lw, tw + lw * 2, trunkH + lw);
    }
    g.fillStyle = o.trunk || "#9A6B43";
    g.fillRect(x - tw / 2, baseY - trunkH, tw, trunkH);
    g.fillStyle = o.trunkShade || "#7B5233";
    g.fillRect(x + tw * 0.1, baseY - trunkH, tw * 0.4, trunkH);
    var top = baseY - trunkH;
    var circles = [[0, -10, 22], [-24, 2, 17], [24, 2, 17], [-12, -22, 16], [14, -21, 16], [0, 10, 14]];
    blob(g, x, top, s, circles, {
      fill: o.main || "#3FAE57", shade: o.dark || "#2E8C47", light: o.lite || "#6FD279",
      ink: !!o.ink, lw: lw, shadeDy: 4
    });
  }

  function contactShadow(g, x, y, rx, ry, alpha) {
    g.save();
    g.fillStyle = "rgba(17,17,17," + (alpha == null ? 0.28 : alpha) + ")";
    g.beginPath();
    g.ellipse(x, y, rx, ry, 0, 0, TAU);
    g.fill();
    g.restore();
  }

  // Flat sun: ink-outlined disc with chunky triangular rays.
  function sun(g, x, y, r, o) {
    o = o || {};
    var rays = o.rays == null ? 12 : o.rays;
    var spin = o.spin || 0;
    g.save();
    g.translate(x, y);
    g.rotate(spin);
    if (rays) {
      g.fillStyle = o.rayFill || "#FFD23F";
      g.strokeStyle = INK;
      g.lineWidth = 3;
      g.lineJoin = "round";
      for (var i = 0; i < rays; i++) {
        var a = (i / rays) * TAU;
        g.save();
        g.rotate(a);
        g.beginPath();
        g.moveTo(r * 1.1, -r * 0.2);
        g.lineTo(r * 1.55, 0);
        g.lineTo(r * 1.1, r * 0.2);
        g.closePath();
        g.fill();
        g.stroke();
        g.restore();
      }
    }
    g.fillStyle = o.fill || "#FFE066";
    g.strokeStyle = INK;
    g.lineWidth = 4;
    g.beginPath();
    g.arc(0, 0, r, 0, TAU);
    g.fill();
    g.stroke();
    g.fillStyle = o.light || "#FFF3A8";
    g.beginPath();
    g.arc(-r * 0.3, -r * 0.3, r * 0.34, 0, TAU);
    g.fill();
    g.restore();
  }

  function roundRect(g, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    g.beginPath();
    g.moveTo(x + r, y);
    g.lineTo(x + w - r, y);
    g.quadraticCurveTo(x + w, y, x + w, y + r);
    g.lineTo(x + w, y + h - r);
    g.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    g.lineTo(x + r, y + h);
    g.quadraticCurveTo(x, y + h, x, y + h - r);
    g.lineTo(x, y + r);
    g.quadraticCurveTo(x, y, x + r, y);
    g.closePath();
  }

  // Chunky outlined progress pill with a hard offset shadow (kid-readable).
  function bar(g, x, y, w, h, frac, fill, bg) {
    frac = Math.max(0, Math.min(1, frac));
    g.save();
    g.fillStyle = "rgba(17,17,17,0.85)";
    roundRect(g, x + 2, y + 3, w, h, h / 2);
    g.fill();
    g.fillStyle = bg || "#fff";
    roundRect(g, x, y, w, h, h / 2);
    g.fill();
    if (frac > 0) {
      g.save();
      roundRect(g, x, y, w, h, h / 2);
      g.clip();
      g.fillStyle = fill || "#C6FF3D";
      g.fillRect(x, y, Math.max(h * 0.8, w * frac), h);
      g.restore();
    }
    g.lineWidth = 3;
    g.strokeStyle = INK;
    roundRect(g, x, y, w, h, h / 2);
    g.stroke();
    g.restore();
  }

  /* ---------------- sprite outline ---------------- */
  // Existing painted characters get the toy-style ink outline without new art:
  // the frame is stamped around itself as an ink silhouette, then drawn on top.
  // Returns an offscreen canvas (with .pad = extra px on every side), cached.
  var outlineCache = {};
  function outlineSprite(img, sx, sy, sw, sh, px, key) {
    if (!img || !img.complete || !img.naturalWidth) return null;
    var k = key || (img.src + "|" + sx + "," + sy + "," + sw + "," + sh + "|" + px);
    if (outlineCache[k]) return outlineCache[k];
    var pad = Math.ceil(px) + 1;
    var cw = sw + pad * 2, ch = sh + pad * 2;
    var sil = document.createElement("canvas");
    sil.width = cw;
    sil.height = ch;
    var sg = sil.getContext("2d");
    sg.drawImage(img, sx, sy, sw, sh, pad, pad, sw, sh);
    sg.globalCompositeOperation = "source-in";
    sg.fillStyle = INK;
    sg.fillRect(0, 0, cw, ch);
    var out = document.createElement("canvas");
    out.width = cw;
    out.height = ch;
    var og = out.getContext("2d");
    for (var a = 0; a < 16; a++) {
      var ang = (a / 16) * TAU;
      og.drawImage(sil, Math.cos(ang) * px, Math.sin(ang) * px);
    }
    og.drawImage(img, sx, sy, sw, sh, pad, pad, sw, sh);
    out.pad = pad;
    outlineCache[k] = out;
    return out;
  }

  global.GOGScenery = {
    INK: INK,
    seededRng: seededRng,
    mix: mix,
    paintLayer: paintLayer,
    layerPair: layerPair,
    drawPair: drawPair,
    hills: hills,
    blob: blob,
    cloud: cloud,
    smogPuff: smogPuff,
    roundTree: roundTree,
    jungleTree: jungleTree,
    contactShadow: contactShadow,
    sun: sun,
    roundRect: roundRect,
    bar: bar,
    outlineSprite: outlineSprite
  };
})(window);
