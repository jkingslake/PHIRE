// Render the story to a vertical (1080x1920) MP4 by stepping the page's timeline frame by frame.
//
//   cd story && npm install && npm run video
//   node scripts/render_video.mjs --version short                    # the one-minute version
//   node scripts/render_video.mjs --gpu --voice                       # with narration (run make_voice.py first)
//   node scripts/render_video.mjs --fps 30 --out video/phire_full.mp4
//   node scripts/render_video.mjs --from 20 --to 30 --fps 10 --out video/preview.mp4   # a quick look
//   node scripts/render_video.mjs --stills 3,25,60 --out video/stills                  # PNG frames
//
// Uses the Chrome installed on this machine (playwright-core does not download a browser) and the
// ffmpeg binary from the ffmpeg-static package.

import { createServer } from "node:http";
import { readFile, mkdir, writeFile, rename, rm } from "node:fs/promises";
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
const VOICE = Boolean(args.voice); // narration from scripts/make_voice.py, mixed in after the frames
const OUT = path.resolve(ROOT, args.out ?? `video/phire_${VERSION}${VOICE ? "_voice" : ""}.mp4`);
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
await page.goto(`http://127.0.0.1:${port}/index.html?video&v=${VERSION}${VOICE ? "&voice" : ""}`, { waitUntil: "load" });
await page.evaluate(() => window.__story.ready);
const duration = await page.evaluate(() => window.__story.duration);
console.log(`${VERSION}${VOICE ? " with narration" : ""}: ${duration.toFixed(1)} s`);

const run = (argv) =>
  new Promise((resolve, reject) => {
    const p = spawn(ffmpegPath, argv, { stdio: ["ignore", "inherit", "inherit"] });
    p.on("close", (code) => (code ? reject(new Error(`ffmpeg exited with ${code}`)) : resolve()));
  });

// Mix the narration clips that fall in [t0, t1] onto the silent video: each clip delayed to its start, the mix
// normalised to -14 LUFS, the video stream copied.
async function addNarration(silent, out, clips, t0, t1) {
  const inputs = [], chains = [];
  for (const c of clips) {
    if (c.start >= t1 || c.start + c.seconds <= t0) continue;
    const k = chains.length;
    const cut = c.start < t0 ? `atrim=start=${(t0 - c.start).toFixed(3)},asetpts=PTS-STARTPTS,` : "";
    const delay = Math.max(0, Math.round((c.start - t0) * 1000));
    inputs.push("-i", path.join(ROOT, c.file));
    chains.push(`[${k + 1}:a]${cut}aresample=48000,adelay=${delay}:all=1[a${k}]`);
  }
  if (!chains.length) return rename(silent, out);
  const mix = `${chains.join(";")};${chains.map((_, k) => `[a${k}]`).join("")}amix=inputs=${chains.length}:normalize=0:dropout_transition=0,apad,loudnorm=I=-14:TP=-1.5:LRA=11[aout]`;
  await run(["-y", "-loglevel", "error", "-i", silent, ...inputs, "-filter_complex", mix, "-map", "0:v", "-map", "[aout]",
    "-c:v", "copy", "-c:a", "aac", "-b:a", "160k", "-ar", "48000", "-shortest", "-movflags", "+faststart", out]);
  await rm(silent);
}

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
  const target = VOICE ? OUT.replace(/\.mp4$/, ".silent.mp4") : OUT;
  const ff = spawn(
    ffmpegPath,
    ["-y", "-loglevel", "error", "-f", "image2pipe", "-framerate", String(FPS), "-c:v", "mjpeg", "-i", "-",
     "-c:v", "libx264", "-preset", "slow", "-crf", "21", "-pix_fmt", "yuv420p", "-movflags", "+faststart", target],
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
  if (VOICE) await addNarration(target, OUT, await page.evaluate(() => window.__story.voiceClips), t0, t1);
  console.log(`\nwrote ${OUT}`);
}

await browser.close();
server.close();
