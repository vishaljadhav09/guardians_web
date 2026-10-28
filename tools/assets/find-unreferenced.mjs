#!/usr/bin/env node
/*
  find-unreferenced.mjs - list (and optionally move away) assets under stages/assets that no shipped
  code mentions, and list referenced assets that do not exist.

    node tools/assets/find-unreferenced.mjs                      # report only
    node tools/assets/find-unreferenced.mjs --move <dir>         # move unreferenced files to <dir>/<same relative path>
    node tools/assets/find-unreferenced.mjs --keep background/map-bg.jpg --keep heart.png

  "Shipped code" = index.html, stages (html), src (js, css), data/*.js. Docs (CLAUDE.md, .claude/)
  are NOT references. A file counts as referenced when some source contains its path relative to
  stages/assets (sprites/stage01/can.png), or its file name (for names that are not just a digit,
  since 1.png..4.png exist in several folders; those need their parent folder in the text).
  Dynamic paths (SPRITE_BASE + 'name.png') are covered because the file name itself is searched.
  The script also warns about template strings/concatenation that build asset paths so a human can
  double check them.
*/
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const ASSETS = path.join(REPO, 'stages', 'assets');
const args = process.argv.slice(2);
const MOVE = args.includes('--move') ? path.resolve(args[args.indexOf('--move') + 1]) : null;
const KEEP = args.flatMap((a, i) => (a === '--keep' ? [args[i + 1]] : []));
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? (e.name === 'node_modules' ? [] : walk(path.join(d, e.name))) : [path.join(d, e.name)]));

const srcFiles = [
  path.join(REPO, 'index.html'),
  ...fs.readdirSync(path.join(REPO, 'stages')).filter((f) => f.endsWith('.html')).map((f) => path.join(REPO, 'stages', f)),
  ...walk(path.join(REPO, 'src')).filter((f) => /\.(js|css|html)$/.test(f)),
  ...walk(path.join(REPO, 'data')).filter((f) => f.endsWith('.js')),
];
const text = srcFiles.map((f) => fs.readFileSync(f, 'utf8')).join('\n');

const dynamic = [...text.matchAll(/(?:assets\/[\w./-]*|SPRITE_BASE|\.\.\/assets)[^\n]{0,40}(?:\$\{|['"`]\s*\+)/g)].map((m) => m[0]);
if (dynamic.length) console.warn('NOTE: dynamic asset paths found, double-check manually:\n  ' + dynamic.join('\n  '));

const assets = walk(ASSETS).sort();
const unref = [], ref = [];
for (const f of assets) {
  const r = path.relative(ASSETS, f).split(path.sep).join('/');
  const base = path.basename(f);
  const parent = path.basename(path.dirname(f));
  let used = text.includes(r);
  if (!used) {
    if (/^\d+\.\w+$/.test(base)) used = text.includes(`${parent}/${base}`) || (parent === 'assets' && text.includes(`assets/${base}`));
    else used = text.includes(base);
  }
  (used ? ref : unref).push(r);
}
const kept = unref.filter((r) => KEEP.includes(r));
const removable = unref.filter((r) => !KEEP.includes(r));

console.log(`referenced: ${ref.length}   unreferenced: ${unref.length}${kept.length ? `   (kept by --keep: ${kept.join(', ')})` : ''}`);
let bytes = 0;
for (const r of unref) { const s = fs.statSync(path.join(ASSETS, r)).size; if (!KEEP.includes(r)) bytes += s; console.log(`  UNREFERENCED ${r}  ${(s / 1024).toFixed(0)}K${KEEP.includes(r) ? '  [kept]' : ''}`); }
console.log(`removable total: ${(bytes / 1048576).toFixed(2)} MB`);

// referenced-but-missing: quoted strings that look like asset file names
const names = new Set(assets.map((f) => path.basename(f)));
const missing = new Set();
for (const m of text.matchAll(/["'`]([\w./${}+-]*?([\w.-]+\.(?:png|jpg|jpeg|webp|mp3|ogg|wav)))(?:\?[\w=]*)?["'`]/g)) {
  const fileName = m[2];
  if (/\$\{/.test(m[1])) continue;
  if (!names.has(fileName)) missing.add(m[1]);
}
for (const n of missing) console.log(`  MISSING (referenced, not on disk): ${n}`);

if (MOVE) {
  for (const r of removable) {
    const to = path.join(MOVE, r);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    try { fs.renameSync(path.join(ASSETS, r), to); } catch (e) { if (e.code !== 'EXDEV') throw e; fs.copyFileSync(path.join(ASSETS, r), to); fs.unlinkSync(path.join(ASSETS, r)); } // cross-drive move
  }
  // prune empty dirs
  const prune = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) if (e.isDirectory()) prune(path.join(d, e.name)); if (d !== ASSETS && fs.readdirSync(d).length === 0) fs.rmdirSync(d); };
  prune(ASSETS);
  console.log(`moved ${removable.length} files to ${MOVE}`);
}
