/* ============================================================
   GUARDIANS OF GAIA — SAVE MANAGER
   Single localStorage JSON blob. Safe defaults + versioning,
   so future stages/fields can be added without breaking old saves.
   ============================================================ */

(function (global) {
  "use strict";

  var SAVE_KEY = "gog_save_v1";
  var SAVE_VERSION = 1;

  function defaultSave() {
    return {
      version: SAVE_VERSION,
      seeds: 0,
      sprouts: 0,
      starsPerStage: {},   // { stage01: 3, ... }
      stagesCleared: [],   // ["stage01", ...]
      smogLevel: 100,      // 100 -> 0
      settings: {
        sound: false,      // off by default per spec recommendation
        calmMode: false
      }
    };
  }

  /**
   * Deeply sanitizes data to ensure no PII text strings or malformed
   * values are injected into runtime parameters. (COPPA & GDPR-K Compliance Boundary)
   */
  function sanitize(data) {
    if (!data || typeof data !== 'object') return defaultSave();

    var clean = defaultSave();

    // 1. Enforce strict numeric thresholds for core stats
    clean.version = typeof data.version === 'number' ? data.version : SAVE_VERSION;
    clean.seeds = Math.max(0, Math.floor(Number(data.seeds) || 0));
    clean.sprouts = Math.max(0, Math.floor(Number(data.sprouts) || 0));
    clean.smogLevel = Math.max(0, Math.min(100, Number(data.smogLevel) != null ? Number(data.smogLevel) : 100));

    // 2. Settings: Enforce explicit boolean conversions
    if (data.settings && typeof data.settings === 'object') {
      clean.settings.sound = !!data.settings.sound;
      clean.settings.calmMode = !!data.settings.calmMode;
    }

    // 3. Stages Cleared: Strip out anything that isn't a clean stage identifier string
    // (Prevents arbitrary messaging injection via array injection)
    if (Array.isArray(data.stagesCleared)) {
      clean.stagesCleared = data.stagesCleared.filter(function (id) {
        return typeof id === 'string' && id.length < 64 && /^[a-zA-Z0-9_\-]+$/.test(id);
      });
    }

    // 4. Stars Per Stage: Strip keys matching unsafe patterns or containing non-numeric values
    if (data.starsPerStage && typeof data.starsPerStage === 'object') {
      for (var key in data.starsPerStage) {
        if (Object.prototype.hasOwnProperty.call(data.starsPerStage, key)) {
          // Reject keys that fail basic structural string naming schemas
          if (/^[a-zA-Z0-9_\-]+$/.test(key) && key.length < 64) {
            var val = Number(data.starsPerStage[key]);
            if (!isNaN(val)) {
              clean.starsPerStage[key] = Math.max(0, Math.floor(val));
            }
          }
        }
      }
    }

    return clean;
  }

  function load() {
    try {
      var raw = global.localStorage.getItem(SAVE_KEY);
      if (!raw) return defaultSave();
      
      // Secure JSON parsing with a reviver to prevent prototype pollution
      var parsed = JSON.parse(raw, function (key, value) {
        if (key === "__proto__" || key === "constructor" || key === "prototype") {
          return undefined;
        }
        return value;
      });
      
      // Merge onto defaults so missing/new fields never crash older saves, then sanitize
      var merged = Object.assign({}, defaultSave(), parsed);
      merged.starsPerStage = Object.assign({}, defaultSave().starsPerStage, parsed.starsPerStage || {});
      merged.settings = Object.assign({}, defaultSave().settings, parsed.settings || {});
      merged.stagesCleared = Array.isArray(parsed.stagesCleared) ? parsed.stagesCleared : [];
      
      return sanitize(merged);
    } catch (e) {
      console.warn("[SaveManager] Could not read save, starting fresh.", e);
      return defaultSave();
    }
  }

  function save(data) {
    try {
      // Always pass runtime state through our sanitizer engine prior to writing to storage
      var verifiedState = sanitize(data);
      global.localStorage.setItem(SAVE_KEY, JSON.stringify(verifiedState));
      return true;
    } catch (e) {
      console.warn("[SaveManager] Could not write save.", e);
      return false;
    }
  }

  // Merge a partial patch into the current save and persist it.
  function patch(partial) {
    var current = load();
    var next = Object.assign({}, current, partial);
    if (partial.starsPerStage) {
      next.starsPerStage = Object.assign({}, current.starsPerStage, partial.starsPerStage);
    }
    if (partial.settings) {
      next.settings = Object.assign({}, current.settings, partial.settings);
    }
    save(next);
    return load(); // Return sanitized load output for runtime state consistency
  }

  // Record a stage clear: adds seed, sprouts, stars, drops smog, dedupes.
  function recordStageClear(stageId, opts) {
    opts = opts || {};
    var current = load();
    var alreadyCleared = current.stagesCleared.indexOf(stageId) !== -1;

    var next = Object.assign({}, current);
    if (!alreadyCleared) {
      next.stagesCleared = current.stagesCleared.concat([stageId]);
      next.seeds = current.seeds + 1;
      next.smogLevel = Math.max(0, current.smogLevel - (opts.smogDrop != null ? opts.smogDrop : 10));
    }
    next.sprouts = current.sprouts + (opts.sprouts || 0);

    var prevStars = current.starsPerStage[stageId] || 0;
    var newStars = opts.stars != null ? opts.stars : prevStars;
    next.starsPerStage = Object.assign({}, current.starsPerStage);
    next.starsPerStage[stageId] = Math.max(prevStars, newStars);

    save(next);
    return load();
  }

  function reset() {
    save(defaultSave());
    return defaultSave();
  }

  global.GOGSave = {
    KEY: SAVE_KEY,
    defaultSave: defaultSave,
    load: load,
    save: save,
    patch: patch,
    recordStageClear: recordStageClear,
    reset: reset
  };
})(window);