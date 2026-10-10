/* ============================================================
   GUARDIANS OF GAIA — GUIDED COACH
   A shared "show me how to play" helper. Two halves:

   1. A small step banner (DOM) pinned to the top of the canvas frame:
      big icon + short title + one plain sentence + step dots + Skip.
   2. Canvas drawing helpers (pulsing ring, bobbing pointing hand,
      looping "press here, drag there" demo, bouncing arrow, tag) that a
      stage calls from its own draw() while a step is active, so kids who
      can't read yet can still *see* what to do.

   The stage owns the step logic: it decides when a step is done and calls
   coach.advance(). Nothing here touches game state, so the coach can never
   soft-lock a stage — every step can be skipped.
   ============================================================ */

(function (global) {
  "use strict";

  var DONE_PREFIX = "gog_coach_done_";
  var EMOJI_FONT = "'Segoe UI Emoji','Apple Color Emoji','Noto Color Emoji',sans-serif";

  function doneThisSession(stageId) {
    try {
      return global.sessionStorage.getItem(DONE_PREFIX + stageId) === "1";
    } catch (e) {
      return false;
    }
  }

  function markDone(stageId) {
    try {
      global.sessionStorage.setItem(DONE_PREFIX + stageId, "1");
    } catch (e) {}
  }

  // The guided intro plays the first time a stage is opened in a browser
  // session (so "Try Again" reloads don't repeat it); the ❓ button in each
  // stage's HUD replays it on demand.
  function shouldAutoStart(stageId) {
    return !doneThisSession(stageId);
  }

  /* ---------------- step banner ---------------- */
  function create(opts) {
    opts = opts || {};
    var steps = opts.steps || [];
    var frame = opts.frame;
    var stageId = opts.stageId || "";
    var el = null;
    var running = false;
    var index = -1;
    var stepStartedAt = 0;

    function build() {
      if (el || !frame) return;
      el = document.createElement("div");
      el.className = "gog-coach";
      el.setAttribute("role", "status");
      el.setAttribute("aria-live", "polite");
      el.innerHTML =
        '<div class="gog-coach-icon" aria-hidden="true"></div>' +
        '<div class="gog-coach-body">' +
        '<div class="gog-coach-title"></div>' +
        '<div class="gog-coach-text"></div>' +
        '<div class="gog-coach-keys"></div>' +
        '<div class="gog-coach-dots" aria-hidden="true"></div>' +
        "</div>" +
        '<button type="button" class="gog-coach-skip">Skip ⏭</button>';
      frame.appendChild(el);
      el.querySelector(".gog-coach-skip").addEventListener("click", function () {
        finish("skipped");
      });
    }

    function render() {
      var s = steps[index];
      if (!el || !s) return;
      el.querySelector(".gog-coach-icon").textContent = s.icon || "👉";
      el.querySelector(".gog-coach-title").textContent = s.title || "";
      el.querySelector(".gog-coach-text").innerHTML = s.text || "";
      // keyboard hint on its own line so touch screens can drop it
      el.querySelector(".gog-coach-keys").innerHTML = s.keys || "";
      var dots = "";
      for (var i = 0; i < steps.length; i++) {
        dots += '<i class="' + (i < index ? "done" : i === index ? "on" : "") + '"></i>';
      }
      el.querySelector(".gog-coach-dots").innerHTML = dots;
      if (global.GOGUi && typeof global.GOGUi.restartAnimation === "function") {
        global.GOGUi.restartAnimation(el, "gog-coach-pop");
      } else {
        el.classList.add("gog-coach-pop");
      }
      stepStartedAt = performance.now();
      if (opts.onStep) opts.onStep(index, s);
    }

    function start() {
      if (!steps.length) return;
      build();
      running = true;
      index = 0;
      if (el) el.style.display = "";
      render();
    }

    function goTo(i) {
      if (!running) return;
      if (i >= steps.length) {
        finish("done");
        return;
      }
      if (i === index) return;
      index = i;
      render();
    }

    function advance() {
      goTo(index + 1);
    }

    function finish(reason) {
      if (!running) return;
      running = false;
      index = -1;
      if (el) el.style.display = "none";
      if (stageId) markDone(stageId);
      if (opts.onFinish) opts.onFinish(reason || "done");
    }

    return {
      start: start,
      advance: advance,
      goTo: goTo,
      finish: finish,
      get active() { return running; },
      get index() { return index; },
      get step() { return running ? steps[index] : null; },
      // seconds the current step has been showing — drives looping demos
      get t() { return (performance.now() - stepStartedAt) / 1000; }
    };
  }

  /* ---------------- canvas drawing helpers ----------------
     All take logical canvas coordinates and draw with flat fills + thick ink
     outlines to match the game's neo-brutalist look. */

  function smooth(u) {
    u = Math.max(0, Math.min(1, u));
    return u * u * (3 - 2 * u);
  }

  // Pulsing dashed ring that says "look here".
  function ring(ctx, x, y, r, t, color) {
    var p = (t % 1.2) / 1.2;
    ctx.save();
    ctx.lineWidth = 4;
    ctx.strokeStyle = "#111";
    ctx.setLineDash([9, 7]);
    ctx.lineDashOffset = -t * 28;
    ctx.beginPath();
    ctx.arc(x, y, r + Math.sin(t * 5) * 3, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = (1 - p) * 0.85;
    ctx.lineWidth = 6;
    ctx.strokeStyle = color || "#C6FF3D";
    ctx.beginPath();
    ctx.arc(x, y, r * 0.55 + p * r * 0.9, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  // A bobbing pointing hand; (x, y) is where the fingertip lands.
  function hand(ctx, x, y, t, pressed) {
    var bob = pressed ? 0 : Math.sin(t * 6) * 4;
    ctx.save();
    ctx.translate(x, y + 24 + bob);
    var s = pressed ? 0.88 : 1;
    ctx.scale(s, s);
    ctx.font = "36px " + EMOJI_FONT;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineJoin = "round";
    ctx.lineWidth = 7;
    ctx.strokeStyle = "rgba(255,255,255,0.95)";
    ctx.strokeText("👆", 0, 0);
    ctx.fillText("👆", 0, 0);
    ctx.restore();
  }

  // Looping "press here, slide over there, let go" demo. a and b are {x, y}.
  function dragDemo(ctx, a, b, t, opts) {
    opts = opts || {};
    var period = opts.period || 2.8;
    var p = (t % period) / period;
    var arc = opts.arc == null ? 46 : opts.arc;
    var cx = (a.x + b.x) / 2;
    var cy = (a.y + b.y) / 2 - arc;
    function bez(u) {
      var iu = 1 - u;
      return {
        x: iu * iu * a.x + 2 * iu * u * cx + u * u * b.x,
        y: iu * iu * a.y + 2 * iu * u * cy + u * u * b.y
      };
    }
    var u = p < 0.15 ? 0 : p < 0.7 ? smooth((p - 0.15) / 0.55) : 1;
    var alpha = (opts.alpha == null ? 1 : opts.alpha) * (p > 0.88 ? 1 - (p - 0.88) / 0.12 : 1);
    var pos = bez(u);
    var r = opts.radius || 38;

    ctx.save();
    ctx.globalAlpha = alpha;
    ring(ctx, a.x, a.y, r, t, opts.color);
    ring(ctx, b.x, b.y, r, t + 0.4, opts.color);

    // dotted flight path, white under ink so it reads on any background
    ctx.lineCap = "round";
    ctx.setLineDash([2, 12]);
    ctx.lineDashOffset = -t * 40;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.quadraticCurveTo(cx, cy, b.x, b.y);
    ctx.lineWidth = 9;
    ctx.strokeStyle = "#111";
    ctx.stroke();
    ctx.lineWidth = 5;
    ctx.strokeStyle = "#fff";
    ctx.stroke();
    ctx.setLineDash([]);

    hand(ctx, pos.x, pos.y, t, p < 0.15 || p > 0.7);
    ctx.restore();
  }

  // Chunky bouncing arrow whose tip points at (x, y) from the given side.
  // dir: "down" (arrow sits above the target), "up", "left", "right".
  function arrow(ctx, x, y, t, dir) {
    var bounce = Math.sin(t * 7) * 6;
    var rot = { down: 0, left: Math.PI / 2, up: Math.PI, right: -Math.PI / 2 }[dir || "down"] || 0;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rot);
    ctx.translate(0, -12 - Math.abs(bounce));
    ctx.lineJoin = "round";
    ctx.lineWidth = 5;
    ctx.strokeStyle = "#111";
    ctx.fillStyle = "#C6FF3D";
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(-17, -20);
    ctx.lineTo(-7, -20);
    ctx.lineTo(-7, -42);
    ctx.lineTo(7, -42);
    ctx.lineTo(7, -20);
    ctx.lineTo(17, -20);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  // Rounded speech-tag with a short label, centered on (x, y).
  function tag(ctx, x, y, text, color) {
    ctx.save();
    ctx.font = "800 15px 'Baloo 2', 'Quicksand', Arial, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    var w = ctx.measureText(text).width + 22;
    var h = 28;
    var left = x - w / 2;
    var top = y - h / 2;
    var r = 10;
    ctx.fillStyle = "#111";
    roundRect(ctx, left + 3, top + 3, w, h, r);
    ctx.fill();
    ctx.fillStyle = color || "#fff";
    roundRect(ctx, left, top, w, h, r);
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = "#111";
    ctx.stroke();
    ctx.fillStyle = "#111";
    ctx.fillText(text, x, y + 1);
    ctx.restore();
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  global.GOGCoach = {
    create: create,
    shouldAutoStart: shouldAutoStart,
    ring: ring,
    hand: hand,
    dragDemo: dragDemo,
    arrow: arrow,
    tag: tag
  };
})(window);
