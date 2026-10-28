#!/usr/bin/env node
/*
  optimize-images.mjs - shrink the game's PNG sprites/backgrounds WITHOUT renaming them.

  Usage (cwd does not matter; run `npm i` once in tools/assets first):
    node tools/assets/optimize-images.mjs --dry                       # plan + table, writes nothing
    node tools/assets/optimize-images.mjs --backup <dir>              # real run (SAFE entries + lossless pass)
    node tools/assets/optimize-images.mjs --only sprites/stage05/happy-breezy.png --scale 0.3 --backup <dir>
        # resize ONE file by a uniform factor (used by stage agents together with the matching
        # constant changes listed in tools/assets/stage-followups.md). Works for any manifest entry.
    node tools/assets/optimize-images.mjs --hub-bg --backup <dir>     # bio_bg.png -> bio_bg.webp (hub only)

  Paths for --only are relative to stages/assets (e.g. sprites/stage04/penny_idle.png).

  How a file is classified (see MANIFEST, derived by reading each stage's draw code):
    safe    frame size comes from naturalWidth/cols + naturalHeight/rows (or the whole image is drawn
            into a fixed destination box), so a uniform downscale changes nothing on screen. Default
            runs resize these. New width is an exact multiple of `cols`, new height of `rows`, so the
            frame grid stays pixel-aligned; aspect ratio is preserved (to rounding); never upscales;
            each texture <= 2048 px; Lanczos3 (sharp default alpha handling = premultiplied resize,
            so no dark/light halos on soft edges).
    unsafe  the stage hard-codes source rects/frame sizes or derives the destination size from the
            source size. A default run NEVER touches these; `--only <file> --scale <n>` does, and
            prints the exact effective x/y factors the stage code must be multiplied by.
    (none)  not listed: only a lossless re-pack (palette PNG when the image has <= 256 distinct RGBA
            values, i.e. provably lossless; otherwise max-effort deflate). Kept only if >= 3% smaller.

  Target size = drawn size (logical px) x headroom. headroom 2 (CSS upscale + hi-DPI cap 1.5);
  hero characters use 2.5.

  Idempotent: if the current file already fits the target it is skipped.
*/
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const ASSETS = path.join(REPO, 'stages', 'assets');

const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const opt = (n, d) => (args.includes(n) ? args[args.indexOf(n) + 1] : d);
const DRY = flag('--dry');
const ONLY = opt('--only', null);
const SCALE = opt('--scale', null) ? parseFloat(opt('--scale')) : null;
const BACKUP = path.resolve(opt('--backup', path.join(os.tmpdir(), 'gog-orig-images-backup')));
const MAX_TEX = 2048;

// dest = [w, h] drawn size in the stage's logical pixels (frame, not sheet). rec = recommended --scale.
const MANIFEST = {
  // ---- stage 1 (canvas 960x600 bitmap) ----
  'sprites/stage01/turtle.png': { mode: 'safe', cols: 4, rows: 2, dest: [70, 70], headroom: 2, ref: 'stage01-ocean.html:3357-3366 (fw=img.width/4, fh=img.height/2; drawn 70x70)' },
  'sprites/stage01/purple_fish.png': { mode: 'safe', cols: 4, rows: 2, dest: [76, 76], headroom: 2, ref: 'stage01-ocean.html:3376-3389 (width/4, height/2; drawn 76x76)' },
  'sprites/stage01/fish_tangled.png': { mode: 'safe', cols: 6, rows: 1, dest: [96, 64], headroom: 2, ref: 'stage01-ocean.html:3394-3405 (width/6, full height; drawn 96x64)' },
  'sprites/stage01/dolphine_swim.png': { mode: 'unsafe', cols: 5, rows: 4, why: 'hard-coded 128x128 source rects (stage01-ocean.html:3236-3248); already drawn at 180 (upscaled) so there is nothing to gain', rec: null },
  'sprites/stage01/dolphine_attack.png': { mode: 'unsafe', cols: 5, rows: 2, why: 'hard-coded 256x256 source rects (stage01-ocean.html:3213-3228), drawn at 180: only ~1.4x headroom, not worth it', rec: null },
  'sprites/stage01/sea_wed.png': { mode: 'unsafe', cols: 1, rows: 1, why: 'stage 1 + stage 3 draw it at natural size x sw.scale (dest derived from source size)', rec: 0.6 },
  'sprites/stage01/sea_wed_2.png': { mode: 'unsafe', cols: 1, rows: 1, why: 'stage 1 + stage 3 draw it at natural size x sw.scale (dest derived from source size)', rec: 0.6 },
  '3.png': { mode: 'unsafe', cols: 1, rows: 1, why: 'stage 1 parallax tile: tileW = img.width (stage01-ocean.html:3126) so the tile width follows the source; ~1:1 texel to logical px already', rec: null },
  // ---- stage 2 ----
  'sprites/stage02/rock.png': { mode: 'safe', cols: 1, rows: 1, dest: [296, 211], headroom: 2, ref: 'stage02-forest.html:3668-3683 (dest = natural * min((cell-12)/natural)*2 -> only the aspect ratio matters; max ~296x211 on the 6-col grid)' },
  // ---- stage 3 ----
  'sprites/stage03/bees-flying.png': { mode: 'unsafe', cols: 4, rows: 2, why: 'hard-coded 256x256 frames: stage03-food.html:674-675, stage02-forest.html:1783-1787', rec: 0.5 },
  'sprites/stage03/Boar_Run_with_shadow.png': { mode: 'unsafe', cols: 4, rows: 1, why: 'hard-coded frameWidth/frameHeight (stage03-food.html:849); frame is only 1.5x the draw size', rec: null },
  'sprites/stage03/Deer_Run_with_shadow.png': { mode: 'unsafe', cols: 8, rows: 1, why: 'hard-coded frame (stage03-food.html:850) and a hard-coded 32x32 source rect in stage02-forest.html:1759-1763; frame only 1.8x the draw size', rec: null },
  'sprites/stage03/rabbit_run.png': { mode: 'unsafe', cols: 8, rows: 1, why: 'hard-coded frame (stage03-food.html:851); frame only 2.2x the draw size', rec: null },
  'sprites/stage03/flower_1.png': { mode: 'unsafe', cols: 5, rows: 1, why: 'hard-coded sw=152/sh=154 (stage03-food.html:2755-2756)', rec: null },
  'sprites/stage03/flower_2.png': { mode: 'unsafe', cols: 5, rows: 1, why: 'hard-coded sw=153.2/sh=119 (stage03-food.html:2784-2785)', rec: null },
  // ---- stage 4 (VIEW 800x600, Penny drawn 72 wide; heroes get 2.5x) ----
  'sprites/stage04/penny_idle.png': { mode: 'safe', cols: 3, rows: 1, dest: [72, 102], headroom: 2.5, ref: 'stage04-ice.html:816-819 frameW=naturalWidth/cols; destW=72 (3724) / 44,40 (3089,3119)' },
  'sprites/stage04/penny_running.png': { mode: 'safe', cols: 5, rows: 1, dest: [72, 104], headroom: 2.5, ref: 'stage04-ice.html:816-819; destW=72 (3724)' },
  'sprites/stage04/penny_jump.png': { mode: 'safe', cols: 3, rows: 1, dest: [72, 100], headroom: 2.5, ref: 'stage04-ice.html:816-819; destW=72 (3724)' },
  'sprites/stage04/penny_chicks_idel.png': { mode: 'safe', cols: 3, rows: 2, dest: [48, 51], headroom: 2, ref: 'stage04-ice.html:836-839; CHICK_W=48 (925), 34 (3802)' },
  // ---- stage 5 ----
  'sprites/stage05/flying_breezy_v1.png': { mode: 'unsafe', cols: 5, rows: 1, why: 'hard-coded per-frame sx/sw/cx table in source pixels (stage05-sky.html:574-580)', rec: 0.4 },
  'sprites/stage05/happy-breezy.png': { mode: 'unsafe', cols: 3, rows: 1, why: 'hard-coded per-frame sx/sw/cx table in source pixels (stage05-sky.html:581-585)', rec: 0.3 },
};

const mb = (w, h) => ((w * h * 4) / 1048576).toFixed(1);
const kb = (b) => (b / 1024).toFixed(0) + 'K';
const rel = (f) => path.relative(ASSETS, f).split(path.sep).join('/');
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));

function gridDims(w, h, cols, rows, s) {
  // new width = exact multiple of cols, new height = exact multiple of rows
  const nw = Math.max(cols, Math.round((w * s) / cols) * cols);
  const nh = Math.max(rows, Math.round((h * (nw / w)) / rows) * rows);
  return [nw, nh];
}
function autoScale(w, h, m) {
  const fw = w / m.cols, fh = h / m.rows;
  let s = Math.max((m.headroom * m.dest[0]) / fw, (m.headroom * m.dest[1]) / fh);
  s = Math.min(s, 1, MAX_TEX / w, MAX_TEX / h);
  return s;
}
async function distinctColours(file) {
  const { data } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const set = new Set();
  const u32 = new Uint32Array(data.buffer, data.byteOffset, data.length >> 2);
  for (let i = 0; i < u32.length; i++) { set.add(u32[i]); if (set.size > 256) return 257; }
  return set.size;
}
async function repack(file) {
  // returns best lossless buffer
  const raw = fs.readFileSync(file);
  const meta = await sharp(file).metadata();
  let best = raw;
  const full = await sharp(file).png({ compressionLevel: 9, adaptiveFiltering: true }).toBuffer();
  if (full.length < best.length) best = full;
  if ((await distinctColours(file)) <= 256) {
    const pal = await sharp(file).png({ palette: true, colours: 256, dither: 0, effort: 10, compressionLevel: 9 }).toBuffer();
    // verify bit-exact RGBA
    const a = await sharp(file).ensureAlpha().raw().toBuffer();
    const b = await sharp(pal).ensureAlpha().raw().toBuffer();
    if (a.equals(b) && pal.length < best.length) best = pal;
  }
  return { buf: best, meta };
}
function backup(f) {
  const bk = path.join(BACKUP, rel(f));
  if (!fs.existsSync(bk)) { fs.mkdirSync(path.dirname(bk), { recursive: true }); fs.copyFileSync(f, bk); }
}

const rows = [];
let totBefore = 0, totAfter = 0;
function row(r) { rows.push(r); totBefore += r.before; totAfter += r.after; }

async function main() {
  if (flag('--hub-bg')) return hubBg();
  const files = walk(ASSETS).filter((f) => f.endsWith('.png')).sort();
  for (const f of files) {
    const r = rel(f);
    if (ONLY && r !== ONLY) continue;
    const m = MANIFEST[r];
    const meta = await sharp(f).metadata();
    const before = fs.statSync(f).size;
    const base = { file: r, before, w: meta.width, h: meta.height };
    let plan = null;

    if (ONLY && SCALE) {
      const [nw, nh] = gridDims(meta.width, meta.height, m?.cols || 1, m?.rows || 1, SCALE);
      plan = { nw, nh, why: `explicit --scale ${SCALE}` };
    } else if (m && m.mode === 'safe') {
      const s = autoScale(meta.width, meta.height, m);
      const [nw, nh] = gridDims(meta.width, meta.height, m.cols, m.rows, s);
      if (nw < meta.width * 0.97) plan = { nw, nh, why: `safe: ${m.ref}` };
    }
    const unsafeNote = m && m.mode === 'unsafe' ? `UNSAFE to resize${m.rec ? ` (rec scale ${m.rec})` : ''}: ${m.why}` : '';

    if (plan) {
      const sx = plan.nw / meta.width, sy = plan.nh / meta.height;
      const eff = `x${sx.toFixed(4)} y${sy.toFixed(4)}` + (m ? ` frame ${(meta.width / m.cols).toFixed(2)}x${(meta.height / m.rows).toFixed(2)} -> ${plan.nw / m.cols}x${plan.nh / m.rows}` : '');
      if (plan.nw > MAX_TEX || plan.nh > MAX_TEX) console.warn(`warn: ${r} exceeds ${MAX_TEX}px`);
      if (DRY) {
        row({ ...base, after: before, status: `would resize -> ${plan.nw}x${plan.nh} (${eff})`, note: plan.why, nw: plan.nw, nh: plan.nh });
        continue;
      }
      const buf = await sharp(f).resize(plan.nw, plan.nh, { kernel: 'lanczos3', fit: 'fill' }).png({ compressionLevel: 9, adaptiveFiltering: true }).toBuffer();
      if (buf.length >= before && !(ONLY && SCALE)) { row({ ...base, after: before, status: 'resize not smaller, kept', note: '' }); continue; }
      backup(f);
      fs.writeFileSync(f, buf);
      row({ ...base, after: buf.length, status: `RESIZED ${plan.nw}x${plan.nh} (${eff})`, note: plan.why, nw: plan.nw, nh: plan.nh });
      continue;
    }

    // lossless pass
    const { buf } = await repack(f);
    if (buf.length <= before * 0.97) {
      if (DRY) { row({ ...base, after: buf.length, status: 'would repack losslessly', note: unsafeNote }); continue; }
      backup(f);
      fs.writeFileSync(f, buf);
      row({ ...base, after: buf.length, status: 'repacked (lossless)', note: unsafeNote });
    } else {
      row({ ...base, after: before, status: unsafeNote ? 'UNSAFE-untouched' : 'unchanged', note: unsafeNote });
    }
  }
  report();
}

async function hubBg() {
  // bio_bg.png has transparency (islands float on the page's cream background), so JPEG is out; lossy WebP with alpha.
  const src = path.join(ASSETS, 'background', 'bio_bg.png');
  const dst = path.join(ASSETS, 'background', 'bio_bg.webp');
  const q = parseInt(opt('--q', '84'), 10);
  const meta = await sharp(src).metadata();
  const buf = await sharp(src).webp({ quality: q, alphaQuality: 92, effort: 6, smartSubsample: true }).toBuffer();
  console.log(`bio_bg.png ${kb(fs.statSync(src).size)} ${meta.width}x${meta.height} -> bio_bg.webp ${kb(buf.length)} q${q} (same dimensions, decoded ${mb(meta.width, meta.height)} MB)`);
  if (DRY) return;
  fs.writeFileSync(dst, buf);
  console.log('wrote', dst, '- original NOT removed; move it with find-unreferenced.mjs once index.html points at the .webp');
}

function report() {
  console.log((DRY ? '[DRY RUN] ' : '') + 'image results (decoded = w*h*4 bytes, what the GPU/decoder holds):');
  for (const r of rows) {
    const nd = r.nw ? ` -> ${r.nw}x${r.nh}` : '';
    const dec = r.nw ? ` | decoded ${mb(r.w, r.h)} -> ${mb(r.nw, r.nh)} MB` : ` | decoded ${mb(r.w, r.h)} MB`;
    console.log(`${r.file.padEnd(42)} ${String(r.w).padStart(4)}x${String(r.h).padEnd(4)}${nd.padEnd(13)} ${kb(r.before).padStart(6)} -> ${kb(r.after).padStart(6)} ${r.status}${dec}${r.note ? '\n' + ' '.repeat(43) + 'note: ' + r.note : ''}`);
  }
  console.log(`\ntotal PNG bytes ${(totBefore / 1048576).toFixed(2)} MB -> ${(totAfter / 1048576).toFixed(2)} MB`);
  if (!DRY) console.log('originals backed up to', BACKUP);
}

await main();
