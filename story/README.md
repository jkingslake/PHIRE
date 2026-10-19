# The crevasses that shouldn't be there

A scroll-driven article and a short vertical video about the relic crevasses of Henry Ice Rise and why PHIRE will
drill into them. Both come from the same page: scrolling drives a timeline in the article, and
`scripts/render_video.mjs` steps the same timeline frame by frame to make the video.

## Run it

```bash
cd story
python3 -m http.server 8765
```

Then open http://localhost:8765. Add `?t=60` to hold the story at 60 seconds into the timeline, or `?video` to
see the video layout (best at a 540 × 960 window).

## Make the video

```bash
cd story
npm install
npm run video
```

This writes `video/phire_buried_crevasses.mp4` (1080 × 1920, 30 fps, about 100 s, no sound). It uses the Chrome
installed on this machine through `playwright-core` and the ffmpeg binary from `ffmpeg-static`, so nothing is
downloaded at render time. Useful options:

```bash
node scripts/render_video.mjs --from 55 --to 75 --fps 10 --out video/preview.mp4
node scripts/render_video.mjs --stills 5,25,60 --out video/stills
```

## Edit it

- **Words**: `js/beats.js`. Each beat has a video duration, a short on-screen caption for the video, and the
  article text. A beat with `video: false` appears only in the article.
- **What happens when**: `Story.state()` in `js/main.js`, as fractions of each beat (`at("model", 0.18)` is 18 %
  of the way through the model beat). Camera views and moves are in `buildCamera()`.
- **Map drawing**: `js/map.js` (canvas, in EPSG:3031 kilometres). Radargram viewer, temperature chart and HUD:
  `js/panels.js`. 3-D block: `js/block3d.js` (three.js, vendored in `vendor/`).

## Rebuild the data

The files in `assets/` are made by `scripts/prepare_data.py` from data that is not in the repository: Quantarctica
(LIMA, MOA, MEaSUREs), the DELORES radar files and processed radargrams, the WorldView-1 scene, and the PISM output
of Kingslake et al. (2018) (doi:10.5880/PIK.2018.008, CC BY 4.0; unzip it and pass the `datapub` folder). Paths
are set at the top of the script.

```bash
python story/scripts/prepare_data.py                         # everything except pism
python story/scripts/prepare_data.py pism pism=/path/to/datapub
python story/scripts/prepare_data.py radar radargrams        # selected steps
```

What each asset holds:

| asset | from |
|---|---|
| `base_*.webp` | LIMA true-colour mosaic (MOA fills its pole hole), one colour grade for every layer |
| `wv_drill.webp`, `wv_crev.webp` | WorldView-1, 28 Feb 2025, around the drill site and the crevasses at the northern grounding line |
| `speed_weddell.webp` | MEaSUREs ice speed, 10 to 800 m/yr |
| `radar_tracks.json` | every DELORES line on Henry Ice Rise in both seasons, in the order driven (times from each line's `EVENTS.CSV`) |
| `rg_line3*.webp` | HE Line 3 (4–5 Jan 2014, unmigrated), the season-1 line where the features first showed up |
| `rg_fl5*.webp` | HEnorth FL5 (30 Dec 2014, migrated), the line through the drill site, as in `HIR_radargram_plotting.ipynb` |
| `vectors.json` | grounding line, labels, drill site, where crevasses begin along each line, surface-texture lines |
| `pism.json` | grounded-ice outlines every 200 years from 20 ka, PISM reference run 2205 |
| `temperature.json` | profiles after grounding from `vertical-temperature-after-grounding.ipynb` |
| `block*.{json,webp}` | the WorldView strip along FL5 that covers the top of the 3-D block |

## Check before publishing

- The WorldView-1 image came through the Polar Geospatial Center; check that its licence allows the image on a
  public web page and in a video.
- The temperature curves use the placeholder site values of the vertical-temperature notebook.
- In the PISM run (15 km grid) only part of Henry Ice Rise regrounds; the text says so.
