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

  function load() {
    try {
      var raw = global.localStorage.getItem(SAVE_KEY);
      if (!raw) return defaultSave();
      var parsed = JSON.parse(raw);
      // merge onto defaults so missing/new fields never crash older saves
      var merged = Object.assign({}, defaultSave(), parsed);
      merged.starsPerStage = Object.assign({}, defaultSave().starsPerStage, parsed.starsPerStage || {});
      merged.settings = Object.assign({}, defaultSave().settings, parsed.settings || {});
      merged.stagesCleared = Array.isArray(parsed.stagesCleared) ? parsed.stagesCleared : [];
      return merged;
    } catch (e) {
      console.warn("[SaveManager] Could not read save, starting fresh.", e);
      return defaultSave();
    }
  }

  function save(data) {
    try {
      global.localStorage.setItem(SAVE_KEY, JSON.stringify(data));
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
    return next;
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
    return next;
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
