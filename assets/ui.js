/* ============================================================
   GUARDIANS OF GAIA — SHARED UI
   HUD bits, overlays, fact-cards and toasts that every stage and
   the world map reuse, so the "feel" is consistent everywhere.
   ============================================================ */

(function (global) {
  "use strict";

  function starsMarkup(count, max) {
    max = max || 3;
    var out = "";
    for (var i = 0; i < max; i++) {
      out += i < count ? "\u2b50" : "\u2606";
    }
    return out;
  }

  function showToast(message, durationMs) {
    var existing = document.querySelector(".gog-toast");
    if (existing) existing.remove();
    var el = document.createElement("div");
    el.className = "gog-toast";
    el.textContent = message;
    document.body.appendChild(el);
    setTimeout(function () {
      el.style.transition = "opacity 0.25s ease";
      el.style.opacity = "0";
      setTimeout(function () { el.remove(); }, 260);
    }, durationMs || 2200);
  }


  function showOverlay(opts) {
    opts = opts || {};
    var wrap = document.createElement("div");
    wrap.className = "gog-overlay";

    var card = document.createElement("div");
    card.className = "brutal-box gog-overlay-card";
    if (opts.accent) card.style.background = opts.accent;

    var html = "";
    html += '<h2 style="font-size:1.6rem;margin-bottom:10px;">' + (opts.title || "") + "</h2>";
    if (opts.body) {
      html += '<p style="font-size:1.05rem;line-height:1.4;margin:0 0 14px;">' + opts.body + "</p>";
    }
    if (opts.stars != null) {
      html += '<div style="font-size:2rem;letter-spacing:6px;margin-bottom:14px;">' + starsMarkup(opts.stars) + "</div>";
    }
    if (opts.factText) {
      html += '<div class="brutal-box" style="background:var(--gog-cream);padding:14px 16px;margin-bottom:18px;border-radius:14px;">' +
        '<div style="font-family:var(--gog-font-hand);font-size:1.3rem;line-height:1.3;">\ud83e\udd16 ' + opts.factText + "</div></div>";
    }
    html += '<div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap;">';
    if (opts.secondaryLabel) {
      html += '<button class="brutal-btn ghost" data-role="secondary">' + opts.secondaryLabel + "</button>";
    }
    if (opts.primaryLabel) {
      html += '<button class="brutal-btn" data-role="primary">' + opts.primaryLabel + "</button>";
    }
    html += "</div>";

    card.innerHTML = html;
    wrap.appendChild(card);
    document.body.appendChild(wrap);

    var primaryBtn = card.querySelector('[data-role="primary"]');
    var secondaryBtn = card.querySelector('[data-role="secondary"]');
    if (primaryBtn && opts.onPrimary) primaryBtn.addEventListener("click", opts.onPrimary);
    if (secondaryBtn && opts.onSecondary) secondaryBtn.addEventListener("click", opts.onSecondary);

    return wrap;
  }

  function closeOverlay(el) {
    if (!el) return;
    el.style.transition = "opacity 0.18s ease";
    el.style.opacity = "0";
    setTimeout(function () { el.remove(); }, 180);
  }

  // A small floating "+1" / "+seed" style label that drifts up and fades.
  function floatLabel(parentEl, x, y, text, color) {
    var el = document.createElement("div");
    el.textContent = text;
    el.style.position = "absolute";
    el.style.left = x + "px";
    el.style.top = y + "px";
    el.style.fontFamily = "var(--gog-font-head)";
    el.style.fontWeight = "700";
    el.style.color = color || "var(--gog-ink)";
    el.style.pointerEvents = "none";
    el.style.transition = "transform 0.7s ease, opacity 0.7s ease";
    el.style.transform = "translate(-50%, 0)";
    el.style.opacity = "1";
    el.style.zIndex = "50";
    parentEl.appendChild(el);
    requestAnimationFrame(function () {
      el.style.transform = "translate(-50%, -38px)";
      el.style.opacity = "0";
    });
    setTimeout(function () { el.remove(); }, 720);
  }

  function say(text) {
    var bubble = document.getElementById('guideText');
    if (!bubble) return;
    bubble.classList.remove('pop');
    void bubble.offsetWidth;
    bubble.textContent = text;
    bubble.classList.add('pop');
  }

  function confettiAt(x, y, n) {
    var colors = ['#C6FF3D', '#FF3DA6', '#FF9142', '#2D4DE0', '#B79CFF'];
    for (var i = 0; i < (n || 10); i++) {
      var d = document.createElement('div');
      d.className = 'confetti-bit';
      d.style.left = x + 'px';
      d.style.top = y + 'px';
      d.style.background = colors[i % colors.length];
      var ang = Math.random() * Math.PI * 2;
      var dist = 26 + Math.random() * 44;
      d.style.setProperty('--dx', (Math.cos(ang) * dist) + 'px');
      d.style.setProperty('--dy', (Math.sin(ang) * dist) + 'px');
      d.style.setProperty('--rot', (Math.random() * 360) + 'deg');
      document.body.appendChild(d);
      (function (el) {
        setTimeout(function () { el.remove(); }, 650);
      })(d);
    }
  }

  if (typeof document !== 'undefined') {
    document.addEventListener('click', function (e) {
      var btn = e.target.closest('.btn, .brutal-btn, .marker, .iconBtn, .icon-btn');
      if (!btn) return;
      var r = btn.getBoundingClientRect();
      confettiAt(r.left + r.width / 2, r.top + r.height / 2, 8);
    }, true);
  }

  global.GOGUi = {
    starsMarkup: starsMarkup,
    showToast: showToast,
    showOverlay: showOverlay,
    closeOverlay: closeOverlay,
    floatLabel: floatLabel,
    say: say,
    confettiAt: confettiAt
  };
})(window);
