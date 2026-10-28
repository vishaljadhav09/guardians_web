# Stage follow-ups for the asset diet (Wave 2)

`optimize-images.mjs` only resized sprites whose draw code is scale-independent. The files below
are **not resized yet** (only losslessly re-packed) because the stage hard-codes source pixel
rects or derives the on-screen size from the image size. A stage agent resizes the PNG and patches
the constants in the **same change**:

```
node tools/assets/optimize-images.mjs --only <path under stages/assets> --scale <n> --backup <dir>
```

The script prints the exact effective factors (`x.. y..`) and the new frame size; use those, not
the rounded `--scale`. Line numbers move (other agents edit the stages) - search for the quoted
constant instead. Every constant below is in source-pixel units unless noted.

Texture budget used: drawn size (logical px) x 2 (CSS upscale + hi-DPI cap 1.5), heroes x2.5, each
texture <= 2048 px.

## 1. sprites/stage01/sea_wed.png and sea_wed_2.png  (used by stages 1, 2, 3)

`--scale 0.6`  ->  793x766 -> 476x460 (x0.6003), 613x714 -> 368x429 (x0.6003).  decoded 4.0 MB -> 1.4 MB, file 1.1 MB -> ~0.3 MB.

The draw size is the natural size times a per-plant scale, so the plant scales must grow by 1/0.6003 = 1.666:

| file | constant | now | becomes |
| --- | --- | --- | --- |
| stage01-ocean.html `initSeaweed()` back layer | `scale: rand(0.08, 0.18)` | | `rand(0.133, 0.30)` |
| stage01-ocean.html `initSeaweed()` front layer | `scale: rand(0.18, 0.3)` | | `rand(0.30, 0.50)` |
| stage03-food.html `initSeaweed()` | `scale: rand(0.18, 0.28)` | | `rand(0.30, 0.467)` |

Nothing else changes: `drawSeaweed()` in stage 1 and 3 draws `drawImage(img, -img.width/2, -img.height)` after
`ctx.scale(sw.scale)` and stage 3's `rockOffset = img.height * sw.scale * 0.42` is already proportional.
Stage 2 (`seaW = cellW * 0.9`, `seaH = height/width * seaW`) is aspect-only: no change.
Both stages that load these files must ship in the same release.

## 2. sprites/stage03/bees-flying.png  (stages 2 and 3)

`--scale 0.5`  ->  1024x502 -> 512x252 (x0.5000 y0.5020).  4 cols x 2 rows; frame 256x251 -> 128x126.  decoded 2.0 -> 0.5 MB.

| file | constant | now | becomes |
| --- | --- | --- | --- |
| stage03-food.html | `BEES_SHEET_FRAME_WIDTH` / `BEES_SHEET_FRAME_HEIGHT` | 256 / 256 | 128 / 128 (row 2 starts at y=128, sheet is 252 tall, same clipping as before) |
| stage02-forest.html wildlife `bees-flying` draw | `var sw = 256; var sh = 256;` before `drawImage(beesFlyingImg, sx, sy, sw, sh, -28, -28, 56, 56)` | 256 / 256 | 128 / 128 (destination 56x56 unchanged) |

Drawn at 64 (stage 3) and 56 (stage 2) logical px, so a 128 frame is 2x / 2.3x.

## 3. sprites/stage05/flying_breezy_v1.png  (stage 5, Breezy flying; drawn 72 px tall = `player.radius * 3`)

`--scale 0.4`  ->  2172x471 -> 870x189 (x0.4006 y0.4013), frame ~174x189 (2.6x the 72 px draw height).  decoded 3.9 -> 0.6 MB.

Multiply every `sx`, `sw`, `cx` of the `breezyFly` frame table (`GOGSpriteSheet('flying_breezy_v1.png', 5, [...])`)
by 870/2172 and round to integers:

```
{ sx: 36,   sw: 334, cx: 203  }   ->  { sx: 14,  sw: 134, cx: 81  }
{ sx: 456,  sw: 360, cx: 636  }   ->  { sx: 183, sw: 144, cx: 255 }
{ sx: 898,  sw: 359, cx: 1078 }   ->  { sx: 360, sw: 144, cx: 432 }
{ sx: 1334, sw: 361, cx: 1514 }   ->  { sx: 534, sw: 145, cx: 606 }
{ sx: 1784, sw: 364, cx: 1966 }   ->  { sx: 715, sw: 146, cx: 788 }
```

`frameCount` (5) and `drawSpriteFrame()` need no change: `frameH` comes from `naturalHeight`, the destination
height is `displayH`.

## 4. sprites/stage05/happy-breezy.png  (stage 5, boosted Breezy; same 72 px draw height)

`--scale 0.3`  ->  1827x861 -> 549x259 (x0.3005 y0.3008), frame ~183x259 (3.6x draw height; 0.3 is the safe
choice because the crop widths differ per frame).  decoded 6.0 -> 0.5 MB.

Multiply `sx`, `sw`, `cx` of the `breezyHappy` table by 549/1827 (= 0.3005):

```
{ sx: 30,   sw: 600, cx: 330  }   ->  { sx: 9,   sw: 180, cx: 99  }
{ sx: 744,  sw: 489, cx: 989  }   ->  { sx: 224, sw: 147, cx: 297 }
{ sx: 1330, sw: 459, cx: 1560 }   ->  { sx: 400, sw: 138, cx: 469 }
```

## 5. Not worth resizing (documented so nobody re-investigates)

| file | why |
| --- | --- |
| stage01 `dolphine_swim.png` (640x512) | hard-coded 128x128 source rects, drawn at 180 (already upscaled) |
| stage01 `dolphine_attack.png` (1280x512) | hard-coded 256x256 rects, drawn at 180: only 1.4x headroom |
| stage03 `Boar_Run_with_shadow`, `Deer_Run_with_shadow`, `rabbit_run` | `CRITTER_DEFS` hard-codes `frameWidth/frameHeight` (231x180, 224x202, 220x212); frames are only 1.5x-2.2x the 150/125/100 px draw size |
| stage03 `flower_1.png`, `flower_2.png` | hard-coded `sw=152 sh=154` / `sw=153.2 sh=119`; ~1.2x headroom already |
| stage01 `assets/3.png` (1672x941) | parallax tile uses `tileW = img.width`, ~1:1 texel to logical px; a resize would need `tileW` pinned to 1672 and loses sharpness |
| stage02 `Deer_Run_with_shadow.png` usage | `var sw = 32; var sh = 32;` + `drawImage(deerRunImg, sx, 0, 32, 32, -40, -70, 80, 80)` crops a 32 px corner of a 224x202-frame sheet: looks like a latent bug; if the deer sheet is ever resized this rect must scale too |

Done already (safe, no code change needed): stage01 `turtle`, `purple_fish`, `fish_tangled`; stage02 `rock`;
stage04 `penny_idle`, `penny_running`, `penny_jump`, `penny_chicks_idel` (see tools/assets/optimize-images.mjs MANIFEST
for the reasoning and drawn sizes). If a stage later draws any of them larger than the sizes in the MANIFEST
(`dest`), raise the entry's `dest`/`headroom` and re-run from the backup original.
