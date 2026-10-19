// A block of ice cut along radar line FL5 at the drill site: the radargram is the front face, the
// WorldView-1 image is draped over the top, and the borehole goes down the face at the drill site.

import * as THREE from "../vendor/three.module.min.js";
import { clamp, lerp, easeInOut } from "./util.js";
import { COLORS } from "./map.js";

const VE = 3; // vertical exaggeration

export class Block3D {
  constructor(canvas, labelRoot, data) {
    this.canvas = canvas;
    this.data = data; // { rg: radargrams.fl5, block: block.json, faceImg, topImg }
    const fl5 = data.rg;
    const face = fl5.face;
    this.d0 = face.d[0];
    this.L = face.d[1] - face.d[0];
    this.zBot = face.z[0];
    this.zTop = face.z[1];
    this.D = data.block.depth_km;
    this.drillX = fl5.drill_d - this.d0 - this.L / 2;
    this.surfAt = (d) => {
      const xs = fl5.line.d, ys = fl5.line.surface;
      let i = 1;
      while (i < xs.length - 1 && xs[i] < d) i++;
      const f = clamp((d - xs[i - 1]) / (xs[i] - xs[i - 1]));
      return ys[i - 1] + f * (ys[i] - ys[i - 1]);
    };
    this.Yof = (elev) => ((elev - this.zBot) / 1000) * VE;

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(35, 1, 0.01, 100);
    this.scene.add(new THREE.AmbientLight(0xffffff, 1.1));
    const sun = new THREE.DirectionalLight(0xffffff, 1.6);
    sun.position.set(-3, 6, 4);
    this.scene.add(sun);
    this.build();
    this.labels = this.makeLabels(labelRoot);
  }

  texture(img) {
    const t = new THREE.Texture(img);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    t.needsUpdate = true;
    return t;
  }

  build() {
    const { L, D } = this;
    const nx = 160;
    const g = new THREE.Group();
    this.group = g;

    // front face: the radargram, transparent above the ice surface
    const hFace = this.Yof(this.zTop);
    const front = new THREE.Mesh(
      new THREE.PlaneGeometry(L, hFace),
      new THREE.MeshBasicMaterial({ map: this.texture(this.data.faceImg), transparent: true, alphaTest: 0.5, side: THREE.DoubleSide })
    );
    front.position.set(0, hFace / 2, D / 2);
    g.add(front);

    // top: the ice surface along the line, extruded back, with the WorldView image on it
    const topGeo = new THREE.PlaneGeometry(L, D, nx, 1);
    topGeo.rotateX(-Math.PI / 2);
    const pos = topGeo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      pos.setY(i, this.Yof(this.surfAt(x + L / 2 + this.d0)));
    }
    topGeo.computeVertexNormals();
    const top = new THREE.Mesh(topGeo, new THREE.MeshLambertMaterial({ map: this.texture(this.data.topImg) }));
    g.add(top);

    // the other faces: plain ice, darker with depth
    const grad = document.createElement("canvas");
    grad.width = 4;
    grad.height = 256;
    const gc = grad.getContext("2d");
    const lg = gc.createLinearGradient(0, 0, 0, 256);
    lg.addColorStop(0, "#c9dceb");
    lg.addColorStop(0.15, "#6f8fa9");
    lg.addColorStop(0.86, "#27435c");
    lg.addColorStop(0.9, "#3a3328");
    lg.addColorStop(1, "#231f1a");
    gc.fillStyle = lg;
    gc.fillRect(0, 0, 4, 256);
    const sideMat = new THREE.MeshLambertMaterial({ map: new THREE.CanvasTexture(grad), side: THREE.DoubleSide });
    sideMat.map.colorSpace = THREE.SRGBColorSpace;
    const side = (x) => {
      const geo = new THREE.PlaneGeometry(D, 1, 1, 1);
      const h = this.Yof(this.surfAt(x + L / 2 + this.d0));
      const m = new THREE.Mesh(geo, sideMat);
      m.scale.y = h;
      m.rotation.y = Math.PI / 2;
      m.position.set(x, h / 2, 0);
      return m;
    };
    g.add(side(-L / 2), side(L / 2));
    const backGeo = new THREE.PlaneGeometry(L, 1, nx, 1);
    const bp = backGeo.attributes.position;
    for (let i = 0; i < bp.count; i++) {
      const x = bp.getX(i);
      const h = this.Yof(this.surfAt(x + L / 2 + this.d0));
      bp.setY(i, bp.getY(i) > 0 ? h : 0);
    }
    const back = new THREE.Mesh(backGeo, sideMat);
    back.position.set(0, 0, -D / 2);
    g.add(back);
    const bottom = new THREE.Mesh(new THREE.PlaneGeometry(L, D), new THREE.MeshLambertMaterial({ color: 0x1b1814, side: THREE.DoubleSide }));
    bottom.rotation.x = -Math.PI / 2;
    g.add(bottom);

    // borehole and rig
    this.surfY = this.Yof(this.surfAt(this.data.rg.drill_d));
    const holeMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(COLORS.drill) });
    this.hole = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.009, 1, 16), holeMat);
    this.hole.position.set(this.drillX, this.surfY, D / 2 + 0.02);
    g.add(this.hole);
    this.head = new THREE.Mesh(new THREE.SphereGeometry(0.022, 20, 12), new THREE.MeshBasicMaterial({ color: 0xffffff }));
    g.add(this.head);
    const rig = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.2, 4), new THREE.MeshLambertMaterial({ color: new THREE.Color(COLORS.drill) }));
    rig.position.set(this.drillX, this.surfY + 0.1, D / 2);
    g.add(rig);
    // glow sprite at the drill head
    const glow = document.createElement("canvas");
    glow.width = glow.height = 64;
    const gg = glow.getContext("2d");
    const rg = gg.createRadialGradient(32, 32, 0, 32, 32, 32);
    rg.addColorStop(0, "rgba(255,255,255,1)");
    rg.addColorStop(0.3, "rgba(196,242,90,0.6)");
    rg.addColorStop(1, "rgba(196,242,90,0)");
    gg.fillStyle = rg;
    gg.fillRect(0, 0, 64, 64);
    this.glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(glow), depthTest: false, transparent: true }));
    this.glow.scale.set(0.2, 0.2, 1);
    g.add(this.glow);

    this.scene.add(g);
  }

  makeLabels(root) {
    const mk = (text, cls = "") => {
      const e = document.createElement("div");
      e.className = `label3d ${cls}`;
      e.innerHTML = text;
      root.appendChild(e);
      return e;
    };
    const D = this.D;
    return [
      { e: mk("ice surface"), p: () => [-this.L / 2 + 0.6, this.Yof(this.surfAt(this.d0 + 0.6)) + 0.12, D / 2], a: (s) => s.labels },
      { e: mk("bed, about 540 m down"), p: () => [-this.L / 2 + 1.6, this.Yof(-440), D / 2], a: (s) => s.labels },
      { e: mk("buried crevasses", "hot"), p: () => [this.drillX + 0.75, this.Yof(-285), D / 2], a: (s) => s.labels * clamp((s.drill - 0.5) / 0.3) },
      { e: mk("", "depth"), p: () => [this.drillX + 0.12, this.headY, D / 2], a: (s) => clamp(s.drill * 20) * (1 - clamp((s.drill - 0.98) / 0.02) * 0) * s.labels, depth: true },
    ];
  }

  resize(w, h, dpr) {
    this.w = w;
    this.h = h;
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(w, h, false);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
  }

  // st: { alpha, cam (0-1 along the camera path), drill (0-1 of the 450 m hole), labels, insets }
  render(st) {
    this.canvas.style.opacity = st.alpha;
    for (const l of this.labels) l.e.style.opacity = 0;
    if (st.alpha < 0.005) return;

    // borehole down to the RAID depth (450 m)
    const depthM = 450 * clamp(st.drill);
    const hLen = (depthM / 1000) * VE;
    this.hole.visible = depthM > 0.5;
    this.hole.scale.y = Math.max(hLen, 1e-4);
    this.hole.position.y = this.surfY - hLen / 2;
    this.headY = this.surfY - hLen;
    this.head.position.set(this.drillX, this.headY, this.D / 2 + 0.03);
    this.glow.position.copy(this.head.position);
    this.head.visible = this.glow.visible = st.drill > 0.001 && st.drill < 0.999;

    // camera path: straight down over the drill site at the map's scale, then out to the side.
    // Oblique views are pulled back in narrow (portrait) frames so the block still fits.
    const north = new THREE.Vector3(...this.data.northIn3D).normalize();
    const ew = this.w - st.insets.l - st.insets.r, eh = this.h - st.insets.t - st.insets.b;
    const k = clamp(1.7 / (ew / eh), 1.1, 3.4);
    const tanHalf = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
    const hTop = st.mapScale ? eh / (2 * tanHalf * st.mapScale) : 3.2;
    const up = new THREE.Vector3(0, 1, 0);
    const away = (t, off) => [t[0] + off[0] * k, t[1] + off[1] * k, t[2] + off[2] * k];
    const t1 = [this.drillX, this.surfY * 0.55, 0];
    const t2 = [this.drillX + 0.3, this.Yof(-320), this.D / 2 - 0.2];
    const t3 = [this.drillX + 0.4, this.Yof(-290), 0];
    const keys = [
      { p: [this.drillX, this.surfY + hTop, this.D / 2], t: [this.drillX, this.surfY, this.D / 2 - 0.0001], up: north },
      { p: away(t1, [-2.6, 2.0, 5.2]), t: t1, up },
      { p: away(t2, [1.0, 0.75, 3.0]), t: t2, up },
      { p: away(t3, [2.6, 1.1, 3.6]), t: t3, up },
    ];
    const c = clamp(st.cam) * (keys.length - 1);
    const i = Math.min(keys.length - 2, Math.floor(c));
    const f = easeInOut(c - i);
    const a = keys[i], b = keys[i + 1];
    const v = (u, w) => new THREE.Vector3(lerp(u[0], w[0], f), lerp(u[1], w[1], f), lerp(u[2], w[2], f));
    this.camera.position.copy(v(a.p, b.p));
    this.camera.up.copy(a.up.clone().lerp(b.up, f).normalize());
    this.camera.lookAt(v(a.t, b.t));
    // The visible rectangle (inside the insets) is the camera's frame; the canvas is a window onto it.
    this.camera.aspect = ew / eh;
    this.camera.setViewOffset(ew, eh, -st.insets.l, -st.insets.t, this.w, this.h);
    this.camera.updateProjectionMatrix();
    this.renderer.render(this.scene, this.camera);

    for (const l of this.labels) {
      const p = new THREE.Vector3(...l.p()).project(this.camera);
      const x = ((p.x + 1) / 2) * this.w, y = ((1 - p.y) / 2) * this.h;
      const a = l.a(st) * st.alpha * (p.z < 1 ? 1 : 0);
      l.e.style.opacity = a;
      l.e.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
      if (l.depth) l.e.textContent = `${Math.round(depthM)} m`;
    }
  }
}
