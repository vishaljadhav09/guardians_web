// Viewport matrix. kind: desktop | compact | tabletPortrait | phonePortrait | phoneLandscape
const mk = (w, h, kind) => {
  const phone = kind === "phonePortrait" || kind === "phoneLandscape";
  return { name: `${w}x${h}`, width: w, height: h, kind, deviceScaleFactor: phone ? 2 : 1, isMobile: phone, hasTouch: phone,
    // short landscape screens use the compact HUD in styles.css (orientation: landscape and max-height: 520px)
    compactLandscape: w > h && h <= 520 };
};

export const ALL = [
  ...[[2560, 1440], [1920, 1080], [1600, 900], [1536, 864], [1440, 900], [1366, 768], [1280, 800], [1280, 720]].map(([w, h]) => mk(w, h, "desktop")),
  ...[[1194, 834], [1180, 820], [1024, 768], [993, 700], [992, 700], [1280, 600]].map(([w, h]) => mk(w, h, "compact")),
  ...[[768, 1024], [820, 1180]].map(([w, h]) => mk(w, h, "tabletPortrait")),
  ...[[390, 844], [360, 640], [430, 932]].map(([w, h]) => mk(w, h, "phonePortrait")),
  ...[[844, 390], [932, 430], [667, 375], [740, 360]].map(([w, h]) => mk(w, h, "phoneLandscape")),
];

export const SMALL_NAMES = ["1920x1080", "1366x768", "1024x768", "844x390", "390x844"];
export const SMALL = ALL.filter((v) => SMALL_NAMES.includes(v.name));

export function pick(arg) {
  if (!arg || arg === "all") return ALL;
  if (arg === "small") return SMALL;
  const names = String(arg).split(",");
  const out = ALL.filter((v) => names.includes(v.name));
  if (!out.length) throw new Error(`no viewports match "${arg}"`);
  return out;
}
