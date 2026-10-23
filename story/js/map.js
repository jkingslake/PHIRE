// Canvas map in EPSG:3031 kilometres. Everything is drawn from scratch each frame from `state`,
// so the same frame comes out whether it is reached by scrolling or by the video renderer.

import { clamp, ramp, smooth } from "./util.js";

export const COLORS = {
  bg: "#070b12",
  s1: "#3fc1ff", // 2013/14 radar lines
  s2: "#ffb547", // 2014/15 radar lines
  gl: "#ff6b5a", // present-day grounding line
  model: "#f4f8fb", // modelled grounding line
  modelFill: "rgba(205, 230, 255, 0.52)",
  min: "#6f9bff", // modelled furthest retreat
  drill: "#c4f25a",
  hl: "#ffffff",
  halo: "rgba(3, 7, 13, 0.72)",
  ink: "#eef3f7",
};

// Each finer imagery layer fades in once the next coarser one would be magnified.
const PARENT_RES = { base_weddell: 2, base_hir: 0.5, base_hen: 0.1, wv_drill: 0.025, wv_crev: 0.025 };

export class MapView {
  constructor(canvas, data) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.d = data;
    this.dpr = 1;
    this.prepTracks();
  }

  resize(w, h, dpr) {
    this.w = w;
    this.h = h;
    this.dpr = dpr;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
  }

  // ---------------------------------------------------------------- radar tracks

  prepTracks() {
    this.seasons = { "2013/14": [], "2014/15": [] };
    for (const ln of this.d.tracks) {
      let len = 0;
      const segs = ln.segs.map((flat) => {
        const n = flat.length / 2;
        const cum = new Float64Array(n);
        for (let i = 1; i < n; i++) {
          cum[i] = cum[i - 1] + Math.hypot(flat[2 * i] - flat[2 * i - 2], flat[2 * i + 1] - flat[2 * i - 1]);
        }
        const seg = { xy: flat, cum, start: len };
        len += cum[n - 1];
        return seg;
      });
      const s = this.seasons[ln.season];
      const prev = s.length ? s[s.length - 1] : null;
      s.push({ ...ln, segs, len, start: prev ? prev.start + prev.len : 0, t0: Date.parse(ln.start + "Z"), t1: Date.parse(ln.end + "Z") });
    }
    this.seasonLen = Object.fromEntries(Object.entries(this.seasons).map(([k, v]) => [k, v.length ? v[v.length - 1].start + v[v.length - 1].len : 0]));
  }

  // Length (km) of a season's survey up to the end of the named line.
  lenThrough(season, name) {
    const ln = this.seasons[season].find((l) => l.name === name);
    return ln.start + ln.len;
  }

  // The line being driven when `len` km of the season have been drawn, and the date/time then.
  trackStatus(season, len) {
    const lines = this.seasons[season];
    for (const ln of lines) {
      if (len <= ln.start + ln.len) {
        const f = clamp((len - ln.start) / ln.len);
        return { line: ln, time: new Date(ln.t0 + f * (ln.t1 - ln.t0)) };
      }
    }
    const last = lines[lines.length - 1];
    return { line: last, time: new Date(last.t1) };
  }

  // ---------------------------------------------------------------- transforms

  setView(cam, insets) {
    const [cx, cy, span] = cam;
    const x0 = insets.l, x1 = this.w - insets.r, y0 = insets.t, y1 = this.h - insets.b;
    this.ex = ((x0 + x1) / 2) * this.dpr;
    this.ey = ((y0 + y1) / 2) * this.dpr;
    this.s = (Math.max(60, Math.min(x1 - x0, y1 - y0)) / span) * this.dpr; // device px per km
    this.cx = cx;
    this.cy = cy;
    this.kmpp = 1 / this.s;
    const W = this.canvas.width, H = this.canvas.height;
    this.vb = [cx + (0 - this.ex) / this.s, cy - (H - this.ey) / this.s, cx + (W - this.ex) / this.s, cy + this.ey / this.s];
    this.span = span;
    this.eff = { x0: x0 * this.dpr, x1: x1 * this.dpr, y0: y0 * this.dpr, y1: y1 * this.dpr };
  }

  X(x) {
    return this.ex + (x - this.cx) * this.s;
  }
  Y(y) {
    return this.ey - (y - this.cy) * this.s;
  }

  // ---------------------------------------------------------------- drawing

  render(st) {
    const ctx = this.ctx;
    const W = this.canvas.width, H = this.canvas.height;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.fillStyle = COLORS.bg;
    ctx.fillRect(0, 0, W, H);
    if (st.alpha <= 0.001) return;
    this.setView(st.cam, st.insets);
    this.time = st.time;
    ctx.save();
    ctx.globalAlpha = st.alpha;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";

    for (const L of this.d.layers) {
      const pr = PARENT_RES[L.name];
      let a = 1;
      if (pr) a = smooth(ramp(Math.log2((pr * 2.8) / this.kmpp), 0, Math.log2(2.8)));
      if (a > 0.01) this.drawImage(L.img, L.bounds, a * st.alpha);
    }
    if (st.speed > 0.01) this.drawImage(this.d.speed.img, this.d.speed.bounds, st.speed * st.alpha * 0.55);
    if (st.dim > 0.01) {
      ctx.globalAlpha = st.dim * st.alpha;
      ctx.fillStyle = COLORS.bg;
      ctx.fillRect(0, 0, W, H);
    }
    ctx.globalAlpha = st.alpha;

    if (st.model.alpha > 0.01) this.drawModel(st.model, st.alpha);
    if (st.gl > 0.01) this.drawGL(st.gl * st.alpha, st.model.alpha);
    if (st.crev > 0.01) this.drawCrevasseEdges(st.crev * st.alpha);
    this.drawSeason("2013/14", st.s1, COLORS.s1, st.alpha);
    // the dense 2014/15 grid merges into a block when zoomed out, so let the map show through
    this.drawSeason("2014/15", st.s2, COLORS.s2, st.alpha * (1 - 0.45 * smooth(ramp(this.span, 60, 150))));
    if (st.hl.alpha > 0.01) this.drawHighlight(st.hl, st.alpha);
    if (st.crevBox > 0.01) this.drawBox(this.d.layers.find((l) => l.name === "wv_crev").bounds, st.crevBox * st.alpha, "Crevasses today");
    if (st.drill > 0.01) this.drawDrill(st.drill * st.alpha);
    for (const pin of st.pins || []) if (pin.alpha > 0.01) this.drawPin(pin, st.alpha);
    if (st.labels > 0.01) this.drawLabels(st.labels * st.alpha, st.extraLabels || []);
    if (st.scale > 0.01) this.drawScale(st.scale * st.alpha);
    ctx.restore();
  }

  drawImage(img, b, alpha) {
    const vb = this.vb;
    const x0 = Math.max(b[0], vb[0]), x1 = Math.min(b[2], vb[2]);
    const y0 = Math.max(b[1], vb[1]), y1 = Math.min(b[3], vb[3]);
    if (x0 >= x1 || y0 >= y1) return;
    const IW = img.naturalWidth, IH = img.naturalHeight;
    const sx = ((x0 - b[0]) / (b[2] - b[0])) * IW;
    const sw = ((x1 - x0) / (b[2] - b[0])) * IW;
    const sy = ((b[3] - y1) / (b[3] - b[1])) * IH;
    const sh = ((y1 - y0) / (b[3] - b[1])) * IH;
    if (sw < 0.5 || sh < 0.5) return;
    this.ctx.globalAlpha = alpha;
    this.ctx.drawImage(img, sx, sy, sw, sh, this.X(x0), this.Y(y1), (x1 - x0) * this.s, (y1 - y0) * this.s);
  }

  ringPath(flat, close = true) {
    const ctx = this.ctx;
    ctx.moveTo(this.X(flat[0]), this.Y(flat[1]));
    for (let i = 2; i < flat.length; i += 2) ctx.lineTo(this.X(flat[i]), this.Y(flat[i + 1]));
    if (close) ctx.closePath();
  }

  strokeWithHalo(width, color, alpha, dash = null) {
    const ctx = this.ctx, dpr = this.dpr;
    ctx.globalAlpha = alpha * 0.85;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.setLineDash(dash ? dash.map((v) => v * dpr) : []);
    ctx.strokeStyle = COLORS.halo;
    ctx.lineWidth = (width + 2.4) * dpr;
    ctx.stroke();
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = color;
    ctx.lineWidth = width * dpr;
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // Present-day grounding line at three levels of detail.
  drawGL(alpha, modelAlpha) {
    const v = this.d.vectors;
    const span = this.span;
    const lods = [
      [v.gl_ant, smooth(ramp(span, 1800, 3000)), true],
      [v.gl_weddell, smooth(ramp(span, 3000, 1800)) * smooth(ramp(span, 120, 260)), false],
      [v.gl_hir, smooth(ramp(span, 260, 120)), false],
    ];
    const dash = modelAlpha > 0.5 ? [4, 4] : null;
    for (const [rings, a, closed] of lods) {
      if (a < 0.01) continue;
      this.ctx.beginPath();
      for (const r of rings) this.ringPath(r, closed);
      this.strokeWithHalo(modelAlpha > 0.5 ? 1.1 : span < 400 ? 1.8 : 1.4, COLORS.gl, alpha * a, dash);
    }
  }

  drawSeason(season, s, color, alpha) {
    if (!s || s.alpha < 0.01 || s.len <= 0) return;
    const ctx = this.ctx;
    const lines = this.seasons[season];
    const width = this.span < 80 ? 2 : this.span < 250 ? 1.3 : 1;
    ctx.beginPath();
    let head = null;
    for (const ln of lines) {
      if (ln.start >= s.len) break;
      for (const seg of ln.segs) {
        const avail = s.len - ln.start - seg.start;
        if (avail <= 0) break;
        const p = seg.xy, cum = seg.cum, n = cum.length;
        ctx.moveTo(this.X(p[0]), this.Y(p[1]));
        let i = 1;
        for (; i < n && cum[i] <= avail; i++) ctx.lineTo(this.X(p[2 * i]), this.Y(p[2 * i + 1]));
        if (i < n) {
          const f = (avail - cum[i - 1]) / (cum[i] - cum[i - 1]);
          const hx = p[2 * i - 2] + f * (p[2 * i] - p[2 * i - 2]);
          const hy = p[2 * i - 1] + f * (p[2 * i + 1] - p[2 * i - 1]);
          ctx.lineTo(this.X(hx), this.Y(hy));
          head = [hx, hy];
        }
      }
    }
    this.strokeWithHalo(width, color, s.alpha * alpha);
    if (head && s.head) {
      const [hx, hy] = [this.X(head[0]), this.Y(head[1])];
      ctx.globalAlpha = s.alpha * alpha;
      const g = ctx.createRadialGradient(hx, hy, 0, hx, hy, 14 * this.dpr);
      g.addColorStop(0, "rgba(255,255,255,0.95)");
      g.addColorStop(0.25, color);
      g.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(hx, hy, 14 * this.dpr, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  drawHighlight(hl, alpha) {
    const line = this.d.rg[hl.line].line;
    const d = line.d, xy = line.xy;
    const dmax = d[0] + hl.progress * (d[d.length - 1] - d[0]);
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.moveTo(this.X(xy[0]), this.Y(xy[1]));
    let last = [xy[0], xy[1]];
    for (let i = 1; i < d.length && d[i] <= dmax; i++) {
      ctx.lineTo(this.X(xy[2 * i]), this.Y(xy[2 * i + 1]));
      last = [xy[2 * i], xy[2 * i + 1]];
    }
    ctx.save();
    ctx.shadowColor = "rgba(255,255,255,0.9)";
    ctx.shadowBlur = 10 * this.dpr;
    this.strokeWithHalo(3, COLORS.hl, hl.alpha * alpha);
    ctx.restore();
    if (hl.progress < 0.999) {
      ctx.globalAlpha = hl.alpha * alpha;
      ctx.fillStyle = "#fff";
      ctx.beginPath();
      ctx.arc(this.X(last[0]), this.Y(last[1]), 5 * this.dpr, 0, Math.PI * 2);
      ctx.fill();
    }
    if (hl.label) {
      const i = Math.floor(d.length * 0.5);
      this.label(hl.label, this.X(xy[2 * i]), this.Y(xy[2 * i + 1]), hl.alpha * alpha, { size: 14, weight: 700, dx: 12, align: "left" });
    }
  }

  drawCrevasseEdges(alpha) {
    const v = this.d.vectors;
    const ctx = this.ctx;
    ctx.beginPath();
    for (const l of v.texture_lines) this.ringPath(l, false);
    this.strokeWithHalo(2, "#e9f3fb", alpha, [7, 5]);
    const p = v.crevasse_onsets;
    for (let i = 0; i < p.length; i += 2) {
      const x = this.X(p[i]), y = this.Y(p[i + 1]);
      ctx.globalAlpha = alpha;
      ctx.fillStyle = COLORS.halo;
      ctx.beginPath();
      ctx.arc(x, y, 5.2 * this.dpr, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.arc(x, y, 3.4 * this.dpr, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  drawBox(b, alpha, text) {
    const ctx = this.ctx;
    const x = this.X(b[0]), y = this.Y(b[3]), w = (b[2] - b[0]) * this.s, h = (b[3] - b[1]) * this.s;
    const m = Math.max(0, 10 * this.dpr - Math.min(w, h) / 2); // keep it visible when small
    ctx.beginPath();
    ctx.rect(x - m, y - m, w + 2 * m, h + 2 * m);
    this.strokeWithHalo(1.8, "#ffffff", alpha);
    if (text) this.label(text, x + w + m, y - m, alpha, { size: 13, weight: 600, dx: 8, dy: -2, align: "left", baseline: "bottom" });
  }

  drawDrill(alpha) {
    const ctx = this.ctx, dpr = this.dpr;
    const [dx, dy] = this.d.vectors.drillsite;
    const x = this.X(dx), y = this.Y(dy);
    const ph = ((this.time || 0) % 1.6) / 1.6;
    ctx.globalAlpha = alpha * (1 - ph) * 0.9;
    ctx.strokeStyle = COLORS.drill;
    ctx.lineWidth = 2 * dpr;
    ctx.beginPath();
    ctx.arc(x, y, (10 + 26 * ph) * dpr, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = alpha;
    star(ctx, x, y, 11 * dpr, 4.6 * dpr);
    ctx.fillStyle = COLORS.drill;
    ctx.strokeStyle = COLORS.halo;
    ctx.lineWidth = 2.5 * dpr;
    ctx.stroke();
    ctx.fill();
    this.label("PHIRE drill site", x, y, alpha, { size: 15, weight: 700, dx: 16, align: "left" });
  }

  drawPin(pin, alpha) {
    const ctx = this.ctx, dpr = this.dpr;
    const x = this.X(pin.xy[0]), y = this.Y(pin.xy[1]);
    ctx.globalAlpha = alpha * pin.alpha;
    ctx.beginPath();
    ctx.arc(x, y, 11 * dpr, 0, Math.PI * 2);
    ctx.lineWidth = 4.5 * dpr;
    ctx.strokeStyle = COLORS.halo;
    ctx.stroke();
    ctx.lineWidth = 2 * dpr;
    ctx.strokeStyle = pin.color || "#ffffff";
    ctx.stroke();
    this.label(pin.text, x, y, alpha * pin.alpha, { size: 13, weight: 700, dx: 16, align: "left" });
  }

  drawModel(m, alpha) {
    const P = this.d.pism;
    const ctx = this.ctx;
    const times = P.times;
    let i = 0;
    while (i < times.length - 2 && times[i + 1] <= m.t) i++;
    const f = clamp((m.t - times[i]) / (times[i + 1] - times[i]));
    // grounded ice, cross-fading between neighbouring 200-year frames
    for (const [k, w] of [[i, 1 - f], [i + 1, f]]) {
      if (w < 0.02) continue;
      ctx.beginPath();
      for (const r of P.grounded[k]) this.ringPath(r);
      ctx.globalAlpha = alpha * m.alpha * w;
      ctx.fillStyle = COLORS.modelFill;
      ctx.fill("evenodd");
    }
    const k = f < 0.5 ? i : i + 1;
    if (m.min > 0.01) {
      ctx.beginPath();
      for (const r of P.min_grounded) this.ringPath(r);
      this.strokeWithHalo(2.2, COLORS.min, alpha * m.alpha * m.min);
    }
    ctx.beginPath();
    for (const r of P.grounded[k]) this.ringPath(r);
    this.strokeWithHalo(1.8, COLORS.model, alpha * m.alpha);
  }

  drawLabels(alpha, extra) {
    const span = this.span;
    const all = [...this.d.vectors.labels, ...extra];
    for (const L of all) {
      const [w0, w1] = L.w;
      const a = smooth(ramp(span, w0 * 0.75, w0)) * smooth(ramp(span, w1 * 1.3, w1)) * (L.alpha ?? 1);
      if (a < 0.02) continue;
      const kind = L.kind;
      const opts =
        kind === "region"
          ? { size: 13, weight: 600, upper: true, spacing: 2.5, color: "rgba(238,243,247,0.85)" }
          : kind === "sea"
          ? { size: 14, weight: 500, italic: true, color: "rgba(190,215,235,0.9)" }
          : kind === "shelf"
          ? { size: 13, weight: 600, color: "rgba(238,243,247,0.92)" }
          : { size: 14, weight: 700, color: COLORS.ink };
      this.label(L.text, this.X(L.xy[0]), this.Y(L.xy[1]), alpha * a, opts);
    }
  }

  label(text, x, y, alpha, o = {}) {
    const ctx = this.ctx, dpr = this.dpr;
    const size = (o.size || 14) * dpr * (this.d.uiScale || 1);
    ctx.globalAlpha = alpha;
    ctx.font = `${o.italic ? "italic " : ""}${o.weight || 600} ${size}px Inter, system-ui, sans-serif`;
    ctx.textAlign = o.align || "center";
    ctx.textBaseline = o.baseline || "middle";
    if ("letterSpacing" in ctx) ctx.letterSpacing = `${(o.spacing || 0) * dpr}px`;
    const t = o.upper ? text.toUpperCase() : text;
    const px = x + (o.dx || 0) * dpr, py = y + (o.dy || 0) * dpr;
    ctx.lineJoin = "round";
    ctx.strokeStyle = "rgba(3,7,13,0.78)";
    ctx.lineWidth = 3.5 * dpr;
    ctx.strokeText(t, px, py);
    ctx.fillStyle = o.color || COLORS.ink;
    ctx.fillText(t, px, py);
    if ("letterSpacing" in ctx) ctx.letterSpacing = "0px";
  }

  drawScale(alpha) {
    const ctx = this.ctx, dpr = this.dpr;
    const target = (this.eff.x1 - this.eff.x0) * 0.22 / this.s; // km
    const p = Math.pow(10, Math.floor(Math.log10(target)));
    const nice = [1, 2, 5, 10].map((m) => m * p).reduce((a, b) => (Math.abs(b - target) < Math.abs(a - target) ? b : a));
    const len = nice * this.s;
    const x1 = this.eff.x1 - 20 * dpr, x0 = x1 - len, y = this.eff.y1 - 22 * dpr;
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = COLORS.halo;
    ctx.lineWidth = 6 * dpr;
    ctx.beginPath();
    ctx.moveTo(x0, y);
    ctx.lineTo(x1, y);
    ctx.stroke();
    ctx.strokeStyle = "#eef3f7";
    ctx.lineWidth = 2 * dpr;
    ctx.beginPath();
    ctx.moveTo(x0, y - 5 * dpr);
    ctx.lineTo(x0, y);
    ctx.lineTo(x1, y);
    ctx.lineTo(x1, y - 5 * dpr);
    ctx.stroke();
    const txt = nice >= 1 ? `${nice} km` : `${Math.round(nice * 1000)} m`;
    this.label(txt, (x0 + x1) / 2 / dpr * dpr, y - 12 * dpr, alpha, { size: 12, weight: 600 });
  }
}

function star(ctx, x, y, r1, r0) {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 ? r0 : r1;
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    ctx[i ? "lineTo" : "moveTo"](x + r * Math.cos(a), y + r * Math.sin(a));
  }
  ctx.closePath();
}
