/**
 * ============================================================================
 * Guardians of Gaia - Global Game Constants
 * ============================================================================
 * Centralized configuration for all stages and game mechanics
 * Update values here and they propagate across all stages
 * ============================================================================
 */

const GOGConstants = {
  // ========================================================================
  // GAME TIMING (in SECONDS - applies to all stages)
  // ========================================================================
  STANDARD_GAME_TIME: 60, // seconds - Standard duration for all game stages

  // Milliseconds version (for stages using ms-based timers)
  get STANDARD_GAME_TIME_MS() {
    return this.STANDARD_GAME_TIME * 1000;
  },

  // ========================================================================
  // TIMER UI THRESHOLDS
  // ========================================================================
  TIMER_URGENT_THRESHOLD: 10, // seconds - when timer shows red pulse (Stages 1-2)
  TIMER_DANGER_THRESHOLD: 15, // seconds - when timer shows danger state (Stage 3)

  // ========================================================================
  // STAGE-SPECIFIC CONSTANTS
  // ========================================================================
  
  // Stage 1: Splash & the Plastic Tide
  STAGE1: {
    name: "Splash & the Plastic Tide",
    gameTime: 60, // seconds
    get gameTimeMs() {
      return this.gameTime * 1000;
    },
    reef: {
      targetClearance: 100, // % of plastic to clear to win
    },
  },

  // Stage 2: Ravi & the Smog Cycle
STAGE2: {
  name: "Ravi & the Smog Cycle",
  gameTime: 20, // TOTAL TIME FOR ENTIRE STAGE (all 3 waves)
  waves: 3,
  
  // Auto-calculated:
  get timePerWave() {
    return 20;  // 60 / 3 = 20 seconds
  },
  
  get timePerWaveMs() {
    return this.timePerWave * 1000;  // 20000 ms per wave
  }
},

  // Stage 3: Buzz & the Last Blooms
  STAGE3: {
    name: "Buzz & the Last Blooms",
    gameTime: 60, // seconds
    get gameTimeMs() {
      return this.gameTime * 1000;
    },
    pollination: {
      targetScore: 100, // % flowers pollinated to win
    },
  },

  // Stage 4: Penny on Thin Ice
  STAGE4: {
    name: "Penny on Thin Ice",
    gameTime: 60, // seconds - if/when timer is implemented
    get gameTimeMs() {
      return this.gameTime * 1000;
    },
    chicks: 5, // total chicks to rescue
    seaLevelRise: 0.15, // units per second when player stands still
  },

  // Stage 5: Breezy & the Two Skies
  STAGE5: {
    name: "Breezy & the Two Skies",
    gameTime: 60, // seconds - if/when timer is implemented
    get gameTimeMs() {
      return this.gameTime * 1000;
    },
  },

  // ========================================================================
  // UI/DISPLAY CONFIGURATION
  // ========================================================================
  UI: {
    timerFormat: "{time}s", // Format string for timer display
    showTimerUrgent: true, // Show urgent animation when time is low
    showTimerChip: true, // Show timer in HUD
  },

  // ========================================================================
  // DIFFICULTY PRESETS
  // ========================================================================
  DIFFICULTY: {
    EASY: {
      timeMultiplier: 1.5, // 50% more time
      enemySpeedMultiplier: 0.8, // Slower enemies
    },
    NORMAL: {
      timeMultiplier: 1.0, // Standard time
      enemySpeedMultiplier: 1.0,
    },
    HARD: {
      timeMultiplier: 0.8, // 20% less time
      enemySpeedMultiplier: 1.2, // Faster enemies
    },
  },

  // ========================================================================
  // HELPER METHODS
  // ========================================================================

  /**
   * Get game time for a specific stage
   * @param {number} stageNum - Stage number (1-5)
   * @param {string} format - 'seconds' or 'milliseconds'
   * @returns {number}
   */
  getStageTime(stageNum, format = 'seconds') {
    const stage = this[`STAGE${stageNum}`];
    if (!stage) {
      console.error(`Stage ${stageNum} not found in constants`);
      return this.STANDARD_GAME_TIME;
    }
    return format === 'milliseconds' ? stage.gameTimeMs : stage.gameTime;
  },

  /**
   * Apply difficulty multiplier to game time
   * @param {string} difficulty - 'EASY', 'NORMAL', or 'HARD'
   * @param {string} format - 'seconds' or 'milliseconds'
   * @returns {number}
   */
  getAdjustedGameTime(difficulty = 'NORMAL', format = 'seconds') {
    const multiplier = this.DIFFICULTY[difficulty]?.timeMultiplier || 1.0;
    const baseTime = this.STANDARD_GAME_TIME;
    const adjustedTime = baseTime * multiplier;
    return format === 'milliseconds' ? adjustedTime * 1000 : adjustedTime;
  },

  /**
   * Get timer display text
   * @param {number} secondsRemaining
   * @returns {string}
   */
  formatTimerDisplay(secondsRemaining) {
    return Math.max(0, Math.ceil(secondsRemaining)) + "s";
  },

  /**
   * Check if timer should show urgent state
   * @param {number} secondsRemaining
   * @param {number} threshold
   * @returns {boolean}
   */
  isTimerUrgent(secondsRemaining, threshold = this.TIMER_URGENT_THRESHOLD) {
    return secondsRemaining <= threshold && secondsRemaining > 0;
  },

  /**
   * Check if timer should show danger state (for Stage 3)
   * @param {number} secondsRemaining
   * @param {number} threshold
   * @returns {boolean}
   */
  isTimerDanger(secondsRemaining, threshold = this.TIMER_DANGER_THRESHOLD) {
    return secondsRemaining <= threshold && secondsRemaining > 0;
  },
};

// Make available globally
if (typeof window !== 'undefined') {
  window.GOGConstants = GOGConstants;
}

// Export for module systems if needed
if (typeof module !== 'undefined' && module.exports) {
  module.exports = GOGConstants;
}