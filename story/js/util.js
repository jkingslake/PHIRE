export const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
export const lerp = (a, b, t) => a + (b - a) * t;
export const smooth = (t) => {
  t = clamp(t);
  return t * t * (3 - 2 * t);
};
export const easeInOut = (t) => {
  t = clamp(t);
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
};
export const easeOut = (t) => 1 - Math.pow(1 - clamp(t), 3);

// Progress of x through [a, b], clamped to 0-1.
export const ramp = (x, a, b) => clamp((x - a) / (b - a));

// Smooth zoom-and-pan between two views [cx, cy, span] (van Wijk and Nuij 2003, as in d3-interpolate).
// The camera pulls back as it travels so long moves stay readable.
export function interpolateZoom(p0, p1) {
  const rho = Math.SQRT2, rho2 = 2, rho4 = 4, eps = 1e-12;
  const [ux0, uy0, w0] = p0;
  const [ux1, uy1, w1] = p1;
  const dx = ux1 - ux0, dy = uy1 - uy0, d2 = dx * dx + dy * dy;
  if (d2 < eps) {
    const S = Math.log(w1 / w0) / rho;
    return (t) => [ux0 + t * dx, uy0 + t * dy, w0 * Math.exp(rho * t * S)];
  }
  const d1 = Math.sqrt(d2);
  const b0 = (w1 * w1 - w0 * w0 + rho4 * d2) / (2 * w0 * rho2 * d1);
  const b1 = (w1 * w1 - w0 * w0 - rho4 * d2) / (2 * w1 * rho2 * d1);
  const r0 = Math.log(Math.sqrt(b0 * b0 + 1) - b0);
  const r1 = Math.log(Math.sqrt(b1 * b1 + 1) - b1);
  const S = (r1 - r0) / rho;
  return (t) => {
    const s = t * S;
    const c0 = Math.cosh(r0);
    const u = (w0 / (rho2 * d1)) * (c0 * Math.tanh(rho * s + r0) - Math.sinh(r0));
    return [ux0 + u * dx, uy0 + u * dy, (w0 * c0) / Math.cosh(rho * s + r0)];
  };
}

export async function loadJSON(url) {
  const r = await fetch(url, { cache: "no-cache" });
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  return r.json();
}

export function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = "async";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`could not load ${url}`));
    img.src = url;
  });
}

export const fmtInt = (n) => Math.round(n).toLocaleString("en-GB");

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const fmtDate = (d) => `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
