// Write SCRIPT.md: the words of the four outputs (the full and short articles, the full and short videos), taken
// from js/beats.js, with the times at which each caption is on screen in the videos.
//
//   cd story && npm run script
//
// The video timings follow Story.state() in js/main.js: a caption shows from the start of its beat to the end (or to
// `split` when the beat has a second caption); the opening caption waits for the title card and the closing one
// gives way to it.

import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { VERSIONS, ORDER, TITLE, SUBTITLE, DEK } from "../js/beats.js";

const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../SCRIPT.md");

const SCENES = {
  intro: "Opening",
  icesheet: "The ice sheet",
  hir: "Henry Ice Rise",
  season1: "The 2013/14 survey",
  discovery: "The discovery",
  mystery: "The mystery",
  season2: "The 2014/15 survey",
  fl5: "Line FL5",
  pattern: "Where the crevasses are",
  rumples: "Crevasses today",
  hypothesis: "A hypothesis",
  model: "The ice-sheet model",
  stakes: "Why it matters",
  drillsite: "The drill site",
  block: "Drilling to the bed",
  temperature: "Temperature",
  end: "Closing",
};

const markdown = (html) =>
  html
    .replace(/\s+/g, " ")
    .replace(/<\/p>\s*<p>/g, "\n\n")
    .replace(/<\/?p>/g, "")
    .replace(/<strong>(.*?)<\/strong>/g, "**$1**")
    .replace(/<em>(.*?)<\/em>/g, "*$1*")
    .replace(/<span class="key[^"]*">(.*?)<\/span>/g, "$1")
    .replace(/&nbsp;/g, " ")
    .trim();

const clock = (s) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, "0")}`;

function article(version, file) {
  const lines = [`**${TITLE}**: ${SUBTITLE}`, "", `*${DEK}*`, ""];
  for (const b of VERSIONS[version]) {
    if (!b.html) continue;
    lines.push(`### ${SCENES[b.id]}`, "", markdown(b.html), "");
  }
  return [`Page: \`story/${file}\`.`, "", ...lines];
}

function video(version) {
  const byId = Object.fromEntries(VERSIONS[version].map((b) => [b.id, b]));
  const beats = ORDER.map((id) => byId[id]).filter((b) => b && b.video !== false && b.dur > 0);
  const rows = [];
  let t = 0;
  for (const b of beats) {
    const t0 = t, t1 = t + b.dur;
    const at = (f) => t0 + f * b.dur;
    if (b.id === "intro") {
      rows.push([0, at(b.caption ? 0.58 : 0.85), "Opening", `*Title card:* ${TITLE}, ${SUBTITLE}`]);
      if (b.caption) rows.push([at(0.55), t1, SCENES[b.id], b.caption]);
    } else if (b.id === "end") {
      rows.push([t0, at(0.55), SCENES[b.id], b.caption]);
      rows.push([at(0.5), t1, SCENES[b.id], `*Title card:* ${TITLE}, ${SUBTITLE}`]);
    } else if (b.caption2) {
      rows.push([t0, at(b.split ?? 0.6), SCENES[b.id], b.caption]);
      rows.push([at(b.split ?? 0.6), t1, SCENES[b.id], b.caption2]);
    } else {
      rows.push([t0, t1, SCENES[b.id], b.caption]);
    }
    t = t1;
  }
  return [
    `Length ${clock(t)} (1080 × 1920, no sound). Rendered to \`story/video/phire_${version}.mp4\` by \`npm run video\`.`,
    "",
    "| On screen | Scene | Caption |",
    "|---|---|---|",
    ...rows.map(([a, b, scene, text]) => `| ${clock(a)}–${clock(b)} | ${scene} | ${text.replace(/\|/g, "\\|")} |`),
    "",
  ];
}

const doc = [
  "# PHIRE story: script",
  "",
  "The words of the four outputs: the full and short scroll articles, and the full and short videos. This file is",
  "written from `js/beats.js` by `npm run script`; edit the words there, then run it again.",
  "",
  "## 1. Full article",
  "",
  ...article("full", "index.html"),
  "## 2. Short article",
  "",
  ...article("short", "short.html"),
  "## 3. Full video",
  "",
  ...video("full"),
  "## 4. Short video",
  "",
  ...video("short"),
];

await writeFile(OUT, doc.join("\n"));
console.log(`wrote ${OUT}`);
