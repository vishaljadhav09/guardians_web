(function (global) {
  "use strict";

  // In-memory fallback if GOGSave is not loaded
  var memoryState = {
    stageStars: {},
    stageAssist: {},
    stageAttempts: {},
    settings: {
      calmMode: false
    }
  };

  var isSaveLoaded = !!(global.GOGSave);

  function getSaveState() {
    if (isSaveLoaded && typeof global.GOGSave.load === "function") {
      try {
        var save = global.GOGSave.load();
        return {
          stageStars: save.stageStars || {},
          stageAssist: save.stageAssist || {},
          stageAttempts: save.stageAttempts || {},
          settings: save.settings || {}
        };
      } catch (e) {
        console.warn("[GOGProgress] Error loading GOGSave, using memory state.", e);
      }
    }
    return memoryState;
  }

  function patchSaveState(patch) {
    if (isSaveLoaded && typeof global.GOGSave.patch === "function") {
      try {
        global.GOGSave.patch(patch);
        return;
      } catch (e) {
        console.warn("[GOGProgress] Error patching GOGSave, patching memory state instead.", e);
      }
    }
    if (patch.stageStars) {
      Object.assign(memoryState.stageStars, patch.stageStars);
    }
    if (patch.stageAssist) {
      Object.assign(memoryState.stageAssist, patch.stageAssist);
    }
    if (patch.stageAttempts) {
      Object.assign(memoryState.stageAttempts, patch.stageAttempts);
    }
    if (patch.settings) {
      Object.assign(memoryState.settings, patch.settings);
    }
  }

  function getCalmMode() {
    var state = getSaveState();
    return !!(state.settings && state.settings.calmMode);
  }

  var stars = {
    fromScore: function (score01, thresholds) {
      if (score01 >= thresholds.three) return 3;
      if (score01 >= thresholds.two) return 2;
      return 1;
    },
    fromRules: function (rules) {
      for (var i = 0; i < rules.length; i++) {
        if (rules[i].when) {
          return rules[i].stars;
        }
      }
      return 1;
    },
    record: function (stageId, starsVal) {
      var state = getSaveState();
      var best = state.stageStars[stageId] || 0;
      var isNewBest = false;
      if (starsVal > best) {
        best = starsVal;
        isNewBest = true;
        var partial = { stageStars: {} };
        partial.stageStars[stageId] = starsVal;
        patchSaveState(partial);
      }
      return { stars: starsVal, best: best, isNewBest: isNewBest };
    },
    best: function (stageId) {
      var state = getSaveState();
      return state.stageStars[stageId] || 0;
    },
    total: function () {
      var state = getSaveState();
      var sum = 0;
      for (var key in state.stageStars) {
        if (Object.prototype.hasOwnProperty.call(state.stageStars, key)) {
          sum += state.stageStars[key] || 0;
        }
      }
      return sum;
    }
  };

  function difficulty(stageId, strength) {
    strength = (strength === undefined) ? 1 : strength;

    // Load initial assist notch for this stage
    var state = getSaveState();
    var rawAssist = state.stageAssist[stageId];
    
    var isCalm = getCalmMode();
    var assist;
    if (rawAssist === undefined) {
      assist = isCalm ? 1 : 0;
    } else {
      assist = isCalm ? Math.max(1, rawAssist) : rawAssist;
    }
    assist = Math.max(0, Math.min(4, assist));

    var handle = {
      softClutched: false,
      
      softClutch: function () {
        this.softClutched = true;
      },

      getAssist: function () {
        var effective = assist;
        if (this.softClutched) {
          effective = Math.min(4, effective + 1);
        }
        return effective;
      },

      gentleness: function () {
        return (this.getAssist() / 4) * strength;
      },

      spawnIntervalMul: function () {
        // fewer things at once: intervals get longer
        return 1.0 + this.gentleness() * 0.5;
      },

      enemySpeedMul: function () {
        // hazards slower: speed gets slower
        return 1.0 - this.gentleness() * 0.3;
      },

      forgivenessMul: function () {
        // bigger catch radius
        return 1.0 + this.gentleness() * 0.2;
      },

      bonusLives: function () {
        // integer: 0, 1, or 2
        return Math.floor(this.getAssist() / 2);
      },

      goalMul: function () {
        // target eased
        return 1.0 - this.gentleness() * 0.1;
      },

      reportWin: function (starsScored) {
        var localCalm = getCalmMode();
        var floor = localCalm ? 1 : 0;
        var decrease = (starsScored === 3) ? 2 : 1;
        var newAssist = Math.max(floor, assist - decrease);

        var partial = { stageAssist: {} };
        partial.stageAssist[stageId] = newAssist;
        patchSaveState(partial);

        assist = newAssist;
      },

      reportLoss: function () {
        var localCalm = getCalmMode();
        var increase = localCalm ? 2 : 1;
        var newAssist = Math.min(4, assist + increase);

        var partial = { stageAssist: {} };
        partial.stageAssist[stageId] = newAssist;
        patchSaveState(partial);

        assist = newAssist;
      }
    };

    return handle;
  }

  function finishStage(stageId, opts) {
    opts = opts || {};
    var starsScored = opts.stars || 1;
    var diffObj = opts.diff;
    if (diffObj && typeof diffObj.reportWin === "function") {
      diffObj.reportWin(starsScored);
    }
    return stars.record(stageId, starsScored);
  }

  function failStage(stageId, opts) {
    opts = opts || {};
    var diffObj = opts.diff;
    if (diffObj && typeof diffObj.reportLoss === "function") {
      diffObj.reportLoss();
    }
  }

  global.GOGProgress = {
    stars: stars,
    difficulty: difficulty,
    finishStage: finishStage,
    failStage: failStage
  };

})(typeof window !== "undefined" ? window : global);
