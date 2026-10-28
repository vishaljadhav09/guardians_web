#!/usr/bin/env node
// Merge partial run dirs (e.g. run in parallel with different --only) into one:
//   node merge.mjs <intoDir> <partDir> [<partDir> ...]
// Copies screenshots, merges results.json pages/viewports, regenerates summary.md.
import fs from "node:fs";
import path from "node:path";
import { writeSummary } from "./lib/report.mjs";

const [into, ...parts] = process.argv.slice(2).map((p) => path.resolve(p));
if (!into || !parts.length) { console.error("usage: node merge.mjs <intoDir> <partDir>..."); process.exit(1); }
fs.mkdirSync(into, { recursive: true });
let merged = { meta: {}, assets: null, pages: {} };
const intoFile = path.join(into, "results.json");
if (fs.existsSync(intoFile)) merged = JSON.parse(fs.readFileSync(intoFile, "utf8"));
for (const part of parts) {
  const r = JSON.parse(fs.readFileSync(path.join(part, "results.json"), "utf8"));
  merged.meta = Object.keys(merged.meta).length ? merged.meta : r.meta;
  merged.assets ||= r.assets;
  for (const [name, pg] of Object.entries(r.pages)) {
    const dst = (merged.pages[name] ||= { file: pg.file, viewports: {}, requestUrls: pg.requestUrls });
    Object.assign(dst.viewports, pg.viewports);
    dst.requestUrls ||= pg.requestUrls;
    const src = path.join(part, name);
    if (fs.existsSync(src)) fs.cpSync(src, path.join(into, name), { recursive: true });
  }
}
fs.writeFileSync(intoFile, JSON.stringify(merged, null, 1));
console.log("merged ->", intoFile, "\n" + writeSummary(into));
