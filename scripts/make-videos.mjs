#!/usr/bin/env node
/**
 * Render vertical 1080×1920 timeline videos (MP4, H.264) for social media.
 *
 *   npm run build                       # once: videos render from the static export in out/
 *   npm run videos                      # every area in config/videos.json
 *   npm run videos -- --areas wellington,auckland --mode party --party green
 *
 * Options
 *   --areas a,b        area ids from config/videos.json (default: all)
 *   --mode m           winner (default) | bloc | party
 *   --party id         party for --mode party (default: labour)
 *   --vote electorate  use electorate (candidate) votes instead of party votes
 *   --site text        shown at the end, e.g. "atlas.example.nz"
 *   --frames n         render only the first n frames (quick test)
 *   --out dir          output folder (default: videos)
 *   --software-gl      force software WebGL (headless Linux servers without a GPU)
 *   --headed           show the browser while rendering
 *
 * Works on Windows, macOS and Linux. Needs Playwright's Chromium
 * (`npx playwright install chromium`) and ffmpeg: the bundled ffmpeg-static
 * binary, FFMPEG_PATH, or ffmpeg on PATH.
 */
import { createServer } from "node:http";
import { createReadStream, existsSync, mkdirSync, statSync } from "node:fs";
import { once } from "node:events";
import { dirname, extname, join, normalize, resolve, sep } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "out");

// ---------------------------------------------------------------- options
const argv = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : fallback;
};
const flag = (name) => argv.includes(`--${name}`);
const areasConfig = require(join(ROOT, "config", "videos.json"));
const wanted = (opt("areas", "") || areasConfig.areas.map((a) => a.id).join(",")).split(",").map((s) => s.trim()).filter(Boolean);
const unknown = wanted.filter((id) => !areasConfig.areas.some((a) => a.id === id));
if (unknown.length) fail(`Unknown area(s): ${unknown.join(", ")}. Available: ${areasConfig.areas.map((a) => a.id).join(", ")}`);
const mode = opt("mode", "winner");
const party = opt("party", "labour");
const vote = opt("vote", "party");
const site = opt("site", "");
const maxFrames = Number(opt("frames", "0")) || Infinity;
const outDir = resolve(ROOT, opt("out", "videos"));

function fail(msg) {
  console.error(`\n${msg}\n`);
  process.exit(1);
}

if (!existsSync(join(OUT, "video.html")) && !existsSync(join(OUT, "video", "index.html"))) fail("No static build found. Run `npm run build` first.");

let ffmpeg = process.env.FFMPEG_PATH || "";
if (!ffmpeg) {
  try {
    const p = require("ffmpeg-static");
    if (p && existsSync(p)) ffmpeg = p;
  } catch {
    /* fall back to PATH */
  }
}
ffmpeg ||= "ffmpeg";

let chromium;
try {
  ({ chromium } = require("@playwright/test"));
} catch {
  fail("Playwright is not installed. Run `npm install` and `npx playwright install chromium`.");
}

// ---------------------------------------------------------------- static server for out/
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".woff2": "font/woff2", ".woff": "font/woff", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon", ".txt": "text/plain" };
const server = createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  let p = normalize(join(OUT, decodeURIComponent(url.pathname)));
  if (!p.startsWith(OUT + sep) && p !== OUT) {
    res.writeHead(403).end();
    return;
  }
  const candidates = [p, `${p}.html`, join(p, "index.html")];
  const file = candidates.find((c) => existsSync(c) && statSync(c).isFile());
  if (!file) {
    res.writeHead(404).end("Not found");
    return;
  }
  res.writeHead(200, { "Content-Type": MIME[extname(file)] ?? "application/octet-stream" });
  createReadStream(file).pipe(res);
});
server.listen(0, "127.0.0.1");
await once(server, "listening");
const base = `http://127.0.0.1:${server.address().port}`;

// ---------------------------------------------------------------- render
mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({
  headless: !flag("headed"),
  args: flag("software-gl") ? ["--use-gl=angle", "--use-angle=swiftshader"] : ["--ignore-gpu-blocklist", "--enable-gpu-rasterization"],
});

for (const id of wanted) {
  const name = [id, mode === "party" ? party : mode, vote === "electorate" ? "electorate" : ""].filter(Boolean).join("-");
  const file = join(outDir, `${name}.mp4`);
  const page = await browser.newPage({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 });
  page.on("pageerror", (e) => console.error(`  page error: ${e.message}`));
  const q = new URLSearchParams({ area: id, mode, party, ...(vote === "electorate" ? { vk: "c" } : {}), ...(site ? { site } : {}) });
  await page.goto(`${base}/video?${q}`);
  await page.waitForFunction(() => window.__video !== undefined, null, { timeout: 60_000 });
  const info = await page.evaluate(() => window.__video.ready);
  const frames = Math.min(info.frames, maxFrames);
  console.log(`${name}: ${frames} frames at ${info.fps} fps → ${file}`);

  const enc = spawn(ffmpeg, ["-y", "-loglevel", "error", "-f", "image2pipe", "-c:v", "mjpeg", "-framerate", String(info.fps), "-i", "-", "-c:v", "libx264", "-preset", "slow", "-crf", "18", "-pix_fmt", "yuv420p", "-movflags", "+faststart", file], { stdio: ["pipe", "inherit", "inherit"] });
  enc.on("error", (e) => fail(`Could not start ffmpeg (${ffmpeg}): ${e.message}. Install ffmpeg or set FFMPEG_PATH.`));

  const started = Date.now();
  for (let f = 0; f < frames; f++) {
    await page.evaluate((n) => window.__video.render(n), f);
    const jpg = await page.screenshot({ type: "jpeg", quality: 95 });
    if (!enc.stdin.write(jpg)) await once(enc.stdin, "drain");
    if (f === frames - 1) await page.screenshot({ path: join(outDir, `${name}.jpg`), type: "jpeg", quality: 90 });
    if (f % 30 === 0 || f === frames - 1) {
      const pct = Math.round(((f + 1) / frames) * 100);
      const eta = Math.round((((Date.now() - started) / (f + 1)) * (frames - f - 1)) / 1000);
      process.stdout.write(`\r  ${String(pct).padStart(3)}%  frame ${f + 1}/${frames}  ~${eta}s left   `);
    }
  }
  enc.stdin.end();
  const [code] = await once(enc, "close");
  process.stdout.write("\n");
  if (code !== 0) fail(`ffmpeg exited with code ${code} for ${name}`);
  await page.close();
}

await browser.close();
server.close();
console.log(`Done. Videos are in ${outDir}`);
