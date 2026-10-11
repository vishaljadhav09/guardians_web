/* ============================================================
   GUARDIANS OF GAIA — TAP-TO-HEAR VOICE
   A 🔊 button that reads a piece of text aloud, so kids who can't
   read yet can still hear what to do. It only ever speaks when the
   child taps it (which also satisfies mobile autoplay rules), never
   on its own — research on young children's apps suggests forced
   narration makes kids passive, so voice is on demand.

   Uses the browser's speechSynthesis (no files, no network, no PII).
   The button hides itself when the browser has no speech support.
   ============================================================ */

(function (global) {
  "use strict";

  var synth = global.speechSynthesis || null;
  var supported = !!(synth && global.SpeechSynthesisUtterance);
  var voice = null;
  var activeBtn = null;

  var PREFERRED = ["Samantha", "Google US English", "Aria", "Jenny", "Zira", "Karen", "Moira", "Natural"];

  function pickVoice() {
    if (!supported) return;
    var list = synth.getVoices() || [];
    if (!list.length) return;
    var en = list.filter(function (v) { return /^en[-_]/i.test(v.lang); });
    var pool = en.length ? en : list;
    for (var i = 0; i < PREFERRED.length; i++) {
      for (var j = 0; j < pool.length; j++) {
        if (pool[j].name.indexOf(PREFERRED[i]) !== -1) {
          voice = pool[j];
          return;
        }
      }
    }
    voice = pool[0] || null;
  }

  if (supported) {
    pickVoice();
    if (typeof synth.addEventListener === "function") {
      synth.addEventListener("voiceschanged", pickVoice);
    }
  }

  // Plain, speakable text: no tags, no emoji, no keyboard hints.
  function clean(text) {
    return String(text == null ? "" : text)
      .replace(/<kbd[\s\S]*?<\/kbd>/gi, " ")
      .replace(/<br\s*\/?>/gi, ". ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/[\u{1F000}-\u{1FAFF}\u{2190}-\u{21FF}\u{2300}-\u{23FF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}️‍]/gu, "")
      .replace(/\s+/g, " ")
      .replace(/\.\s*\./g, ".")
      .trim();
  }

  function setSpeaking(btn, on) {
    if (!btn) return;
    btn.classList.toggle("speaking", !!on);
    btn.setAttribute("aria-pressed", on ? "true" : "false");
  }

  function stop() {
    if (supported) synth.cancel();
    if (activeBtn) setSpeaking(activeBtn, false);
    activeBtn = null;
  }

  function speak(text, btn) {
    if (!supported) return false;
    var line = clean(text);
    if (!line) return false;
    stop();
    var u = new global.SpeechSynthesisUtterance(line);
    if (voice) u.voice = voice;
    u.lang = (voice && voice.lang) || "en-US";
    u.rate = 0.88; // a touch slower for young listeners
    u.pitch = 1.12;
    u.volume = 1;
    activeBtn = btn || null;
    setSpeaking(btn, true);
    var done = function () {
      if (activeBtn === btn) activeBtn = null;
      setSpeaking(btn, false);
    };
    u.onend = done;
    u.onerror = done;
    synth.speak(u);
    return true;
  }

  // Wire an existing element as a tap-to-hear button. getText is called on each
  // tap so the button always reads whatever is on screen right now.
  function attach(btn, getText) {
    if (!btn) return btn;
    if (!supported) {
      btn.style.display = "none";
      return btn;
    }
    btn.setAttribute("type", "button");
    btn.setAttribute("aria-label", "Read aloud");
    btn.setAttribute("title", "Tap to hear");
    btn.addEventListener("click", function (e) {
      e.stopPropagation();
      if (btn.classList.contains("speaking")) {
        stop();
        return;
      }
      speak(typeof getText === "function" ? getText() : getText, btn);
    });
    return btn;
  }

  function createButton(getText, className) {
    var btn = document.createElement("button");
    btn.className = "gog-voice-btn" + (className ? " " + className : "");
    btn.textContent = "🔊";
    return attach(btn, getText);
  }

  // Any text carrying data-voice becomes tap-to-hear on its own container:
  // <button data-voice-for="#someId"> reads that element's text.
  function init() {
    var btns = document.querySelectorAll("[data-voice-for]");
    for (var i = 0; i < btns.length; i++) {
      (function (b) {
        if (b.__gogVoice) return;
        b.__gogVoice = true;
        attach(b, function () {
          var el = document.querySelector(b.getAttribute("data-voice-for"));
          return el ? el.textContent : "";
        });
      })(btns[i]);
    }
  }

  if (typeof document !== "undefined") {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
    else init();
    // never keep talking once the page is hidden / navigated away
    global.addEventListener("pagehide", stop);
    document.addEventListener("visibilitychange", function () { if (document.hidden) stop(); });
  }

  global.GOGVoice = {
    supported: supported,
    clean: clean,
    speak: speak,
    stop: stop,
    attach: attach,
    createButton: createButton
  };
})(window);
