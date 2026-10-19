// Orchestration: one timeline, two drivers.
//   Article mode: the scroll position is mapped onto the timeline, beat by beat.
//   Video mode (?video): window.__story.renderAt(t) draws the frame at time t, for render_video.mjs.

import { BEATS, TITLE, DEK } from "./beats.js";
import { MapView } from "./map.js";
import { Radargram, TempChart, Hud } from "./panels.js";
import { Block3D } from "./block3d.js";
import { clamp, lerp, smooth, ramp, easeInOut, interpolateZoom, loadJSON, loadImage } from "./util.js";

const params = new URLSearchParams(location.search);
const VIDEO = params.has("video");
document.body.classList.toggle("video", VIDEO);
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

// ------------------------------------------------------------------ timeline

const beats = BEATS.map((b) => ({ ...b, dur: VIDEO && b.video === false ? 0 : b.dur }));
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

// ------------------------------------------------------------------ data

async function load() {
  const [manifest, vectors, tracks, pism, rg, temperature, block] = await Promise.all(
    ["manifest", "vectors", "radar_tracks", "pism", "radargrams", "temperature", "block"].map((n) => loadJSON(`assets/${n}.json`))
  );
  const layers = await Promise.all(manifest.basemaps.map(async (L) => ({ ...L, img: await loadImage(L.src) })));
  const speed = { ...manifest.speed, img: await loadImage(manifest.speed.src) };
  const [faceImg, topImg] = await Promise.all([loadImage(rg.fl5.face.src), loadImage(block.top)]);
  // preload the radargram images so the panel never shows a half-loaded frame
  await Promise.all(["line3", "fl5"].flatMap((k) => [loadImage(rg[k].full.src), loadImage(rg[k].zoom.src)]));
  await document.fonts.ready;
  return { manifest, vectors, tracks, pism, rg, temperature, block, layers, speed, faceImg, topImg };
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
    this.rg = new Radargram(overlay, data.rg, null);
    this.chart = new TempChart(overlay, data.temperature);
    this.hud = new Hud(overlay);
    this.hud.setTitle(`<p class="kicker">PHIRE · Henry Ice Rise Expedition</p><h1>${TITLE}</h1>`);
    this.endTitle = `<p class="kicker">PHIRE · 2027–2029</p><h1>${TITLE}</h1>`;
    this.L3 = this.map.lenThrough("2013/14", "HE_Line3EastHalf_1");
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
    const w = this.stage.clientWidth, h = this.stage.clientHeight;
    const dpr = VIDEO ? devicePixelRatio : Math.min(2, devicePixelRatio || 1);
    this.w = w;
    this.h = h;
    this.map.resize(w, h, dpr);
    this.block.resize(w, h, dpr);
    document.body.dataset.layout = this.layout();
  }

  buildCamera() {
    const dr = this.d.vectors.drillsite;
    const V = {
      antWide: [60, 80, 7800],
      ant: [-250, 200, 5000],
      wedd: [-1030, 470, 1450],
      hir: [-922, 506, 215],
      hirS1: [-932, 516, 185],
      line3: [-939, 527.5, 50],
      hirMid: [-937, 522, 120],
      hen: [-955, 545.5, 34],
      fl5: [-955.6, 547.6, 20],
      pattern: [-943, 530, 78],
      crevWide: [-952, 549.5, 12],
      crev: [-950.8, 551.8, 1.5],
      hirHyp: [-930, 516, 170],
      wais: [-950, 330, 2000],
      drill: [dr[0], dr[1], 2.6],
    };
    const K = [
      [0, V.antWide],
      [at("intro", 1), V.ant],
      [at("icesheet", 0.25), V.ant],
      [at("icesheet", 0.95), V.wedd],
      [at("hir", 0.05), V.wedd],
      [at("hir", 0.7), V.hir],
      [at("season1", 0), V.hir],
      [at("season1", 1), V.hirS1],
      [at("discovery", 0), V.hirS1],
      [at("discovery", 0.3), V.line3],
      [at("mystery", 1), V.line3],
      [at("season2", 0.02), V.line3],
      [at("season2", 0.2), V.hirMid],
      [at("season2", 0.38), V.hirMid],
      [at("season2", 0.6), V.hen],
      [at("fl5", 0), V.hen],
      [at("fl5", 0.3), V.fl5],
      ...(has("pattern")
        ? [
            [at("pattern", 0), V.fl5],
            [at("pattern", 0.35), V.pattern],
            [at("rumples", 0.05), V.pattern],
          ]
        : [[at("rumples", 0.05), V.fl5]]),
      [at("rumples", 0.25), V.crevWide],
      [at("rumples", 0.6), V.crev],
      [at("hypothesis", 0), V.crev],
      [at("hypothesis", 0.55), V.hirHyp],
      [at("model", 0), V.hirHyp],
      [at("model", 0.17), V.wais],
      [at("stakes", 1), V.wais],
      [at("drillsite", 0.02), V.wais],
      [at("drillsite", 0.75), V.drill],
      [at("end", 0.12), V.drill],
      [at("end", 0.85), V.ant],
    ];
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
    return { l: 0, r: 0, t: lerp(0, h * 0.42, pa), b: h * 0.3 };
  }

  state(t) {
    const S = {};
    const map = { time: t };
    S.map = map;

    // --- title cards
    const titleIntro = VIDEO ? win(t, -1, 0.0001, at("intro", 0.42), at("intro", 0.58)) : 0;
    const titleEnd = win(t, at("end", 0.5), at("end", 0.7), T_END + 10, T_END + 11);
    S.titleAlpha = Math.max(titleIntro, titleEnd);
    S.titleHtml = titleEnd > titleIntro ? this.endTitle : null;

    // --- map visibility, dimming, overlays
    const toBlock = smooth(ramp(t, at("block", 0.05), at("block", 0.25)));
    const backFromBlock = smooth(ramp(t, at("end", 0.0), at("end", 0.15)));
    map.alpha = clamp(1 - toBlock + backFromBlock);
    const modelA = win(t, at("model", 0.04), at("model", 0.17), at("drillsite", 0.04), at("drillsite", 0.3));
    map.dim = Math.max(0.72 * modelA, 0.35 * S.titleAlpha);
    map.speed = win(t, at("hir", 0.15), at("hir", 0.45), at("season1", 0.0), at("season1", 0.2));
    map.gl = smooth(ramp(t, at("icesheet", 0.05), at("icesheet", 0.3)));

    // radar tracks: season 1 up to the end of Line 3, pause, the rest of season 1, then season 2
    const s1len =
      t < at("season2", 0)
        ? lerp(0, this.L3, between(t, at("season1", 0.05), at("season1", 0.92)))
        : lerp(this.L3, this.S1, between(t, at("season2", 0.02), at("season2", 0.36)));
    const s2len = lerp(0, this.S2, between(t, at("season2", 0.42), at("season2", 0.97)));
    const radarAway = 1 - win(t, at("model", 0.0), at("model", 0.1), at("drillsite", 0.35), at("drillsite", 0.6));
    const s1on = smooth(ramp(t, at("season1", 0.0), at("season1", 0.06)));
    const s1dim = lerp(1, 0.5, smooth(ramp(t, at("season2", 0.38), at("season2", 0.45))));
    map.s1 = { len: s1len, alpha: s1on * s1dim * radarAway, head: s1len > 0 && s1len < this.S1 && s1len !== this.L3 };
    map.s2 = { len: s2len, alpha: radarAway, head: s2len > 0 && s2len < this.S2 };

    const l3a = win(t, at("discovery", 0.05), at("discovery", 0.12), at("season2", 0.05), at("season2", 0.2));
    const fl5a = Math.max(
      win(t, at("fl5", 0.05), at("fl5", 0.12), at("model", 0.0), at("model", 0.1)),
      win(t, at("drillsite", 0.4), at("drillsite", 0.7), at("block", 0.1), at("block", 0.25))
    );
    if (l3a > 0.001) map.hl = { line: "line3", progress: between(t, at("discovery", 0.12), at("discovery", 0.55)), alpha: l3a, label: "Line 3" };
    else map.hl = { line: "fl5", progress: t < at("model", 0) ? between(t, at("fl5", 0.1), at("fl5", 0.45)) : 1, alpha: fl5a, label: "FL5" };

    map.crev = has("pattern") ? win(t, at("pattern", 0.15), at("pattern", 0.45), at("rumples", 0.1), at("rumples", 0.3)) : 0;
    map.crevBox = win(t, at("rumples", 0.08), at("rumples", 0.2), at("rumples", 0.45), at("rumples", 0.58));
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
        which: "line3",
        alpha: win(t, at("discovery", 0.06), at("discovery", 0.16), at("season2", 0.0), at("season2", 0.12)),
        reveal: map.hl.line === "line3" ? map.hl.progress : 1,
        zoom: easeInOut(between(t, at("discovery", 0.62), at("discovery", 0.92))),
        box: between(t, at("discovery", 0.5), at("discovery", 0.6)),
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
    const chartA = win(t, at("temperature", 0.0), at("temperature", 0.15), at("end", 0.0), at("end", 0.12));
    S.chart = { alpha: chartA, age: 100 * Math.pow(50, easeInOut(between(t, at("temperature", 0.12), at("temperature", 0.92)))) };
    const insets = this.insets(rg.alpha, chartA);
    map.insets = insets;
    const camP =
      t < at("temperature", 0)
        ? lerp(0, 1 / 3, easeInOut(between(t, at("block", 0.12), at("block", 0.5)))) + lerp(0, 1 / 3, easeInOut(between(t, at("block", 0.55), at("block", 0.98))))
        : 2 / 3 + lerp(0, 1 / 3, between(t, at("temperature", 0.0), at("end", 0.1)));
    S.block = {
      alpha: win(t, at("block", 0.06), at("block", 0.22), at("end", 0.0), at("end", 0.14)),
      cam: camP,
      drill: between(t, at("block", 0.42), at("block", 0.95)),
      labels: smooth(ramp(t, at("block", 0.3), at("block", 0.45))),
      insets,
    };

    // --- HUD
    const s1Phase = t < at("season2", 0.4);
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
      gl: map.gl * map.alpha * (1 - modelA) * (1 - S.titleAlpha) * (t > at("icesheet", 0.2) ? 1 : 0),
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
      let a = win(t, bt.t0 + 0.05, bt.t0 + 0.45, bt.t0 + bt.dur - 0.3, bt.t0 + bt.dur);
      if (b.id === "intro") a = win(t, at("intro", 0.55), at("intro", 0.66), at("intro", 1) - 0.3, at("intro", 1));
      if (b.id === "end") a = win(t, at("end", 0.0), at("end", 0.1), at("end", 0.45), at("end", 0.55));
      if (b.id === "end" && i === beats.length - 1 && t >= T_END) a = 0;
      S.caption = { text: b.caption, alpha: a, slot: i % 2 };
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
    if (S.titleHtml && this.hud._titleMode !== "end") {
      this.hud.setTitle(S.titleHtml);
      this.hud._titleMode = "end";
    } else if (!S.titleHtml && this.hud._titleMode === "end") {
      this.hud.setTitle(`<p class="kicker">PHIRE · Henry Ice Rise Expedition</p><h1>${TITLE}</h1>`);
      this.hud._titleMode = "intro";
    }
    this.hud.update(S, this.map);
  }
}

// ------------------------------------------------------------------ article (scroll) driver

function buildArticle(story) {
  const steps = document.getElementById("steps");
  for (const b of beats) {
    if (!b.html) continue;
    const sec = document.createElement("section");
    sec.className = "step";
    sec.dataset.beat = b.id;
    sec.style.minHeight = `${Math.max(100, b.dur * 20)}vh`;
    sec.innerHTML = `<div class="card">${b.html}</div>`;
    steps.appendChild(sec);
  }
  const secs = [...steps.querySelectorAll(".step")];
  let anchors = [];
  const measure = () => {
    anchors = secs.map((s) => ({ y: s.getBoundingClientRect().top + scrollY, t: B[s.dataset.beat].t0 }));
    const last = secs[secs.length - 1];
    anchors.push({ y: last.getBoundingClientRect().bottom + scrollY, t: T_END });
  };
  measure();
  addEventListener("resize", measure);
  const target = () => {
    const y = scrollY + innerHeight * 0.72;
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
  ready: ready.then(() => true),
  renderAt: async (t) => {
    const story = await ready;
    story.draw(t);
  },
};
