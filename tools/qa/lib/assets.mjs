// APK-relevant size accounting: bytes of <root>/stages/assets by type and by stage, plus code size.
import fs from "node:fs";
import path from "node:path";

function walk(dir, out = []) {
  let ents = [];
  try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of ents) {
    if (e.name === ".git" || e.name === "node_modules" || e.name === "tools") continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out); else out.push({ p, size: fs.statSync(p).size });
  }
  return out;
}

const typeOf = (f) => {
  const e = path.extname(f).toLowerCase().slice(1);
  if (["png", "jpg", "jpeg", "webp", "gif", "svg"].includes(e)) return e === "jpeg" ? "jpg" : e;
  if (["mp3", "ogg", "wav", "m4a"].includes(e)) return e;
  if (["woff", "woff2", "ttf"].includes(e)) return "font";
  if (["js", "mjs"].includes(e)) return "js";
  return e || "other";
};

export function assetSizes(root) {
  const files = walk(root);
  const rel = (f) => path.relative(root, f).replace(/\\/g, "/");
  const res = { totalBytes: 0, assetsBytes: 0, codeBytes: 0, byType: {}, byStage: {}, largest: [] };
  const assets = [];
  for (const f of files) {
    const r = rel(f.p);
    res.totalBytes += f.size;
    const t = typeOf(f.p);
    if (r.startsWith("stages/assets/")) {
      res.assetsBytes += f.size;
      res.byType[t] = (res.byType[t] || 0) + f.size;
      const m = /\/(stage\d\d)\//.exec(r);
      const key = m ? m[1] : "shared";
      const s = (res.byStage[key] ||= { total: 0, byType: {} });
      s.total += f.size; s.byType[t] = (s.byType[t] || 0) + f.size;
      assets.push({ file: r, bytes: f.size });
    } else if (/\.(html|js|css)$/.test(r)) res.codeBytes += f.size;
  }
  res.largest = assets.sort((a, b) => b.bytes - a.bytes).slice(0, 15);
  return res;
}
