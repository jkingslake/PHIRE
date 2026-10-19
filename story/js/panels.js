// DOM overlays driven by the same per-frame state as the map: radargram viewer, temperature chart,
// field-season ticker, model clock, legend, captions and title card.

import { clamp, lerp, fmtDate, fmtInt } from "./util.js";
import { COLORS } from "./map.js";

const SVGNS = "http://www.w3.org/2000/svg";
const el = (tag, cls, parent, html) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  if (parent) parent.appendChild(e);
  return e;
};
const svg = (tag, attrs = {}, parent) => {
  const e = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (parent) parent.appendChild(e);
  return e;
};
const setOpacity = (e, a) => {
  const v = a < 0.005 ? 0 : a > 0.995 ? 1 : +a.toFixed(3);
  if (e._op !== v) {
    e.style.opacity = v;
    e.style.visibility = v === 0 ? "hidden" : "visible";
    e._op = v;
  }
};
const setText = (e, t) => {
  if (e._t !== t) {
    e.textContent = t;
    e._t = t;
  }
};

function ticks(a, b, n = 5) {
  const lo = Math.min(a, b), hi = Math.max(a, b);
  const raw = (hi - lo) / n;
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * p).find((s) => s >= raw) || 10 * p;
  const out = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(+v.toFixed(6));
  return out;
}

// ------------------------------------------------------------------ radargram viewer

const RG_NOTES = {
  line3: {
    title: "HE Line 3",
    sub: "4–5 January 2014 · unmigrated",
    notes: [
      { d: 17, z: 60, text: "ice surface", view: "full" },
      { d: 17, z: -250, text: "layers of buried snowfall", view: "full" },
      { d: 17, z: -615, text: "bed", view: "full" },
      { d: 30.5, z: -360, text: "steep, bright echoes", view: "zoom", arrow: [29.3, -420] },
    ],
  },
  fl5: {
    title: "HEnorth FL5",
    sub: "30 December 2014 · migrated",
    notes: [
      { d: 3, z: 85, text: "ice surface", view: "full" },
      { d: 3, z: -120, text: "layers of buried snowfall", view: "full" },
      { d: 3, z: -440, text: "bed", view: "full" },
      { d: 10.4, z: -275, text: "buried crevasses", view: "zoom", arrow: [10.0, -330] },
      { d: 7.6, z: -432, text: "bed", view: "zoom" },
    ],
  },
};

export class Radargram {
  constructor(root, meta, images) {
    this.meta = meta;
    this.images = images;
    this.root = el("figure", "panel rg", root);
    const head = el("figcaption", "rg-head", this.root);
    this.title = el("span", "rg-title", head);
    this.sub = el("span", "rg-sub", head);
    this.plot = el("div", "rg-plot", this.root);
    this.clip = el("div", "rg-clip", this.plot);
    this.imgFull = el("img", "rg-img", this.clip);
    this.imgZoom = el("img", "rg-img", this.clip);
    this.imgFull.alt = "";
    this.imgZoom.alt = "";
    this.svg = svg("svg", { class: "rg-svg" }, this.plot);
    this.gAxes = svg("g", { class: "axes" }, this.svg);
    this.gOver = svg("g", {}, this.svg);
    this.box = svg("rect", { class: "rg-box" }, this.gOver);
    this.drill = svg("line", { class: "rg-drill" }, this.gOver);
    this.drillLabel = svg("text", { class: "rg-note drill-note" }, this.gOver);
    this.drillLabel.textContent = "drill site";
    this.notes = svg("g", {}, this.gOver);
    this.which = null;
  }

  setWhich(which) {
    if (this.which === which) return;
    this.which = which;
    const m = this.meta[which];
    this.imgFull.src = m.full.src;
    this.imgZoom.src = m.zoom.src;
    this.title.textContent = RG_NOTES[which].title;
    this.sub.textContent = RG_NOTES[which].sub;
    this.notes.replaceChildren();
    this.noteEls = RG_NOTES[which].notes.map((n) => {
      const g = svg("g", {}, this.notes);
      const t = svg("text", { class: "rg-note" }, g);
      t.textContent = n.text;
      const a = n.arrow ? svg("line", { class: "rg-arrow" }, g) : null;
      return { n, g, t, a };
    });
  }

  update(st) {
    setOpacity(this.root, st.alpha);
    if (st.alpha < 0.005 || !st.which) return;
    this.setWhich(st.which);
    const m = this.meta[st.which];
    const W = this.plot.clientWidth, H = this.plot.clientHeight;
    if (!W || !H) return;
    const ml = 46, mb = 24, mt = 6, mr = 8;
    const pw = W - ml - mr, ph = H - mb - mt;
    // current data extent: from the full line towards the zoom box
    const F = m.full, Z = m.zoom, e = st.zoom;
    const E = { d: [lerp(F.d[0], Z.d[0], e), lerp(F.d[1], Z.d[1], e)], z: [lerp(F.z[0], Z.z[0], e), lerp(F.z[1], Z.z[1], e)] };
    const X = (d) => ml + ((d - E.d[0]) / (E.d[1] - E.d[0])) * pw;
    const Y = (z) => mt + ((E.z[1] - z) / (E.z[1] - E.z[0])) * ph;
    const place = (img, ext) => {
      const x0 = X(ext.d[0]), x1 = X(ext.d[1]), y0 = Y(ext.z[1]), y1 = Y(ext.z[0]);
      img.style.transform = `translate(${x0 - ml}px, ${y0 - mt}px)`;
      img.style.width = `${x1 - x0}px`;
      img.style.height = `${y1 - y0}px`;
    };
    Object.assign(this.clip.style, { left: `${ml}px`, top: `${mt}px`, width: `${pw}px`, height: `${ph}px` });
    place(this.imgFull, F);
    place(this.imgZoom, Z);
    setOpacity(this.imgZoom, clamp((e - 0.55) / 0.4));
    // reveal: a wipe in step with the line being drawn on the map
    const rx = clamp(X(lerp(F.d[0], F.d[1], st.reveal)) - ml, 0, pw);
    this.clip.style.clipPath = `inset(0 ${pw - rx}px 0 0)`;

    // axes
    this.svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    this.gAxes.replaceChildren();
    for (const d of ticks(E.d[0], E.d[1], W < 420 ? 4 : 6)) {
      const x = X(d);
      svg("line", { x1: x, x2: x, y1: mt + ph, y2: mt + ph + 4, class: "tick" }, this.gAxes);
      svg("text", { x, y: H - 6, class: "tick-label", "text-anchor": "middle" }, this.gAxes).textContent = `${fmtNum(d)}`;
    }
    svg("text", { x: W - mr, y: H - 6, class: "tick-label unit", "text-anchor": "end" }, this.gAxes).textContent = "km";
    for (const z of ticks(E.z[0], E.z[1], 4)) {
      const y = Y(z);
      svg("line", { x1: ml - 4, x2: ml, y1: y, y2: y, class: "tick" }, this.gAxes);
      svg("text", { x: ml - 7, y: y + 4, class: "tick-label", "text-anchor": "end" }, this.gAxes).textContent = `${fmtNum(z)}`;
    }
    svg("text", { x: 4, y: mt + 10, class: "tick-label unit" }, this.gAxes).textContent = "m";

    // zoom box, shown before and while zooming
    const bx0 = X(Z.d[0]), bx1 = X(Z.d[1]), by0 = Y(Z.z[1]), by1 = Y(Z.z[0]);
    Object.entries({ x: bx0, y: by0, width: bx1 - bx0, height: by1 - by0 }).forEach(([k, v]) => this.box.setAttribute(k, v));
    this.box.style.opacity = st.box * (1 - clamp((e - 0.7) / 0.3));

    // drill line (FL5): surface to the RAID depth
    if (m.drill_d && st.drill > 0.005) {
      const x = X(m.drill_d);
      const surf = interp(m.line.d, m.line.surface, m.drill_d);
      Object.entries({ x1: x, x2: x, y1: Y(surf), y2: Y(surf - 450) }).forEach(([k, v]) => this.drill.setAttribute(k, v));
      this.drill.style.opacity = st.drill;
      this.drillLabel.setAttribute("x", x + 6);
      this.drillLabel.setAttribute("y", Math.max(mt + 12, Y(surf - 450) + 4));
      this.drillLabel.style.opacity = st.drill;
    } else {
      this.drill.style.opacity = 0;
      this.drillLabel.style.opacity = 0;
    }

    for (const { n, g, t, a } of this.noteEls) {
      const vis = n.view === "full" ? (1 - clamp(e / 0.3)) * clamp((st.reveal * (F.d[1] - F.d[0]) + F.d[0] - n.d) / 1.5 + 1) : clamp((e - 0.8) / 0.2);
      g.style.opacity = vis * st.notes;
      t.setAttribute("x", X(n.d));
      t.setAttribute("y", Y(n.z));
      t.setAttribute("text-anchor", "middle");
      if (a) {
        a.setAttribute("x1", X(n.d));
        a.setAttribute("y1", Y(n.z) + 6);
        a.setAttribute("x2", X(n.arrow[0]));
        a.setAttribute("y2", Y(n.arrow[1]));
      }
    }
  }
}

function interp(xs, ys, x) {
  let i = 1;
  while (i < xs.length - 1 && xs[i] < x) i++;
  const f = clamp((x - xs[i - 1]) / (xs[i] - xs[i - 1]));
  return ys[i - 1] + f * (ys[i] - ys[i - 1]);
}
const fmtNum = (v) => (Math.abs(v) >= 100 ? fmtInt(v) : `${+v.toFixed(1)}`).replace("-", "−");

// ------------------------------------------------------------------ temperature chart

export class TempChart {
  constructor(root, data) {
    this.d = data;
    this.root = el("figure", "panel tchart", root);
    el("figcaption", "tchart-head", this.root, `<span class="rg-title">Temperature in the ice after it runs aground</span>
      <span class="rg-sub">1-D model, placeholder site values</span>`);
    this.plot = el("div", "tchart-plot", this.root);
    this.svg = svg("svg", { role: "img", "aria-label": "Modelled ice temperature against depth for several times since grounding" }, this.plot);
    this.tip = el("div", "tchart-tip", this.plot);
    this.refAges = [500, 1000, 2000, 5000];
    const all = data.T.flat();
    this.tmin = Math.floor(Math.min(...all));
    this.tmax = Math.ceil(Math.max(...all));
    this.hover = null;
    this.plot.addEventListener("pointermove", (ev) => {
      const r = this.plot.getBoundingClientRect();
      this.hover = ev.clientY - r.top;
      this.draw(this.lastAge);
    });
    this.plot.addEventListener("pointerleave", () => {
      this.hover = null;
      this.draw(this.lastAge);
    });
  }

  rowFor(age) {
    const a = this.d.age;
    let i = 0;
    while (i < a.length - 2 && a[i + 1] <= age) i++;
    const f = clamp((age - a[i]) / (a[i + 1] - a[i]));
    return this.d.T[i].map((v, k) => v + f * (this.d.T[i + 1][k] - v));
  }

  update(st) {
    setOpacity(this.root, st.alpha);
    if (st.alpha < 0.005) return;
    this.draw(st.age);
  }

  draw(age) {
    this.lastAge = age;
    const W = this.plot.clientWidth, H = this.plot.clientHeight;
    if (!W || !H) return;
    const ml = 40, mr = 14, mt = 22, mb = 34;
    const pw = W - ml - mr, ph = H - mt - mb;
    const X = (T) => ml + ((T - this.tmin) / (this.tmax - this.tmin)) * pw;
    const Y = (z) => mt + (z / this.d.H) * ph;
    const s = this.svg;
    s.setAttribute("viewBox", `0 0 ${W} ${H}`);
    s.replaceChildren();
    const g = svg("g", { class: "axes" }, s);
    for (const T of ticks(this.tmin, this.tmax, 4)) {
      svg("line", { x1: X(T), x2: X(T), y1: mt, y2: mt + ph, class: "grid" }, g);
      svg("text", { x: X(T), y: mt - 8, class: "tick-label", "text-anchor": "middle" }, g).textContent = `${fmtNum(T)}`;
    }
    svg("text", { x: ml + pw, y: H - 8, class: "tick-label unit", "text-anchor": "end" }, g).textContent = "temperature (°C)";
    for (const z of [0, 100, 200, 300, 400, 500]) {
      svg("text", { x: ml - 7, y: Y(z) + 4, class: "tick-label", "text-anchor": "end" }, g).textContent = z;
    }
    svg("text", { x: 4, y: H - 8, class: "tick-label unit" }, g).textContent = "depth (m)";
    const path = (row) => row.map((T, k) => `${k ? "L" : "M"}${X(T).toFixed(1)},${Y(this.d.depth[k]).toFixed(1)}`).join("");
    // faint reference curves; only the first and last are labelled, beside the bed
    this.refAges.forEach((a, i) => {
      const row = this.rowFor(a);
      svg("path", { d: path(row), class: "tline ref" }, s);
      if (i === 0 || i === this.refAges.length - 1) {
        const last = row[row.length - 1];
        const first = i === 0;
        svg("text", { x: X(last) + (first ? 6 : -6), y: Y(this.d.H) + 14, class: "tick-label ref-label", "text-anchor": first ? "start" : "end" }, s).textContent =
          a >= 1000 ? `${a / 1000},000 yr` : `${a} yr`;
      }
    });
    const row = this.rowFor(age);
    svg("path", { d: path(row), class: "tline now" }, s);
    const last = row[row.length - 1];
    svg("circle", { cx: X(last), cy: Y(this.d.H), r: 4.5, class: "tdot" }, s);
    // the current time since grounding, as a readout in the empty upper right of the plot
    const rx = ml + pw + mr - 4;
    svg("text", { x: rx, y: mt + 30, class: "now-big", "text-anchor": "end" }, s).textContent = fmtInt(age);
    svg("text", { x: rx, y: mt + 48, class: "now-label", "text-anchor": "end" }, s).textContent = "years after grounding";
    // hover readout
    if (this.hover !== null) {
      const z = clamp(((this.hover - mt) / ph) * this.d.H, 0, this.d.H);
      svg("line", { x1: ml, x2: ml + pw, y1: Y(z), y2: Y(z), class: "cross" }, s);
      const k = this.d.depth.reduce((bi, dz, i) => (Math.abs(dz - z) < Math.abs(this.d.depth[bi] - z) ? i : bi), 0);
      const rows = [[`${fmtInt(age)} yr`, row[k]], ...this.refAges.map((a) => [a >= 1000 ? `${a / 1000} kyr` : `${a} yr`, this.rowFor(a)[k]])];
      this.tip.innerHTML = `<b>${this.d.depth[k]} m deep</b>` + rows.map(([n, T]) => `<div><span>${n}</span><span>${T.toFixed(2)} °C</span></div>`).join("");
      this.tip.style.top = `${Y(this.d.depth[k])}px`;
      this.tip.style.opacity = 1;
    } else {
      this.tip.style.opacity = 0;
    }
  }
}

// ------------------------------------------------------------------ HUD: ticker, clock, legend, caption, title

// Like setOpacity, but also takes the element out of the layout when hidden (for stacked HUD items).
const setShown = (e, a) => {
  setOpacity(e, a);
  const d = a < 0.005 ? "none" : "";
  if (e._d !== d) {
    e.style.display = d;
    e._d = d;
  }
};

export class Hud {
  constructor(root) {
    const col = el("div", "hudcol", root);
    this.ticker = el("div", "hud ticker", col);
    this.tSeason = el("div", "t-season", this.ticker);
    this.tDate = el("div", "t-date", this.ticker);
    this.tKm = el("div", "t-km", this.ticker);

    this.clock = el("div", "hud clock", col);
    this.cYears = el("div", "c-years", this.clock);
    this.cLabel = el("div", "c-label", this.clock, "years ago");
    this.cHir = el("div", "c-hir", this.clock);
    el("div", "c-src", this.clock, "PISM simulation, Kingslake et al. 2018");

    this.legend = el("ul", "hud legend", col);
    this.legendItems = {};
    const items = {
      gl: ["line", COLORS.gl, "Grounding line today"],
      glDash: ["dash", COLORS.gl, "Grounding line today"],
      model: ["line", COLORS.model, "Modelled grounding line"],
      modelFill: ["fill", COLORS.modelFill, "Modelled grounded ice"],
      min: ["line", COLORS.min, "Furthest modelled retreat"],
      s1: ["line", COLORS.s1, "Radar lines, 2013/14"],
      s2: ["line", COLORS.s2, "Radar lines, 2014/15"],
      texture: ["dash", "#e9f3fb", "Edge of crevasse-free band"],
      onset: ["dot", "#ffffff", "Where crevasses begin"],
      drill: ["star", COLORS.drill, "PHIRE drill site"],
      speed: ["ramp", null, "Ice speed today, 10–800 m/yr"],
    };
    for (const [k, [kind, color, text]] of Object.entries(items)) {
      const li = el("li", `lg lg-${kind}`, this.legend);
      const sw = el("span", "sw", li);
      if (color) sw.style.setProperty("--c", color);
      el("span", "", li, text);
      this.legendItems[k] = li;
    }

    this.credit = el("div", "hud credit", root);

    this.caption = el("div", "caption", root);
    this.capA = el("p", "", this.caption);
    this.capB = el("p", "", this.caption);

    this.title = el("div", "titlecard", root);
  }

  setTitle(html) {
    this.title.innerHTML = html;
  }

  update(st, map) {
    // field-season ticker
    setShown(this.ticker, st.ticker.alpha);
    if (st.ticker.alpha > 0.005) {
      const { season, len } = st.ticker;
      const status = map.trackStatus(season, len);
      setText(this.tSeason, `${season} field season`);
      setText(this.tDate, fmtDate(status.time));
      setText(this.tKm, `${fmtInt(len)} km of radar profiles`);
    }
    // model clock
    setShown(this.clock, st.clock.alpha);
    if (st.clock.alpha > 0.005) {
      const yrs = -st.clock.t;
      setText(this.cYears, yrs < 100 ? "Today" : fmtInt(yrs));
      setText(this.cLabel, yrs < 100 ? "end of the simulation" : "years ago");
      setText(this.cHir, st.clock.hirAfloat ? "Henry Ice Rise afloat" : "Henry Ice Rise aground");
      this.cHir.classList.toggle("afloat", st.clock.hirAfloat);
    }
    // legend
    let any = 0;
    for (const [k, li] of Object.entries(this.legendItems)) {
      const a = st.legend[k] || 0;
      any = Math.max(any, a);
      li.style.display = a > 0.02 ? "" : "none";
      li.style.opacity = a;
    }
    setShown(this.legend, any);
    // imagery credit
    setOpacity(this.credit, st.credit ? 1 : 0);
    if (st.credit) setText(this.credit, st.credit);
    // captions (video), cross-fading between two slots
    if (st.caption) {
      const { text, alpha, slot } = st.caption;
      const [on, off] = slot ? [this.capB, this.capA] : [this.capA, this.capB];
      setText(on, text);
      setOpacity(on, alpha);
      setOpacity(off, 0);
    }
    setOpacity(this.title, st.titleAlpha || 0);
  }
}
