

(function (global) {
  "use strict";

  var STAGES = [
    {
      id: "stage01",
      order: 1,
      guardian: "Splash",
      animal: "Dolphin",
      biome: "Ocean",
      concept: "Plastic pollution",
      mechanic: "Steer-and-scoop collector",
      color: "var(--gog-cobalt)",
      icon: "🐬",
      mapPos: { x: 18, y: 78 },
      fact: "Over 8 million tonnes of plastic enter the ocean every year.",
      playable: true,
      href: "stages/stage01-ocean.html"
    },
    {
      id: "stage02",
      order: 2,
      guardian: "Ravi",
      animal: "Tiger cub",
      biome: "Rainforest",
      concept: "Deforestation / replanting",
      mechanic: "Grow-the-canopy (tower-defense-lite)",
      color: "var(--gog-lime)",
      icon: "🐯",
      mapPos: { x: 14, y: 48 },
      fact: "One big tree can soak up about 22 kg of CO\u2082 a year.",
      playable: false
    },
    {
      id: "stage03",
      order: 3,
      guardian: "Buzz",
      animal: "Bee",
      biome: "Meadow",
      concept: "Pollinators / food chains",
      mechanic: "Rhythm flight-path tracing",
      color: "var(--gog-tangerine)",
      icon: "🐝",
      mapPos: { x: 24, y: 20 },
      fact: "About 1 in 3 bites of our food depends on pollinators like bees.",
      playable: false
    },
    {
      id: "stage04",
      order: 4,
      guardian: "Penny",
      animal: "Penguin",
      biome: "Polar ice",
      concept: "Melting ice / sea level",
      mechanic: "Physics platformer on shifting ice",
      color: "var(--gog-cobalt)",
      icon: "🐧",
      mapPos: { x: 50, y: 10 },
      fact: "As the planet warms, sea ice shrinks \u2014 homes for polar animals shrink too.",
      playable: false
    },
    {
      id: "stage05",
      order: 5,
      guardian: "Breezy",
      animal: "Wind spirit",
      biome: "Sky",
      concept: "Clean vs dirty energy",
      mechanic: "Endless glider",
      color: "var(--gog-lavender)",
      icon: "🌬️",
      mapPos: { x: 78, y: 18 },
      fact: "Wind and sun make electricity without polluting the air.",
      playable: false
    },
    {
      id: "stage06",
      order: 6,
      guardian: "Pip",
      animal: "Panda",
      biome: "Bamboo grove",
      concept: "Habitat & biodiversity",
      mechanic: "Match-3 restoration",
      color: "var(--gog-lime)",
      icon: "🐼",
      mapPos: { x: 86, y: 46 },
      fact: "A healthy habitat has many different plants and animals living together.",
      playable: false
    },
    {
      id: "stage07",
      order: 7,
      guardian: "Rio",
      animal: "Rhino",
      biome: "Savanna",
      concept: "Protecting endangered species",
      mechanic: "Stealth guide-the-family maze",
      color: "var(--gog-tangerine)",
      icon: "🦏",
      mapPos: { x: 80, y: 76 },
      fact: "Protected reserves give endangered animals a safe place to live and grow.",
      playable: false
    },
    {
      id: "stage08",
      order: 8,
      guardian: "Ollie",
      animal: "Orangutan",
      biome: "Palm forest",
      concept: "Consumer choices / palm oil",
      mechanic: "Sorting / decision game",
      color: "var(--gog-pink)",
      icon: "🦧",
      mapPos: { x: 54, y: 88 },
      fact: "Choosing forest-friendly products helps keep rainforests standing.",
      playable: false
    },
    {
      id: "stage09",
      order: 9,
      guardian: "Zara",
      animal: "Giraffe",
      biome: "River delta",
      concept: "Water cycle & drought",
      mechanic: "Pipe-routing puzzle",
      color: "var(--gog-cobalt)",
      icon: "🦒",
      mapPos: { x: 30, y: 88 },
      fact: "Water moves in a cycle \u2014 clouds, rain, rivers, and back to the sky.",
      playable: false
    },
    {
      id: "stage10",
      order: 10,
      guardian: "Sol",
      animal: "Sun-lion",
      biome: "Heart of Gaia",
      concept: "It all connects",
      mechanic: "Balance boss finale",
      color: "var(--gog-pink)",
      icon: "☀️",
      mapPos: { x: 50, y: 50 },
      fact: "Everything in nature is connected \u2014 caring for one part helps them all.",
      playable: false,
      finale: true
    }
  ];

  function byId(id) {
    for (var i = 0; i < STAGES.length; i++) {
      if (STAGES[i].id === id) return STAGES[i];
    }
    return null;
  }

  function isUnlocked(stage, save) {
    if (stage.order === 1) return true;
    var prev = STAGES[stage.order - 2];
    return prev ? save.stagesCleared.indexOf(prev.id) !== -1 : false;
  }

  global.GOGContent = {
    STAGES: STAGES,
    byId: byId,
    isUnlocked: isUnlocked
  };
})(window);
