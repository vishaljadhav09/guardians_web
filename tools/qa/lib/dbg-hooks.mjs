// window.__dbg hook snippets, appended just before the closing `})();` of each stage's main inline script
// (by the static server's transform in play.mjs; the files on disk are never touched). Every reference is
// guarded with typeof so a renamed variable degrades to `undefined` instead of breaking the stage.
// Add an entry here when a new stage is built; keep the surface the same:
//   getState()  -> small JSON-able snapshot (progress / timer / lives / mode)
//   forceWin()  -> calls the stage's own win entry point (same code path as a real win)
//   forceLose() -> calls the stage's own lose entry point
//   ready()     -> true once the stage accepts input (intro dismissed)
const g = (expr) => `(function(){ try { return ${expr}; } catch (e) { return undefined; } })()`;

export const HOOKS = {
  stage01: `
  window.__dbg = {
    stage: "stage01",
    ready: function () { return typeof state !== "undefined" && !!state.running; },
    getState: function () { return { running: ${g("state.running")}, won: ${g("state.won")}, reef: ${g("state.reef")}, timeLeft: ${g("state.timeLeft")}, lives: ${g("state.lives")}, hits: ${g("state.hits")}, combo: ${g("state.combo")}, dolphin: ${g("({ x: dolphin.x, y: dolphin.y })")}, items: ${g("items.length")} }; },
    setProgress: function (v) { if (typeof state !== "undefined") state.reef = v; },
    forceWin: function () { endWin(); },
    forceLose: function () { endLose(); }
  };`,
  stage02: `
  window.__dbg = {
    stage: "stage02",
    ready: function () { return typeof state !== "undefined" && !!state.running; },
    getState: function () { return { running: ${g("state.running")}, elapsed: ${g("state.elapsed")}, canopyPercent: ${g("GOGStage2.getCanopyPercent()")}, wave: ${g("GOGStage2.wave")}, failureReason: ${g("GOGStage2.failureReason")}, sproutsChip: ${g("document.getElementById('sproutsChip').textContent")} }; },
    forceWin: function () { endWin(); },
    forceLose: function () { endLose(); }
  };`,
  stage03: `
  window.__dbg = {
    stage: "stage03",
    ready: function () { return typeof gameState !== "undefined" && gameState === "playing"; },
    getState: function () { return { gameState: ${g("gameState")}, score: ${g("score")}, combo: ${g("combo")}, pollinated: ${g("pollinatedCount")}, flowers: ${g("flowers.length")}, fruits: ${g("fruits.length")} }; },
    forceWin: function () { if (gameState !== "playing") gameState = "playing"; triggerWin(); },
    forceLose: function () { if (gameState !== "playing") gameState = "playing"; triggerFail(); }
  };`,
  stage04: `
  window.__dbg = {
    stage: "stage04",
    ready: function () { return typeof gameRunning !== "undefined" && !!gameRunning; },
    getState: function () { return { mode: ${g("state.state")}, running: ${g("gameRunning")}, rescued: ${g("state.chicks.filter(function (c) { return c.delivered; }).length")}, cameraX: ${g("cameraX")}, penny: ${g("({ x: state.player.x, y: state.player.y })")} }; },
    forceWin: function () { winGame(); },
    forceLose: function () { failGame("qa"); }
  };`,
  stage05: `
  window.__dbg = {
    stage: "stage05",
    ready: function () { return typeof gameState !== "undefined" && gameState === "playing"; },
    getState: function () { return { gameState: ${g("gameState")}, timeLeft: ${g("timeLeft")}, clarity: ${g("clarity")}, score: ${g("score")}, player: ${g("({ x: player.x, y: player.y })")} }; },
    forceWin: function () { triggerWin(); },
    forceLose: function () { triggerFail(); }
  };`,
};

/** Insert the hook before the last `})();` that precedes the last </script> in the file. Returns null if no anchor. */
export function injectHook(html, stageId) {
  const hook = HOOKS[stageId];
  if (!hook) return null;
  const endScript = html.lastIndexOf("</script>");
  if (endScript < 0) return null;
  const anchor = html.lastIndexOf("})();", endScript);
  if (anchor < 0) return null;
  return html.slice(0, anchor) + hook + "\n" + html.slice(anchor);
}
