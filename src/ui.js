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

  var lastFloatLabelAt = 0;
  // A small floating "+1" / "+seed" style label that drifts up and fades.
  function floatLabel(parentEl, x, y, text, color) {
    if (!parentEl) return;
    var now = performance.now();
    if (now - lastFloatLabelAt < 80) {
      return;
    }
    var activeLabels = parentEl.querySelectorAll(".gog-float-label");
    if (activeLabels.length >= 10) {
      activeLabels[0].remove();
    }
    lastFloatLabelAt = now;

    var el = document.createElement("div");
    el.className = "gog-float-label";
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
    bubble.textContent = text;
    restartAnimation(bubble, 'pop');
  }

  function restartAnimation(el, className) {
    if (!el) return;
    if (className) {
      el.classList.remove(className);
    }
    if (typeof el.getAnimations === 'function') {
      var animations = el.getAnimations();
      if (animations && animations.length > 0) {
        animations.forEach(function (anim) {
          anim.cancel();
        });
      }
    } else {
      void el.offsetWidth;
    }
    if (className) {
      el.classList.add(className);
    }
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

    var GUARDIAN_DATA = {
      "stage01": {
        name: "Splash",
        emoji: "🐬",
        role: "Guardian of the Ocean",
        fact: "Dolphins use echolocation to navigate and hunt! They play a key role in keeping marine ecosystems balanced and healthy.",
        quote: "When we clear the plastic from our waters, we help the ocean breathe and thrive!",
        play: {
          emoji: "🎮",
          goal: "Collect plastic trash from the reef before the timer runs out or health drops!",
          controls: "<strong>Move:</strong> Move your mouse or drag your finger to swim.<br><strong>Collect:</strong> Pick up plastic to clean the reef.<br><strong>Help:</strong> Save 🐢 turtles for bonus points.<br><strong>Avoid:</strong> Stay away from 🐡 pufferfish—they hurt!<br><strong>Boost:</strong> Click 💨 or press <strong>Spacebar</strong> to dash through trash"
        }
      },
      "stage02": {
        name: "Ravi",
        emoji: "🐯",
        role: "Guardian of the Rainforest",
        fact: "Rainforests are home to more than half of the world's plant and animal species! Trees act as Earth's lungs, absorbing carbon dioxide.",
        quote: "Every tree we grow makes our canopy stronger and shelters my forest friends!",
        play: {
          emoji: "🌱",
          goal: "Plant trees to grow a protective canopy and stop the logging machines!",
          controls: "<strong>Plant:</strong> Tap an empty spot to plant a tree.<br><strong>Grow:</strong> Connect grown trees to build a canopy.<br><strong>Collect:</strong> Tap ☁️ clouds to get more 🌱 saplings.<br><strong>Block:</strong> Build a strong canopy to stop the 🌫️ Smog.<br><strong>Win:</strong> Reach the canopy goal before time runs out!"
        }
      },
      "stage03": {
        name: "Buzz",
        emoji: "🐝",
        role: "Guardian of the Meadow",
        fact: "Bees pollinate a third of the crops we eat! Without them, many of our favorite fruits and vegetables wouldn't grow.",
        quote: "By planting wildflowers, we keep our meadows buzzing and food chains healthy!",
        play: {
          emoji: "🐝",
          goal: "Fly Buzz along paths to pollinate flowers and make them bloom!",
          controls: "<strong>Fly:</strong> Use Arrow keys / WASD (or tap screen sectors).<br><strong>Beat:</strong> Follow rhythm lines and fly over glowing flowers!"
        }
      },
      "stage04": {
        name: "Penny",
        emoji: "🐧",
        role: "Guardian of the Ice",
        fact: "Penguins help keep the ocean healthy! They are like little gardeners of the sea. 🌊",
        quote: "When we protect the ice, we help the penguins stay happy and strong!",
        play: {
          emoji: "❄️",
          goal: "Rescue lost penguin chicks and bring them safely back to the safe iceberg!",
          controls: "<strong>Walk:</strong> Use Left/Right Arrow / A/D keys (or ◀ ▶ buttons).<br><strong>Jump:</strong> Press Up Arrow / W / Space (or ▲ button).<br><strong>Cool Valve:</strong> Stand near valve and press E (or tap ☸️)."
        }
      },
      "stage05": {
        name: "Breezy",
        emoji: "🌬️",
        role: "Guardian of the Sky",
        fact: "Wind energy is clean, infinite, and doesn't pollute the air! A single wind turbine can power hundreds of homes.",
        quote: "Harnessing the clean wind keeps our skies clear, fresh, and beautiful for everyone!",
        play: {
          emoji: "⚡",
          goal: "Gather glowing energy orbs in the sky to power the city cleanly!",
          controls: "<strong>Fly Up:</strong> Press and hold Spacebar / Up Arrow / W (or hold tap).<br><strong>Glide:</strong> Release key or touch to glide down.<br><strong>Boost/Avoid:</strong> Ride updrafts, avoid factory smoke."
        }
      }
    };

    function initGuardianCard() {
      var canvasFrame = document.getElementById("canvasFrame");
      if (!canvasFrame) return;

      // Detect stage ID from URL path
      var filename = window.location.pathname.split("/").pop();
      var stageId = "";
      if (filename.indexOf("stage01") !== -1) stageId = "stage01";
      else if (filename.indexOf("stage02") !== -1) stageId = "stage02";
      else if (filename.indexOf("stage03") !== -1) stageId = "stage03";
      else if (filename.indexOf("stage04") !== -1) stageId = "stage04";
      else if (filename.indexOf("stage05") !== -1) stageId = "stage05";

      if (!stageId || !GUARDIAN_DATA[stageId]) return;

      var data = GUARDIAN_DATA[stageId];

      // Create flex wrapper gog-stage-layout
      var wrapper = document.createElement("div");
      wrapper.className = "gog-stage-layout";

      // Insert wrapper before canvasFrame, then move canvasFrame inside it
      canvasFrame.parentNode.insertBefore(wrapper, canvasFrame);
      wrapper.appendChild(canvasFrame);

      // Create the Guardian Card element
      var card = document.createElement("section");
      card.className = "gog-guardian-card theme-" + stageId;

      var html = "";
      html += '<div class="card-inner">';
      html += '  <div class="mascot-box">';
      html += '    <div class="mascot-circle">' + data.emoji + '</div>';
      html += '    <h3>' + data.name + '</h3>';
      html += '    <p class="role-text">' + data.role + '</p>';
      html += '  </div>';
      html += '  <div style="width:100%;">';
      html += '    <h2>Did you know?</h2>';
      html += '    <div class="fact-box">';
      html += '      <p style="margin:0;">' + data.fact + '</p>';
      html += '    </div>';
      html += '    <div class="quote-box">';
      html += '      <p style="margin:0;"><strong>' + data.name + ' says:</strong> "' + data.quote + '"</p>';
      html += '    </div>';
      html += '  </div>';
      html += '</div>';

      card.innerHTML = html;

      // Create the How to Play Card element
      var playCard = document.createElement("section");
      playCard.className = "gog-play-card theme-" + stageId;

      var playHtml = "";
      playHtml += '<div class="card-inner">';
      playHtml += '  <div class="mascot-box">';
      playHtml += '    <div class="mascot-circle">' + data.play.emoji + '</div>';
      playHtml += '    <h3>How to Play</h3>';
      playHtml += '    <p class="role-text">Game Guide</p>';
      playHtml += '  </div>';
      playHtml += '  <div style="width:100%;">';
      playHtml += '    <h2>Your Goal</h2>';
      playHtml += '    <div class="fact-box">';
      playHtml += '      <p style="margin:0;">' + data.play.goal + '</p>';
      playHtml += '    </div>';
      playHtml += '    <div class="quote-box">';
      playHtml += '      <p style="margin:0;">' + data.play.controls + '</p>';
      playHtml += '    </div>';
      playHtml += '  </div>';
      playHtml += '</div>';

      playCard.innerHTML = playHtml;

      // Add cards to the wrapper
      wrapper.insertBefore(card, canvasFrame);
      wrapper.appendChild(playCard);
    }

    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", initGuardianCard);
    } else {
      initGuardianCard();
    }
  }

  global.GOGUi = {
    starsMarkup: starsMarkup,
    showToast: showToast,
    showOverlay: showOverlay,
    closeOverlay: closeOverlay,
    floatLabel: floatLabel,
    say: say,
    confettiAt: confettiAt,
    restartAnimation: restartAnimation
  };
})(window);
