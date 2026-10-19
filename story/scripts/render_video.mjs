// Render the story to a vertical (1080x1920) MP4 by stepping the page's timeline frame by frame.
//
//   cd story && npm install && npm run video
//   node scripts/render_video.mjs --version short                    # the one-minute version
//   node scripts/render_video.mjs --fps 30 --out video/phire_full.mp4
//   node scripts/render_video.mjs --from 20 --to 30 --fps 10 --out video/preview.mp4   # a quick look
//   node scripts/render_video.mjs --stills 3,25,60 --out video/stills                  # PNG frames
//
// Uses the Chrome installed on this machine (playwright-core does not download a browser) and the
// ffmpeg binary from the ffmpeg-static package.

import { createServer } from "node:http";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import ffmpegPath from "ffmpeg-static";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith("--") ? [...acc, [a.slice(2), all[i + 1]?.startsWith("--") ? true : all[i + 1] ?? true]] : acc), [])
);
const FPS = +(args.fps ?? 30);
const VERSION = args.version ?? "full"; // full or short
const OUT = path.resolve(ROOT, args.out ?? (VERSION === "short" ? "video/phire_short.mp4" : "video/phire_full.mp4"));
const W = 540, H = 960, SCALE = 2; // CSS viewport and device scale: 1080x1920 frames

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json", ".webp": "image/webp", ".png": "image/png", ".jpg": "image/jpeg" };

function serve() {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, "http://x");
    const file = path.join(ROOT, decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname));
    if (!file.startsWith(ROOT)) return res.writeHead(403).end();
    try {
      const body = await readFile(file);
      res.writeHead(200, { "content-type": TYPES[path.extname(file)] || "application/octet-stream" }).end(body);
    } catch {
      res.writeHead(404).end();
    }
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

const server = await serve();
const port = server.address().port;
// --gpu uses the machine's GPU for the 3-D frames (much faster); the default software renderer works anywhere
const GL = args.gpu ? ["--use-angle=metal", "--enable-gpu"] : ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"];
const browser = await chromium.launch({
  channel: "chrome",
  headless: true,
  args: [...GL, "--ignore-gpu-blocklist", "--force-color-profile=srgb", "--hide-scrollbars"],
});
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: SCALE });
page.on("console", (m) => m.type() === "error" && console.error("page:", m.text()));
page.on("pageerror", (e) => console.error("page error:", e.message));
await page.goto(`http://127.0.0.1:${port}/index.html?video&v=${VERSION}`, { waitUntil: "load" });
await page.evaluate(() => window.__story.ready);
const duration = await page.evaluate(() => window.__story.duration);

const renderAt = (t) =>
  page.evaluate(async (t) => {
    await window.__story.renderAt(t);
    await Promise.all([...document.querySelectorAll("img")].map((i) => (i.complete ? null : i.decode().catch(() => {}))));
  }, t);

if (args.stills) {
  await mkdir(OUT, { recursive: true });
  for (const s of String(args.stills).split(",").map(Number)) {
    await renderAt(s);
    const file = path.join(OUT, `frame_${String(s).padStart(6, "0")}.png`);
    await writeFile(file, await page.screenshot({ type: "png" }));
    console.log(file);
  }
} else {
  const t0 = +(args.from ?? 0);
  const t1 = Math.min(+(args.to ?? duration), duration);
  const n = Math.round((t1 - t0) * FPS);
  await mkdir(path.dirname(OUT), { recursive: true });
  const ff = spawn(
    ffmpegPath,
    ["-y", "-loglevel", "error", "-f", "image2pipe", "-framerate", String(FPS), "-c:v", "mjpeg", "-i", "-",
     "-c:v", "libx264", "-preset", "slow", "-crf", "21", "-pix_fmt", "yuv420p", "-movflags", "+faststart", OUT],
    { stdio: ["pipe", "inherit", "inherit"] }
  );
  const started = Date.now();
  for (let i = 0; i < n; i++) {
    await renderAt(t0 + i / FPS);
    const jpg = await page.screenshot({ type: "jpeg", quality: 95 });
    if (!ff.stdin.write(jpg)) await new Promise((r) => ff.stdin.once("drain", r));
    if (i % FPS === 0) {
      const el = (Date.now() - started) / 1000;
      process.stdout.write(`\r${(t0 + i / FPS).toFixed(1)}/${t1.toFixed(1)} s  (${(el / (i + 1) * (n - i - 1)).toFixed(0)} s left)   `);
    }
  }
  ff.stdin.end();
  await new Promise((r) => ff.on("close", r));
  console.log(`\nwrote ${OUT}`);
}

await browser.close();
server.close();
