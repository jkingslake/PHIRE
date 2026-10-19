# PHIRE: the scroll story and videos

A scroll-driven article and vertical videos about the relic crevasses of Henry Ice Rise and why PHIRE will drill
through them to the bed. Each comes from the same page: scrolling drives a timeline in the article, and
`scripts/render_video.mjs` steps the same timeline frame by frame to make the video.

There are two versions:

- **Full** (`index.html`, about 100 s of video): the ice sheet and Henry Ice Rise, both radar seasons, where the
  crevasses lie, crevasses forming today, the PISM model of retreat and re-advance, the drill site, the hot-water
  borehole to the bed, and the temperature it will measure.
- **Short** (`short.html`, about 60 s): Henry Ice Rise, both radar seasons and the borehole to the bed.

## Run it

```bash
cd story
python3 -m http.server 8765
```

Then open http://localhost:8765 (or `/short.html`). Add `?t=60` to hold the story at 60 seconds into the timeline,
or `?video` to see the video layout (best at a 540 × 960 window; `?video&v=short` for the short version). On
phones the figures sit in the top half of the screen and the text scrolls beneath them.

## Make the video

```bash
cd story
npm install
npm run video
```

This writes `video/phire_full.mp4` and `video/phire_short.mp4` (1080 × 1920, 30 fps, no sound). It uses the
Chrome installed on this machine through `playwright-core` and the ffmpeg binary from `ffmpeg-static`, so nothing
is downloaded at render time. The full video takes about 35 minutes, mostly the software-rendered 3-D frames.
Useful options:

```bash
node scripts/render_video.mjs --version short
node scripts/render_video.mjs --from 55 --to 75 --fps 10 --out video/preview.mp4
node scripts/render_video.mjs --stills 5,25,60 --out video/stills
```

## Edit it

- **Words**: `js/beats.js`, one list of beats per version. Each beat has a video duration, a short on-screen
  caption for the video, and the article text. A beat with `video: false` appears only in the article. A version
  can leave beats out; the visuals of a missing beat take no time.
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
| `rg_ridge*.webp` | the line north-west along the ridge on 9 Jan 2014, the last day of season 1, which ended in the corner where the features first showed up (ReflexW export, unmigrated, re-hung from a smoothed GPS surface) |
| `rg_fl5*.webp` | HEnorth FL5 (30 Dec 2014, migrated), the line through the drill site, as in `HIR_radargram_plotting.ipynb`; `radargrams.json` also holds the bed at the drill site (410 m below sea level, 541 m below the surface) |
| `vectors.json` | grounding line, labels, drill site, where crevasses begin along each line, surface-texture lines |
| `pism.json` | grounded-ice outlines every 200 years from 20 ka, PISM reference run 2205 |
| `temperature.json` | profiles after grounding from `vertical-temperature-after-grounding.ipynb` |
| `block*.{json,webp}` | the WorldView strip along FL5 that covers the top of the 3-D block |

## Check before publishing

- The WorldView-1 image came through the Polar Geospatial Center; check that its licence allows the image on a
  public web page and in a video.
- The temperature curves use the placeholder site values of the vertical-temperature notebook.
- In the PISM run (15 km grid) only part of Henry Ice Rise regrounds; the text says so.
