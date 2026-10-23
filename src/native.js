/* Native (Capacitor/Android) glue: hardware Back button.
 * Loaded by index.html and every stage page. A no-op in a plain browser.
 *   Stage -> back to the world map (a stage is never a dead end; no progress-loss scolding).
 *   Hub   -> "press Back again" toast, second press within 2 s exits (guards against a stray
 *            swipe dropping a young child out of the app).
 * No bundler here, so we use the global Capacitor.Plugins.App injected by the native bridge. */
(function () {
  "use strict";
  var cap = window.Capacitor;
  if (!cap || typeof cap.isNativePlatform !== "function" || !cap.isNativePlatform()) return;

  var App = cap.Plugins && cap.Plugins.App;
  if (!App || typeof App.addListener !== "function") return;

  var EXIT_WINDOW_MS = 2000;
  var lastBackAt = -Infinity; // no prior press; independent of the clock's absolute value
  var inStage = /\/stages\//.test(window.location.pathname);

  App.addListener("backButton", function () {
    if (inStage) {
      window.location.href = "../index.html";
      return;
    }
    var now = Date.now();
    if (now - lastBackAt <= EXIT_WINDOW_MS) {
      App.exitApp();
      return;
    }
    lastBackAt = now;
    if (window.GOGUi && typeof window.GOGUi.showToast === "function") {
      window.GOGUi.showToast("Press back again to exit", EXIT_WINDOW_MS);
    }
  });
})();
