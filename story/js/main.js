// Orchestration: one timeline, two drivers.
//   Article mode: the scroll position is mapped onto the timeline, beat by beat.
//   Video mode (?video): window.__story.renderAt(t) draws the frame at time t, for render_video.mjs.
// The version (full or short) comes from ?v= or from <body data-version>.

import { VERSIONS, ORDER, TITLE, SUBTITLE } from "./beats.js";
import { MapView } from "./map.js";
import { Radargram, TempChart, Hud } from "./panels.js";
import { Block3D } from "./block3d.js";
import { clamp, lerp, smooth, ramp, easeInOut, interpolateZoom, loadJSON, loadImage } from "./util.js";

const params = new URLSearchParams(location.search);
const VIDEO = params.has("video");
const VERSION = params.get("v") || document.body.dataset.version || "full";
document.body.classList.toggle("video", VIDEO);
document.body.dataset.version = VERSION;
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

// ------------------------------------------------------------------ timeline

// Every beat in ORDER gets a slot; beats this version leaves out have zero length.
const source = Object.fromEntries((VERSIONS[VERSION] || VERSIONS.full).map((b) => [b.id, b]));
const beats = ORDER.map((id) => {
  const b = source[id];
  if (!b) return { id, dur: 0, caption: "", html: "" };
  return { ...b, dur: VIDEO && b.video === false ? 0 : b.dur };
});
let acc = 0;
const B = {};
for (const b of beats) {
  B[b.id] = { t0: acc, dur: b.dur };
  acc += b.dur;
}
const T_END = acc;
const has = (id) => B[id].dur > 0;
const at = (id, f) => B[id].t0 + f * B[id].dur;
const win = (t, a0, a1, b0, b1) => smooth(ramp(t, a0, a1)) * (1 - smooth(ramp(t, b0, b1)));
const between = (t, a, b) => (b > a ? clamp((t - a) / (b - a)) : t >= a ? 1 : 0);

const titleHtml = (extra = "") => `<h1>${TITLE}</h1><p class="subtitle">${SUBTITLE}</p>${extra}`;

// ------------------------------------------------------------------ data

async function load() {
  const [manifest, vectors, tracks, pism, rg, temperature, block] = await Promise.all(
    ["manifest", "vectors", "radar_tracks", "pism", "radargrams", "temperature", "block"].map((n) => loadJSON(`assets/${n}.json`))
  );
  const layers = await Promise.all(manifest.basemaps.map(async (L) => ({ ...L, img: await loadImage(L.src) })));
  const speed = { ...manifest.speed, img: await loadImage(manifest.speed.src) };
  const [faceImg, topImg] = await Promise.all([loadImage(rg.fl5.face.src), loadImage(block.top)]);
  // preload the radargram images so the panel never shows a half-loaded frame
  await Promise.all(["ridge", "fl5"].flatMap((k) => [loadImage(rg[k].full.src), loadImage(rg[k].zoom.src)]));
  await document.fonts.ready;
  return { manifest, vectors, tracks, pism, rg, temperature, block, layers, speed, faceImg, topImg };
}

// A view [cx, cy, span] that frames part of a line (flat [x0, y0, x1, y1, ...] in km).
function fitView(line, dmin = -Infinity, margin = 1.15) {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (let i = 0; i < line.d.length; i++) {
    if (line.d[i] < dmin) continue;
    const x = line.xy[2 * i], y = line.xy[2 * i + 1];
    x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
  }
  return [(x0 + x1) / 2, (y0 + y1) / 2, Math.max(x1 - x0, y1 - y0) * margin];
}

// ------------------------------------------------------------------ app

class Story {
  constructor(data) {
    this.d = data;
    this.stage = document.getElementById("stage");
    this.map = new MapView(document.getElementById("map"), { ...data, uiScale: 1 });
    this.block = new Block3D(document.getElementById("block"), document.getElementById("labels3d"), {
      rg: data.rg.fl5,
      block: data.block,
      faceImg: data.faceImg,
      topImg: data.topImg,
      northIn3D: [data.block.u[1], 0, -data.block.u[0]],
    });
    const overlay = document.getElementById("overlay");
    this.rg = new Radargram(overlay, data.rg);
    this.chart = new TempChart(overlay, data.temperature);
    this.hud = new Hud(overlay);
    this.hud.setTitle(titleHtml());
    // season 1 is drawn up to the start of the line along the ridge, which is drawn with its radargram
    const ridge = this.map.seasons["2013/14"].find((l) => l.name === "HENorthAlongRidge_1");
    this.R0 = ridge.start;
    this.R1 = ridge.start + ridge.len;
    this.S1 = this.map.seasonLen["2013/14"];
    this.S2 = this.map.seasonLen["2014/15"];
    this.buildCamera();
    this.resize();
    addEventListener("resize", () => {
      this.resize();
      this.draw(this.t ?? 0);
    });
  }

  layout() {
    if (VIDEO) return "video";
    return innerWidth >= 900 ? "desktop" : "mobile";
  }

  resize() {
    document.body.dataset.layout = this.layout();
    const w = this.stage.clientWidth, h = this.stage.clientHeight;
    const dpr = VIDEO ? devicePixelRatio : Math.min(2, devicePixelRatio || 1);
    this.w = w;
    this.h = h;
    this.map.resize(w, h, dpr);
    this.block.resize(w, h, dpr);
  }

  buildCamera() {
    const dr = this.d.vectors.drillsite;
    const ridgeLine = this.d.rg.ridge.line;
    const V = {
      antWide: [60, 80, 7800],
      ant: [-250, 200, 5000],
      wedd: [-1030, 470, 1450],
      hir: [-922, 506, 215],
      hirS1: [-932, 516, 185],
      ridge: fitView(ridgeLine, -Infinity, 1.2),
      corner: fitView(ridgeLine, this.d.rg.ridge.zoom.d[0], 1.9),
      hen: [-955, 545.5, 34],
      fl5: [-955.6, 547.6, 20],
      pattern: [-943, 530, 78],
      crevWide: [-952, 549.5, 12],
      crev: [-950.8, 551.8, 1.5],
      hirHyp: [-930, 516, 170],
      wais: [-950, 330, 2000],
      drill: [dr[0], dr[1], 2.6],
    };
    const K = [];
    const key = (t, v) => K.push([t, v]);
    key(0, V.antWide);
    key(at("intro", 1), V.ant);
    if (has("icesheet")) {
      key(at("icesheet", 0.25), V.ant);
      key(at("icesheet", 0.95), V.wedd);
      key(at("hir", 0.05), V.wedd);
    } else {
      key(at("hir", 0.05), V.ant);
    }
    key(at("hir", 0.75), V.hir);
    key(at("season1", 0), V.hir);
    key(at("season1", 1), V.hirS1);
    // follow the line along the ridge as it is driven, then close in on the corner
    key(at("discovery", 0), V.hirS1);
    key(at("discovery", 0.14), V.ridge);
    key(at("discovery", 0.6), V.ridge);
    key(at("discovery", 0.88), V.corner);
    key(at("mystery", 1), V.corner);
    // pull back for the rest of season 1, then into the 2014/15 grid
    key(at("season2", 0.03), V.corner);
    key(at("season2", 0.2), V.hir);
    key(at("season2", 0.36), V.hir);
    key(at("season2", 0.58), V.hen);
    key(at("fl5", 0), V.hen);
    key(at("fl5", 0.3), V.fl5);
    let prev = V.fl5;
    if (has("pattern")) {
      key(at("pattern", 0), prev);
      key(at("pattern", 0.35), (prev = V.pattern));
    }
    if (has("rumples")) {
      key(at("rumples", 0.05), prev);
      key(at("rumples", 0.25), V.crevWide);
      key(at("rumples", 0.6), (prev = V.crev));
    }
    if (has("hypothesis")) {
      key(at("hypothesis", 0), prev);
      key(at("hypothesis", 0.55), (prev = V.hirHyp));
    }
    if (has("model")) {
      key(at("model", 0), prev);
      key(at("model", 0.17), V.wais);
      key(at("stakes", 1), (prev = V.wais));
    }
    key(at("drillsite", 0.02), prev);
    key(at("drillsite", 0.8), V.drill);
    key(at("end", 0.12), V.drill);
    key(at("end", 0.85), V.ant);
    this.camKeys = K.map(([t, v], i) => ({ t, v, next: K[i + 1] ? interpolateZoom(v, K[i + 1][1]) : null }));
  }

  camera(t) {
    const K = this.camKeys;
    if (t <= K[0].t) return K[0].v;
    for (let i = 0; i < K.length - 1; i++) {
      if (t < K[i + 1].t) return K[i].next(easeInOut(between(t, K[i].t, K[i + 1].t)));
    }
    return K[K.length - 1].v;
  }

  insets(panelA, chartA) {
    const { w, h } = this;
    const lay = this.layout();
    const pa = Math.max(panelA, chartA);
    if (lay === "video") return { l: 0, r: 0, t: h * 0.1, b: lerp(h * 0.26, h * 0.52, pa) };
    if (lay === "desktop") {
      const col = Math.min(480, w * 0.4) + 32;
      return { l: col, r: 0, t: 0, b: lerp(0, h * 0.46, pa) };
    }
    // mobile: the stage is the top part of the screen and the text scrolls beneath it
    return { l: 0, r: 0, t: 36, b: lerp(0, h * 0.52, pa) };
  }

  state(t) {
    const S = {};
    const map = { time: t };
    S.map = map;

    // --- title cards
    const introFade = source.intro && source.intro.caption ? [0.42, 0.58] : [0.62, 0.85];
    const titleIntro = VIDEO ? win(t, -1, 0, at("intro", introFade[0]), at("intro", introFade[1])) : 0;
    const titleEnd = win(t, at("end", 0.5), at("end", 0.7), T_END + 10, T_END + 11);
    S.titleAlpha = Math.max(titleIntro, titleEnd);

    // --- map visibility, dimming, overlays
    const toBlock = smooth(ramp(t, at("block", 0.0), at("block", 0.16)));
    const backFromBlock = smooth(ramp(t, at("end", 0.0), at("end", 0.15)));
    map.alpha = clamp(1 - toBlock + backFromBlock);
    const modelA = has("model") ? win(t, at("model", 0.04), at("model", 0.17), at("drillsite", 0.04), at("drillsite", 0.3)) : 0;
    map.dim = Math.max(0.72 * modelA, 0.35 * S.titleAlpha);
    map.speed = has("icesheet") ? win(t, at("hir", 0.15), at("hir", 0.45), at("season1", 0.0), at("season1", 0.2)) : 0;
    map.gl = has("icesheet") ? smooth(ramp(t, at("icesheet", 0.05), at("icesheet", 0.3))) : smooth(ramp(t, at("hir", 0.3), at("hir", 0.6)));

    // radar tracks: season 1 up to the ridge line, the ridge line with its radargram, a pause at the corner,
    // the rest of season 1, then season 2
    const ridgeP = between(t, at("discovery", 0.12), at("discovery", 0.58));
    let s1len;
    if (t < at("discovery", 0)) s1len = lerp(0, this.R0, between(t, at("season1", 0.05), at("season1", 0.95)));
    else if (t < at("season2", 0)) s1len = lerp(this.R0, this.R1, ridgeP);
    else s1len = lerp(this.R1, this.S1, between(t, at("season2", 0.04), at("season2", 0.34)));
    const s2len = lerp(0, this.S2, between(t, at("season2", 0.4), at("season2", 0.97)));
    const radarAway = has("model") ? 1 - win(t, at("model", 0.0), at("model", 0.1), at("drillsite", 0.35), at("drillsite", 0.6)) : 1;
    const s1on = smooth(ramp(t, at("season1", 0.0), at("season1", 0.06)));
    const s1dim = lerp(1, 0.5, smooth(ramp(t, at("season2", 0.36), at("season2", 0.44))));
    const s1moving = (s1len > 0 && s1len < this.R0 && t < at("discovery", 0)) || (s1len > this.R1 && s1len < this.S1);
    map.s1 = { len: s1len, alpha: s1on * s1dim * radarAway, head: s1moving };
    map.s2 = { len: s2len, alpha: radarAway, head: s2len > 0 && s2len < this.S2 };

    const ridgeA = win(t, at("discovery", 0.05), at("discovery", 0.12), at("season2", 0.05), at("season2", 0.2));
    const fl5A = win(t, at("fl5", 0.05), at("fl5", 0.12), at("block", 0.1), at("block", 0.25)) * (1 - modelA);
    if (ridgeA > 0.001) map.hl = { line: "ridge", progress: ridgeP, alpha: ridgeA, label: "9 January 2014" };
    else map.hl = { line: "fl5", progress: between(t, at("fl5", 0.1), at("fl5", 0.45)), alpha: fl5A, label: "FL5" };

    map.crev = has("pattern") ? win(t, at("pattern", 0.15), at("pattern", 0.45), at("rumples", 0.1), at("rumples", 0.3)) : 0;
    map.crevBox = has("rumples") ? win(t, at("rumples", 0.08), at("rumples", 0.2), at("rumples", 0.45), at("rumples", 0.58)) : 0;
    const mt = lerp(-20000, -50, between(t, at("model", 0.18), at("model", 0.95)));
    map.model = { alpha: modelA, t: mt, min: smooth(ramp(mt, -10400, -10000)) };
    map.drill = Math.max(
      win(t, at("drillsite", 0.35), at("drillsite", 0.6), at("block", 0.05), at("block", 0.2)),
      win(t, at("end", 0.0), at("end", 0.1), at("end", 0.45), at("end", 0.65))
    );
    map.labels = (1 - S.titleAlpha) * (1 - 0.7 * modelA);
    map.pins = [{ xy: [-922, 506], text: "Henry Ice Rise", alpha: modelA, color: "#ffffff" }];
    map.scale = 1 - S.titleAlpha;
    map.cam = this.camera(t);

    // --- radargram panel
    const rg = { which: null, alpha: 0, reveal: 0, zoom: 0, box: 0, drill: 0, notes: 1 };
    if (t < at("season2", 0.5)) {
      Object.assign(rg, {
        which: "ridge",
        alpha: win(t, at("discovery", 0.06), at("discovery", 0.14), at("season2", 0.0), at("season2", 0.1)),
        reveal: ridgeP,
        zoom: easeInOut(between(t, at("discovery", 0.66), at("discovery", 0.9))),
        box: between(t, at("discovery", 0.56), at("discovery", 0.64)),
      });
    } else {
      Object.assign(rg, {
        which: "fl5",
        alpha: win(t, at("fl5", 0.04), at("fl5", 0.14), at("fl5", 0.9), at("fl5", 1.0)),
        reveal: between(t, at("fl5", 0.1), at("fl5", 0.45)),
        zoom: easeInOut(between(t, at("fl5", 0.5), at("fl5", 0.8))),
        box: between(t, at("fl5", 0.42), at("fl5", 0.5)),
      });
    }
    S.rg = rg;

    // --- temperature chart and the 3-D block
    const chartA = has("temperature") ? win(t, at("temperature", 0.0), at("temperature", 0.15), at("end", 0.0), at("end", 0.12)) : 0;
    S.chart = { alpha: chartA, age: 100 * Math.pow(50, easeInOut(between(t, at("temperature", 0.12), at("temperature", 0.92)))) };
    const insets = this.insets(rg.alpha, chartA);
    map.insets = insets;
    // the block fades in looking straight down, matching the map, holds, then tilts slowly to the side
    const camP =
      lerp(0, 1 / 3, easeInOut(between(t, at("block", 0.15), at("block", 0.47)))) +
      lerp(0, 1 / 3, easeInOut(between(t, at("block", 0.5), at("block", 1.0)))) +
      (has("temperature") ? lerp(0, 1 / 3, between(t, at("temperature", 0.0), at("end", 0.1))) : 0);
    S.block = {
      alpha: win(t, at("block", 0.0), at("block", 0.14), at("end", 0.0), at("end", 0.14)),
      cam: camP,
      drill: between(t, at("block", 0.44), at("block", 0.84)),
      labels: smooth(ramp(t, at("block", 0.32), at("block", 0.45))),
      insets,
    };

    // --- HUD
    const s1Phase = t < at("season2", 0.38);
    S.ticker = {
      alpha: win(t, at("season1", 0.02), at("season1", 0.1), at("fl5", 0.0), at("fl5", 0.1)),
      season: s1Phase ? "2013/14" : "2014/15",
      len: s1Phase ? s1len : s2len,
    };
    const P = this.d.pism;
    let k = 0;
    while (k < P.times.length - 1 && P.times[k + 1] <= mt) k++;
    S.clock = { alpha: modelA, t: mt, hirAfloat: P.hir_grounded_fraction[k] < 0.12 };
    const span = map.cam[2];
    S.legend = {
      gl: map.gl * map.alpha * (1 - modelA) * (1 - S.titleAlpha),
      glDash: modelA,
      model: modelA,
      modelFill: modelA,
      min: modelA * map.model.min,
      s1: map.s1.len > 0 && span < 400 ? map.s1.alpha * map.alpha : 0,
      s2: map.s2.len > 0 && span < 400 ? map.s2.alpha * map.alpha : 0,
      texture: map.crev,
      onset: map.crev,
      drill: map.drill * (1 - S.titleAlpha),
      speed: map.speed,
    };
    S.credit =
      map.alpha < 0.5
        ? "Radar: DELORES, HEnorth FL5 · surface image: WorldView-1, 28 Feb 2025 © Maxar"
        : span < 5
        ? "WorldView-1 image, 28 Feb 2025 © Maxar Technologies"
        : span < 700
        ? "Imagery: Landsat Image Mosaic of Antarctica (LIMA)"
        : "Imagery: LIMA and MODIS Mosaic of Antarctica";

    // --- video captions
    if (VIDEO) {
      const i = beats.findIndex((b) => b.dur > 0 && t >= B[b.id].t0 && t < B[b.id].t0 + b.dur);
      const b = beats[i >= 0 ? i : beats.length - 1];
      const bt = B[b.id];
      let text = b.caption, slot = i % 2;
      let a = win(t, bt.t0 + 0.05, bt.t0 + 0.45, bt.t0 + bt.dur - 0.3, bt.t0 + bt.dur);
      if (b.caption2) {
        const ts = at(b.id, b.split ?? 0.6);
        if (t < ts) a = win(t, bt.t0 + 0.05, bt.t0 + 0.45, ts - 0.35, ts);
        else [text, slot, a] = [b.caption2, 1 - slot, win(t, ts, ts + 0.4, bt.t0 + bt.dur - 0.3, bt.t0 + bt.dur)];
      }
      if (b.id === "intro") a = win(t, at("intro", 0.55), at("intro", 0.66), at("intro", 1) - 0.3, at("intro", 1));
      if (b.id === "end") a = win(t, at("end", 0.0), at("end", 0.1), at("end", 0.45), at("end", 0.55));
      if (b.id === "end" && t >= T_END) a = 0;
      S.caption = { text, alpha: text ? a : 0, slot };
    }
    return S;
  }

  draw(t) {
    this.t = t;
    const S = this.state(t);
    this.map.render(S.map);
    this.block.render({ ...S.block, mapScale: this.map.s / this.map.dpr });
    this.rg.update(S.rg);
    this.chart.update(S.chart);
    this.hud.update(S, this.map);
  }
}

// ------------------------------------------------------------------ article (scroll) driver

function buildArticle(story) {
  const steps = document.getElementById("steps");
  for (const b of beats) {
    if (!b.html || !b.dur) continue;
    const sec = document.createElement("section");
    sec.className = "step";
    sec.dataset.beat = b.id;
    sec.style.minHeight = `${Math.max(100, b.dur * 20)}vh`;
    sec.innerHTML = `<div class="card">${b.html}</div>`;
    steps.appendChild(sec);
  }
  const secs = [...steps.querySelectorAll(".step")];
  // the time is read where this line of the viewport meets the text (on phones, the top of the text area)
  const line = () => (story.layout() === "mobile" ? innerHeight * 0.56 + 14 : innerHeight * 0.72);
  let anchors = [];
  const measure = () => {
    const top = (s) => s.getBoundingClientRect().top + scrollY;
    anchors = [{ y: top(secs[0]) - innerHeight * 0.6, t: 0 }, ...secs.map((s) => ({ y: top(s), t: B[s.dataset.beat].t0 }))];
    const last = secs[secs.length - 1];
    anchors.push({ y: last.getBoundingClientRect().bottom + scrollY, t: T_END });
  };
  measure();
  addEventListener("resize", measure);
  const target = () => {
    const y = scrollY + line();
    if (y <= anchors[0].y) return 0;
    for (let i = 0; i < anchors.length - 1; i++) {
      if (y < anchors[i + 1].y) return lerp(anchors[i].t, anchors[i + 1].t, (y - anchors[i].y) / (anchors[i + 1].y - anchors[i].y));
    }
    return T_END;
  };
  // ?t=SECONDS (or __story.seek(SECONDS)) holds the story at one moment, for checking frames
  let frozen = params.has("t") ? +params.get("t") : null;
  window.__story.seek = (s) => (frozen = s);
  let t = frozen ?? target(), last = performance.now();
  const tick = (now) => {
    const goal = frozen ?? target();
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    t = reduceMotion || Math.abs(goal - t) < 0.002 ? goal : t + (goal - t) * (1 - Math.exp(-dt * 9));
    story.draw(t);
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

// ------------------------------------------------------------------ boot

const ready = load().then((data) => {
  const story = new Story(data);
  document.body.classList.add("loaded");
  if (VIDEO) {
    story.draw(0);
  } else {
    buildArticle(story);
  }
  return story;
});

ready.catch((err) => {
  console.error(err);
  const m = document.getElementById("loading");
  if (m) m.textContent = `Could not load the story data: ${err.message}`;
});

window.__story = {
  duration: T_END,
  version: VERSION,
  ready: ready.then(() => true),
  renderAt: async (t) => {
    const story = await ready;
    story.draw(t);
  },
};
