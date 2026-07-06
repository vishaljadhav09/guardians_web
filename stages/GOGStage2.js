/* ============================================================
   GUARDIANS OF GAIA — STAGE 2 CORE LOGIC & STATE MACHINE
   Build: Isolated, pure logic layer, testable in browser console.
   Controls grid state, growth timer, BFS connectivity, and waves.
   ============================================================ */

(function (global) {
  "use strict";

  // Reusable flat array for BFS exploration (Phase 8 Performance Pass)
  var bfsQueue = [];

  var GOGStage2 = {
    // State variables
    grid: [],
    saplings: 0,
    wave: 0,
    maxWaves: 3,
    smogPosition: 0,
    smogDelay: 0.0, // Prep phase delay before smog moves (Phase 7 Balance Pass)
    gameState: "INTRO", // INTRO, WAVE_ACTIVE, WAVE_CLEARED, STAGE_WON, STAGE_LOST
    timer: 0,
    rows: 6,
    cols: 10,
    growthTime: 3.0, // current growth time (sec)
    growthTimes: [2.5, 3.0, 3.5], // wave-specific growth time difficulty tuning (Phase 7)
    smogSpeed: [0.08, 0.14, 0.22], // smog speeds per wave (cols per second) (Phase 7)

    // Initialize state
    init: function (rows, cols) {
      this.rows = rows || 6;
      this.cols = cols || 10;
      this.grid = [];
      for (var r = 0; r < this.rows; r++) {
        var row = [];
        for (var c = 0; c < this.cols; c++) {
          row.push({
            state: "empty",      // 'empty', 'sapling', 'tree', 'rock'
            growTimer: 0,
            connected: false
          });
        }
        this.grid.push(row);
      }

      // Add rock obstacles for default 6x10 hillside layout
      if (this.rows === 6 && this.cols === 10) {
        var rockCoords = [[1, 3], [2, 7], [4, 2], [4, 8], [3, 5]];
        var self = this;
        rockCoords.forEach(function (coord) {
          var rr = coord[0], cc = coord[1];
          if (rr >= 0 && rr < self.rows && cc >= 0 && cc < self.cols) {
            self.grid[rr][cc].state = "rock";
          }
        });
      }

      this.saplings = 6; // starts with some saplings
      this.wave = 1;
      this.smogPosition = this.cols; // Smog starts at the right edge
      this.smogDelay = 5.0; // 5 seconds of pre-smog planting delay
      this.growthTime = this.growthTimes[0]; // starts with wave 1 growth time
      this.gameState = "INTRO";
      this.timer = 75; // 75 seconds wave length
      this.computeConnectivity();
    },

    // Transition state
    transitionTo: function (newState) {
      var validStates = ["INTRO", "WAVE_ACTIVE", "WAVE_CLEARED", "STAGE_WON", "STAGE_LOST"];
      if (validStates.indexOf(newState) === -1) {
        console.error("[GOGStage2] Invalid game state transition to: " + newState);
        return;
      }
      console.log("[GOGStage2] State transition: " + this.gameState + " -> " + newState);
      this.gameState = newState;

      if (newState === "WAVE_ACTIVE") {
        this.smogPosition = this.cols;
        this.smogDelay = 5.0;
        this.growthTime = this.growthTimes[this.wave - 1] || 3.0;
      }
    },

    // Plant a tree
    plant: function (r, c) {
      if (this.gameState !== "WAVE_ACTIVE") {
        console.warn("[GOGStage2] Cannot plant when wave is not active.");
        return false;
      }
      if (r < 0 || r >= this.rows || c < 0 || c >= this.cols) return false;
      if (this.grid[r][c].state !== "empty") return false;
      
      // Smog cell lock: disable planting if cell is engulfed by smog (crossed column)
      if (c >= Math.floor(this.smogPosition)) {
        console.log("[GOGStage2] Cannot plant: cell engulfed by smog.");
        return false;
      }

      if (this.saplings <= 0) {
        console.log("[GOGStage2] Cannot plant: 0 saplings remaining.");
        return false;
      }

      this.saplings--;
      this.grid[r][c].state = "sapling";
      this.grid[r][c].growTimer = this.growthTime;
      return true;
    },

    // Advance growth of saplings
    advanceGrowth: function (dt) {
      var grownCells = [];
      for (var r = 0; r < this.rows; r++) {
        for (var c = 0; c < this.cols; c++) {
          var cell = this.grid[r][c];
          if (cell.state === "sapling") {
            cell.growTimer -= dt;
            if (cell.growTimer <= 0) {
              cell.state = "tree";
              cell.growTimer = 0;
              grownCells.push({ r: r, c: c });
            }
          }
        }
      }
      if (grownCells.length > 0) {
        this.computeConnectivity();
      }
      return grownCells;
    },

    // Compute connectivity of grown trees (4-directional BFS starting from column 0, Phase 8 GC-Free Pass)
    computeConnectivity: function () {
      // 1. Reset connectivity flag for all cells
      for (var r = 0; r < this.rows; r++) {
        for (var c = 0; c < this.cols; c++) {
          this.grid[r][c].connected = false;
        }
      }

      // 2. Clear pre-allocated queue and set head index pointer
      bfsQueue.length = 0;
      var queueHead = 0;

      // 3. Find root trees in column 0, push encoded coordinates
      for (var r = 0; r < this.rows; r++) {
        var cell = this.grid[r][0];
        if (cell.state === "tree") {
          cell.connected = true;
          bfsQueue.push(r * this.cols + 0); // Encoded as: row * cols + col
        }
      }

      // 4. Standard BFS exploration directions (Up, Down, Left, Right)
      var dr = [-1, 1, 0, 0];
      var dc = [0, 0, -1, 1];

      while (queueHead < bfsQueue.length) {
        var currEncoded = bfsQueue[queueHead++];
        var cr = Math.floor(currEncoded / this.cols);
        var cc = currEncoded % this.cols;

        for (var i = 0; i < 4; i++) {
          var nr = cr + dr[i];
          var nc = cc + dc[i];

          // Check grid boundaries
          if (nr >= 0 && nr < this.rows && nc >= 0 && nc < this.cols) {
            var neighbor = this.grid[nr][nc];
            // Connected if neighbor is a grown tree and not visited yet
            if (neighbor.state === "tree" && !neighbor.connected) {
              neighbor.connected = true;
              bfsQueue.push(nr * this.cols + nc); // Push encoded integer
            }
          }
        }
      }
    },

    // Helper: Check if a column forms a complete vertical canopy barrier (all rows have connected trees or rock obstacles)
    isColumnBlocked: function (c) {
      if (c < 0 || c >= this.cols) return false;
      for (var r = 0; r < this.rows; r++) {
        var cell = this.grid[r][c];
        if ((cell.state !== "tree" || !cell.connected) && cell.state !== "rock") {
          return false;
        }
      }
      return true;
    },

    // Creeps smog forward. Gaps let it through, full columns of connected trees block it.
    advanceSmog: function (dt) {
      if (this.gameState !== "WAVE_ACTIVE") return;

      var speed = this.smogSpeed[this.wave - 1] || 0.15;
      var targetPos = this.smogPosition - speed * dt;

      // Check if we hit any blocked columns as we move left
      var currentCol = Math.floor(this.smogPosition);
      var targetCol = Math.floor(targetPos);

      // Check each column between current and target (exclusive of starting, down to target)
      for (var c = currentCol; c >= targetCol; c--) {
        if (this.isColumnBlocked(c)) {
          // Blocked! Smog stops just at the right side of this column
          this.smogPosition = c + 1;
          return;
        }
      }

      this.smogPosition = Math.max(0, targetPos);

      // If smog reaches the left edge (column 0), the forest is overrun
      if (this.smogPosition <= 0) {
        this.loseWave();
      }
    },

    // Handle winning the current wave
    winWave: function () {
      if (this.wave >= this.maxWaves) {
        this.transitionTo("STAGE_WON");
      } else {
        this.transitionTo("WAVE_CLEARED");
      }
    },

    // Handle losing the wave
    loseWave: function () {
      this.transitionTo("STAGE_LOST");
    },

    // Wave progress ticker
    tick: function (dt) {
      if (this.gameState !== "WAVE_ACTIVE") return [];

      this.timer -= dt;
      var grown = this.advanceGrowth(dt);

      // Pre-smog delay: smog is frozen during preparation time (Phase 7 Balance Pass)
      if (this.smogDelay > 0) {
        this.smogDelay = Math.max(0, this.smogDelay - dt);
      } else {
        this.advanceSmog(dt);
      }

      if (this.timer <= 0) {
        this.winWave();
      }
      return grown;
    },

    // ------------------------------------------------------------
    // CHECKPOINT UNIT TESTS
    // ------------------------------------------------------------
    runTests: function () {
      console.log("%c--- STARTING GOG STAGE 2 TESTS ---", "font-weight: bold; color: #2e5ee8;");
      var passCount = 0;
      var totalTests = 0;

      function assert(desc, val) {
        totalTests++;
        if (val) {
          console.log("✅ PASS: " + desc);
          passCount++;
        } else {
          console.error("❌ FAIL: " + desc);
        }
      }

      // Test 1: All-Connected Grid
      (function () {
        GOGStage2.init(3, 3);
        // Fill entire grid with grown trees
        for (var r = 0; r < 3; r++) {
          for (var c = 0; c < 3; c++) {
            GOGStage2.grid[r][c].state = "tree";
          }
        }
        GOGStage2.computeConnectivity();

        var allConnected = true;
        for (var r = 0; r < 3; r++) {
          for (var c = 0; c < 3; c++) {
            if (!GOGStage2.grid[r][c].connected) allConnected = false;
          }
        }
        assert("Test 1 - All-Connected Grid (All trees connected)", allConnected);
      })();

      // Test 2: Grid with One Gap (full column gap splits connectivity)
      (function () {
        GOGStage2.init(3, 3);
        // Col 0: grown trees
        GOGStage2.grid[0][0].state = "tree";
        GOGStage2.grid[1][0].state = "tree";
        GOGStage2.grid[2][0].state = "tree";

        // Col 1: Empty (the gap)
        GOGStage2.grid[0][1].state = "empty";
        GOGStage2.grid[1][1].state = "empty";
        GOGStage2.grid[2][1].state = "empty";

        // Col 2: grown trees
        GOGStage2.grid[0][2].state = "tree";
        GOGStage2.grid[1][2].state = "tree";
        GOGStage2.grid[2][2].state = "tree";

        GOGStage2.computeConnectivity();

        assert("Test 2 - One Gap: Col 0 trees are connected",
          GOGStage2.grid[0][0].connected && GOGStage2.grid[1][0].connected && GOGStage2.grid[2][0].connected
        );
        assert("Test 2 - One Gap: Col 2 trees are NOT connected due to full gap column",
          !GOGStage2.grid[0][2].connected && !GOGStage2.grid[1][2].connected && !GOGStage2.grid[2][2].connected
        );
      })();

      // Test 3: Diagonal-Only Touching Grid
      (function () {
        GOGStage2.init(3, 3);
        // Diagonal trees
        GOGStage2.grid[0][0].state = "tree";
        GOGStage2.grid[1][1].state = "tree";
        GOGStage2.grid[2][2].state = "tree";

        GOGStage2.computeConnectivity();

        assert("Test 3 - Diagonal: Root (0,0) is connected", GOGStage2.grid[0][0].connected);
        assert("Test 3 - Diagonal: (1,1) is NOT connected 4-directionally", !GOGStage2.grid[1][1].connected);
        assert("Test 3 - Diagonal: (2,2) is NOT connected 4-directionally", !GOGStage2.grid[2][2].connected);
      })();

      // Test 4: Empty Grid / 0 Saplings
      (function () {
        GOGStage2.init(3, 3);
        GOGStage2.saplings = 0;
        GOGStage2.transitionTo("WAVE_ACTIVE");

        // Try to plant with 0 saplings
        var plantResult = GOGStage2.plant(0, 0);
        assert("Test 4 - 0 Saplings: Planting fails", plantResult === false);
        assert("Test 4 - 0 Saplings: Grid cell remains empty", GOGStage2.grid[0][0].state === "empty");

        GOGStage2.computeConnectivity();
        var noneConnected = true;
        for (var r = 0; r < 3; r++) {
          for (var c = 0; c < 3; c++) {
            if (GOGStage2.grid[r][c].connected) noneConnected = false;
          }
        }
        assert("Test 4 - Empty Grid: No cells are connected", noneConnected);
      })();

      // Test 5: Smog Propagation & Column Blocking
      (function () {
        GOGStage2.init(3, 3);
        // Create a complete vertical canopy block at column 1
        GOGStage2.grid[0][0].state = "tree";
        GOGStage2.grid[1][0].state = "tree";
        GOGStage2.grid[2][0].state = "tree";

        GOGStage2.grid[0][1].state = "tree";
        GOGStage2.grid[1][1].state = "tree";
        GOGStage2.grid[2][1].state = "tree";

        GOGStage2.computeConnectivity();

        assert("Test 5 - Canopy Block: Col 1 is blocked", GOGStage2.isColumnBlocked(1));
        assert("Test 5 - Canopy Block: Col 2 is NOT blocked", !GOGStage2.isColumnBlocked(2));

        // Start wave active, smog position at col 3 (right edge)
        GOGStage2.transitionTo("WAVE_ACTIVE");
        GOGStage2.smogPosition = 3;

        var originalSpeed = GOGStage2.smogSpeed[0];
        GOGStage2.smogSpeed[0] = 0.1; // enforce 0.1 speed for explicit test math

        // Creep smog by 0.5 units (target col 2.5) -> Not blocked at col 2
        GOGStage2.advanceSmog(5); // 0.1 speed * 5 = 0.5 units. Position = 2.5
        assert("Test 5 - Smog: Creeps through column 2 (no barrier)", GOGStage2.smogPosition === 2.5);

        // Creep smog further -> should get blocked by column 1 barrier
        GOGStage2.advanceSmog(10); // Target position: 2.5 - 1.0 = 1.5, which attempts to cross column 1
        assert("Test 5 - Smog: Blocked at column 1 boundary (pos 2)", GOGStage2.smogPosition === 2);

        GOGStage2.smogSpeed[0] = originalSpeed; // restore original speed
      })();

      // Test 6: Multiple disconnected components & Growth Ticking
      (function () {
        GOGStage2.init(4, 4);
        GOGStage2.saplings = 5;
        GOGStage2.transitionTo("WAVE_ACTIVE");

        // Plant at (0,0) and (2,2)
        GOGStage2.plant(0, 0);
        GOGStage2.plant(2, 2);

        assert("Test 6 - Growth: Cell (0,0) is a sapling", GOGStage2.grid[0][0].state === "sapling");
        assert("Test 6 - Growth: Cell (2,2) is a sapling", GOGStage2.grid[2][2].state === "sapling");

        // Tick growth (less than growth time of 3.0s)
        GOGStage2.advanceGrowth(1.5);
        assert("Test 6 - Growth: Cell (0,0) still sapling", GOGStage2.grid[0][0].state === "sapling");

        // Tick remainder
        GOGStage2.advanceGrowth(1.5);
        assert("Test 6 - Growth: Cell (0,0) is now a tree", GOGStage2.grid[0][0].state === "tree");
        assert("Test 6 - Growth: Cell (2,2) is now a tree", GOGStage2.grid[2][2].state === "tree");

        // Check connectivity:
        // (0,0) is in col 0 -> connected = true
        // (2,2) is isolated -> connected = false
        assert("Test 6 - Connectivity: (0,0) tree connected", GOGStage2.grid[0][0].connected === true);
        assert("Test 6 - Connectivity: (2,2) tree disconnected", GOGStage2.grid[2][2].connected === false);
      })();

      // Test 7: Rock obstacles and Smog cell locks
      (function () {
        GOGStage2.init(6, 10);
        GOGStage2.saplings = 5;
        GOGStage2.transitionTo("WAVE_ACTIVE");

        // Verify that rock cells were initialized correctly
        assert("Test 7 - Rock: (1,3) is indeed rock state", GOGStage2.grid[1][3].state === "rock");

        // Attempting to plant on rock should fail
        var rockPlant = GOGStage2.plant(1, 3);
        assert("Test 7 - Rock: Planting on rock cell fails", rockPlant === false);

        // Move smog to column 5 (smog engulfs col 5 to 9)
        GOGStage2.smogPosition = 5;

        // Attempt to plant on col 4 (should succeed)
        var col4Plant = GOGStage2.plant(0, 4);
        assert("Test 7 - Smog Lock: Planting on col 4 (not engulfed) succeeds", col4Plant === true);

        // Attempt to plant on col 6 (should fail due to smog)
        var col6Plant = GOGStage2.plant(0, 6);
        assert("Test 7 - Smog Lock: Planting on col 6 (engulfed by smog) fails", col6Plant === false);
      })();

      console.log("%cGOG STAGE 2 TESTS SUMMARY: Passed " + passCount + "/" + totalTests + " tests.", 
        "font-weight: bold; color: " + (passCount === totalTests ? "#2fbf71" : "#e82e5d") + ";");
    }
  };

  // Expose GOGStage2 globally
  global.GOGStage2 = GOGStage2;

})(typeof window !== "undefined" ? window : global);
