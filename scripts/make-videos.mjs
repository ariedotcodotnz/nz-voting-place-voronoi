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
 *   --parallel n       render n areas at once (default 2)
 *   --browser b        chromium (default, Playwright's) | msedge | chrome (installed browsers)
 *   --encoder e        libx264 (default, CPU) | nvenc (NVIDIA) | qsv (Intel) | amf (AMD)
 *   --headless         no browser window (default on Linux; Windows/macOS show a window,
 *                      which guarantees GPU rendering)
 *   --software-gl      force software WebGL (Linux servers without a GPU)
 *
 * Frames are captured straight from the compositor (DevTools Page.captureScreenshot),
 * which is ~100x faster than page.screenshot(), and piped into ffmpeg.
 *
 * Works on Windows, macOS and Linux. Needs Playwright's Chromium
 * (`npx playwright install chromium`, or use --browser msedge on Windows) and
 * ffmpeg: the bundled ffmpeg-static binary, FFMPEG_PATH, or ffmpeg on PATH.
 */
import { createServer } from "node:http";
import { createReadStream, existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
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
const parallel = Math.max(1, Number(opt("parallel", "2")) || 2);
const browserName = opt("browser", "chromium");
const encoderName = opt("encoder", "libx264");
// A visible window always gets the GPU; headless is the default only on Linux.
const headless = flag("headless") || (process.platform === "linux" && !flag("headed"));

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
const gpuArgs = flag("software-gl")
  ? ["--use-gl=angle", "--use-angle=swiftshader"]
  : ["--ignore-gpu-blocklist", "--enable-gpu-rasterization", ...(process.platform === "win32" ? ["--use-angle=d3d11"] : process.platform === "darwin" ? ["--use-angle=metal"] : [])];
const browser = await chromium.launch({
  headless,
  // "chromium" uses Playwright's full browser (new headless mode when headless);
  // "msedge"/"chrome" use the installed browser.
  channel: browserName,
  args: [
    ...gpuArgs,
    // Keep rendering at full speed when the window is covered or minimised.
    "--disable-backgrounding-occluded-windows",
    "--disable-renderer-backgrounding",
    "--disable-background-timer-throttling",
  ],
});

// ffmpeg encoder settings (all produce H.264 yuv420p MP4 for social platforms).
const ENCODERS = {
  libx264: ["-c:v", "libx264", "-preset", "medium", "-crf", "18"],
  nvenc: ["-c:v", "h264_nvenc", "-preset", "p5", "-rc", "vbr", "-cq", "19", "-b:v", "0"],
  qsv: ["-c:v", "h264_qsv", "-global_quality", "20"],
  amf: ["-c:v", "h264_amf", "-quality", "quality", "-rc", "cqp", "-qp_i", "18", "-qp_p", "20"],
};
if (!ENCODERS[encoderName]) fail(`Unknown --encoder ${encoderName}. Use one of: ${Object.keys(ENCODERS).join(", ")}`);

async function renderArea(id) {
  const name = [id, mode === "party" ? party : mode, vote === "electorate" ? "electorate" : ""].filter(Boolean).join("-");
  const file = join(outDir, `${name}.mp4`);
  const page = await browser.newPage({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 });
  page.on("pageerror", (e) => console.error(`  ${name}: page error: ${e.message}`));
  const q = new URLSearchParams({ area: id, mode, party, ...(vote === "electorate" ? { vk: "c" } : {}), ...(site ? { site } : {}) });
  await page.goto(`${base}/video?${q}`);
  await page.waitForFunction(() => window.__video !== undefined, null, { timeout: 60_000 });
  const info = await page.evaluate(() => window.__video.ready);
  const renderer = await page.evaluate(() => {
    const gl = document.createElement("canvas").getContext("webgl2");
    const ext = gl && gl.getExtension("WEBGL_debug_renderer_info");
    return gl ? String(gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER)) : "no WebGL";
  });
  const software = /swiftshader|llvmpipe|basic render|software/i.test(renderer);
  const frames = Math.min(info.frames, maxFrames);
  console.log(`${name}: ${frames} frames at ${info.fps} fps, WebGL: ${renderer}${software && !flag("software-gl") ? "  <-- SOFTWARE rendering (slow): check GPU drivers or try --browser msedge" : ""}`);

  const enc = spawn(ffmpeg, ["-y", "-loglevel", "error", "-f", "image2pipe", "-c:v", "mjpeg", "-framerate", String(info.fps), "-i", "-", ...ENCODERS[encoderName], "-pix_fmt", "yuv420p", "-movflags", "+faststart", file], { stdio: ["pipe", "inherit", "inherit"] });
  const closed = once(enc, "close");
  enc.on("error", (e) => fail(`Could not start ffmpeg (${ffmpeg}): ${e.message}. Install ffmpeg or set FFMPEG_PATH.`));
  // Capture from the compositor via DevTools: much faster than page.screenshot().
  const cdp = await page.context().newCDPSession(page);
  const started = Date.now();
  let lastReport = 0;
  for (let f = 0; f < frames; f++) {
    await page.evaluate((n) => window.__video.render(n), f);
    const { data } = await cdp.send("Page.captureScreenshot", { format: "jpeg", quality: 92, optimizeForSpeed: true });
    const jpg = Buffer.from(data, "base64");
    if (!enc.stdin.write(jpg)) await once(enc.stdin, "drain");
    if (f === frames - 1) writeFileSync(join(outDir, `${name}.jpg`), jpg);
    const pct = Math.floor(((f + 1) / frames) * 10) * 10;
    if (pct > lastReport || f === frames - 1) {
      lastReport = pct;
      const fps = (f + 1) / ((Date.now() - started) / 1000);
      console.log(`  ${name}: ${String(pct).padStart(3)}%  (${fps.toFixed(1)} frames/s)`);
    }
  }
  enc.stdin.end();
  const [code] = await closed;
  if (code !== 0) fail(`ffmpeg exited with code ${code} for ${name}${encoderName !== "libx264" ? ` (is the ${encoderName} encoder supported by your GPU/driver? try --encoder libx264)` : ""}`);
  console.log(`  ${name}: done in ${Math.round((Date.now() - started) / 1000)}s -> ${file}`);
  await page.close();
}

const queue = [...wanted];
await Promise.all(
  Array.from({ length: Math.min(parallel, queue.length) }, async () => {
    while (queue.length) await renderArea(queue.shift());
  }),
);

await browser.close();
server.close();
console.log(`Done. Videos are in ${outDir}`);
