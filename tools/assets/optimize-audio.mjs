#!/usr/bin/env node
/*
  optimize-audio.mjs - shrink the game's mp3s without renaming anything.

  Usage (from anywhere):
    node tools/assets/optimize-audio.mjs --dry                 # plan only, writes nothing
    node tools/assets/optimize-audio.mjs --backup <dir>        # real run, originals copied to <dir>/<same relative path>
    node tools/assets/optimize-audio.mjs --only stage04/stage_4.mp3 --backup <dir>

  Needs ffmpeg + ffprobe on PATH. No npm dependencies.

  What it does, per file (see RULES below):
    * re-encodes to a fixed CBR bitrate with libmp3lame (same file name, same extension),
    * mono for narration and for loops that are effectively mono (mid is >= 10 dB louder than side),
    * applies a SMALL, clamped gain to land near a per-class loudness target (gain only, no
      compression) and a transparent peak limiter so a lossy re-encode cannot clip,
    * keeps the Xing/LAME header ffmpeg writes (it carries encoder delay/padding, which is what
      lets Chrome / Android WebView loop and play without an added gap),
    * verifies decoded duration is within +-30 ms of the original, otherwise keeps the original.

  Idempotent: a file that is already at or below the target bitrate / channel count is skipped
  (never re-encoded twice, so no generation loss).

  Loudness policy (NOT a blanket -16 LUFS): the stages set playback volumes in code per clip class,
  so classes keep their relative balance and only drift by a few dB:
    narration  -> -16 LUFS   (they were -15.2 .. -20.8, i.e. already clustered here; evens out buzz)
    stage loops -> -14 LUFS  (they were -10.4 .. -15.2, +-6 dB clamp; gives encoder headroom)
    intro bed  -> -14 LUFS
    stingers   -> -16 LUFS
*/
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const AUDIO = path.join(REPO, 'stages', 'assets', 'audio');

const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const opt = (n, d) => (args.includes(n) ? args[args.indexOf(n) + 1] : d);
const DRY = flag('--dry');
const ONLY = opt('--only', null);
const BACKUP = path.resolve(opt('--backup', path.join(os.tmpdir(), 'gog-orig-audio-backup')));
const MAX_DRIFT_S = 0.03;
const MAX_GAIN_DB = 6;
const MAX_LOOP_BOOST_DB = 1.5;
const SIDE_DB_FOR_MONO = 10; // mid - side (dB) needed before a loop is folded to mono

// channels: 'auto' = mono if the loop is nearly mono, 1 = force mono, 2 = keep stereo
const RULES = [
  { re: /_(intro|outro)_lines\.mp3$/, cls: 'narration', kbps: 64, channels: 1, lufs: -16 },
  { re: /(^|\/)intro_bgm\.mp3$/, cls: 'intro-bed', kbps: 96, channels: 'auto', lufs: -14 },
  { re: /(^|\/)stage04\/stage_4\.mp3$/, cls: 'stage-loop', kbps: 112, channels: 'auto', lufs: -14 },
  { re: /(^|\/)stage02\/stage_2\.mp3$/, cls: 'stage-loop', kbps: 112, channels: 'auto', lufs: -14 },
  { re: /(^|\/)stage0[35]\/stage_[35]\.mp3$/, cls: 'stage-loop', kbps: 96, channels: 'auto', lufs: -14 },
  { re: /(^|\/)stage01\/underwater\.mp3$/, cls: 'stage-loop', kbps: 96, channels: 'auto', lufs: -14 },
  { re: /(^|\/)(winning|failed)\.mp3$/, cls: 'stinger', kbps: 96, channels: 'auto', lufs: -16 },
  // stage01/bombinsound.mp3: SFX already ~113 kbps VBR, deliberately left alone (no rule).
];

const run = (cmd, a, o = {}) => spawnSync(cmd, a, { encoding: 'utf8', maxBuffer: 1 << 28, ...o });

function walk(d) {
  return fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
}
function probe(f) {
  const r = run('ffprobe', ['-v', 'error', '-select_streams', 'a:0', '-show_entries', 'stream=channels,sample_rate,bit_rate:format=duration,bit_rate', '-of', 'json', f]);
  const j = JSON.parse(r.stdout);
  const s = j.streams[0];
  return {
    channels: +s.channels,
    rate: +s.sample_rate,
    kbps: Math.round(+(s.bit_rate || j.format.bit_rate) / 1000),
    dur: +j.format.duration,
    bytes: fs.statSync(f).size,
  };
}
function loudness(f) {
  const r = run('ffmpeg', ['-hide_banner', '-nostats', '-i', f, '-af', 'loudnorm=I=-16:TP=-1.5:LRA=20:print_format=json', '-f', 'null', '-']);
  const m = /\{[\s\S]*"target_offset"[\s\S]*?\}/.exec(r.stderr);
  const j = JSON.parse(m[0]);
  return { i: +j.input_i, tp: +j.input_tp };
}
function meanDb(f, pan) {
  const r = run('ffmpeg', ['-hide_banner', '-nostats', '-i', f, '-af', `pan=mono|c0=${pan},volumedetect`, '-f', 'null', '-']);
  const m = /mean_volume: (-?[\d.]+)/.exec(r.stderr);
  return m ? +m[1] : -91;
}
function decodedSamples(f) {
  const r = spawnSync('ffmpeg', ['-v', 'error', '-i', f, '-f', 's16le', '-ac', '1', '-ar', '44100', '-'], { maxBuffer: 1 << 28 });
  return r.stdout.length / 2;
}
const fmt = (n, w) => String(n).padStart(w);
const kb = (b) => (b / 1024).toFixed(0) + 'K';

const files = walk(AUDIO).filter((f) => f.endsWith('.mp3')).sort();
let before = 0, after = 0;
const rows = [];
for (const f of files) {
  const rel = path.relative(AUDIO, f).split(path.sep).join('/');
  if (ONLY && rel !== ONLY) continue;
  const rule = RULES.find((r) => r.re.test(rel));
  const p = probe(f);
  before += p.bytes;
  if (!rule) { after += p.bytes; rows.push(`${rel.padEnd(34)} untouched (no rule)  ${kb(p.bytes)}`); continue; }

  let ch = rule.channels;
  let stereoNote = '';
  if (ch === 'auto') {
    if (p.channels === 1) ch = 1;
    else {
      const mid = meanDb(f, '0.5*c0+0.5*c1'), side = meanDb(f, '0.5*c0-0.5*c1');
      ch = mid - side >= SIDE_DB_FOR_MONO ? 1 : 2;
      stereoNote = `mid-side ${(mid - side).toFixed(1)}dB`;
    }
  }
  ch = Math.min(ch, p.channels);
  // idempotency: already at/below target bitrate and channel count -> skip
  if (p.kbps <= rule.kbps * 1.06 && p.channels <= ch) {
    after += p.bytes;
    rows.push(`${rel.padEnd(34)} skip (already <= ${rule.kbps}k, ${p.channels}ch)  ${kb(p.bytes)}`);
    continue;
  }
  const L = loudness(f);
  const maxUp = rule.cls === 'stage-loop' ? MAX_LOOP_BOOST_DB : MAX_GAIN_DB; // never make a loop much louder than it was
  const gain = Math.max(-MAX_GAIN_DB, Math.min(maxUp, rule.lufs - L.i));
  const needsLimiter = L.tp + gain > -1.5;
  const filters = [`volume=${gain.toFixed(2)}dB`];
  if (needsLimiter) filters.push('alimiter=limit=0.84:attack=5:release=60:level=disabled');
  const plan = `${rule.cls.padEnd(10)} ${p.channels}ch ${fmt(p.kbps, 3)}k -> ${ch}ch ${rule.kbps}k  I ${L.i.toFixed(1)} -> ${(L.i + gain).toFixed(1)} (gain ${gain >= 0 ? '+' : ''}${gain.toFixed(1)}dB${needsLimiter ? ', limiter' : ''}) ${stereoNote}`;
  if (DRY) { rows.push(`${rel.padEnd(34)} ${plan}  ${kb(p.bytes)} ${p.dur.toFixed(3)}s`); after += p.bytes; continue; }

  const tmp = path.join(os.tmpdir(), `gog-audio-${process.pid}-${path.basename(f)}`);
  const enc = run('ffmpeg', ['-hide_banner', '-v', 'error', '-y', '-i', f, '-map', '0:a:0', '-map_metadata', '-1', '-af', filters.join(','), '-ac', String(ch), '-ar', String(p.rate), '-c:a', 'libmp3lame', '-b:a', `${rule.kbps}k`, '-write_xing', '1', '-id3v2_version', '0', tmp]);
  if (enc.status !== 0 || !fs.existsSync(tmp)) { rows.push(`${rel.padEnd(34)} ENCODE FAILED, original kept: ${enc.stderr}`); after += p.bytes; continue; }
  const q = probe(tmp);
  const drift = Math.abs(q.dur - p.dur);
  const sOld = decodedSamples(f), sNew = decodedSamples(tmp);
  const sDriftMs = Math.abs(sNew - sOld) / 44.1;
  if (drift > MAX_DRIFT_S || sDriftMs > 30 || q.bytes >= p.bytes) {
    rows.push(`${rel.padEnd(34)} REJECTED (dur drift ${(drift * 1000).toFixed(1)}ms, decoded drift ${sDriftMs.toFixed(1)}ms, size ${kb(q.bytes)}), original kept`);
    after += p.bytes; fs.unlinkSync(tmp); continue;
  }
  const bk = path.join(BACKUP, rel);
  if (!fs.existsSync(bk)) { fs.mkdirSync(path.dirname(bk), { recursive: true }); fs.copyFileSync(f, bk); }
  fs.copyFileSync(tmp, f); fs.unlinkSync(tmp);
  const L2 = loudness(f);
  after += q.bytes;
  rows.push(`${rel.padEnd(34)} ${plan}\n${' '.repeat(35)}${kb(p.bytes)} -> ${kb(q.bytes)}  dur ${p.dur.toFixed(3)}s -> ${q.dur.toFixed(3)}s (drift ${(drift * 1000).toFixed(1)}ms, decoded ${sDriftMs.toFixed(1)}ms)  out I ${L2.i.toFixed(1)} TP ${L2.tp.toFixed(1)}`);
}
console.log((DRY ? '[DRY RUN] ' : '') + 'audio plan/results:\n' + rows.join('\n'));
console.log(`\ntotal ${(before / 1048576).toFixed(2)} MB -> ${(after / 1048576).toFixed(2)} MB` + (DRY ? ' (dry: unchanged sizes shown)' : ''));
if (!DRY) console.log('originals backed up to', BACKUP);
