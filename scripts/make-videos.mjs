#!/usr/bin/env node
/**
 * Render vertical 1080×1920 timeline videos (MP4, H.264) for social media.
 *
 *   npm run build                       # first, and again after changing the video page or data
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
 *   --parallel n       render n areas at once (default 3)
 *   --browser b        chromium (default, Playwright's) | msedge | chrome (installed browsers)
 *   --encoder e        libx264 (default, CPU) | nvenc (NVIDIA) | qsv (Intel) | amf (AMD)
 *   --headed           show the browser windows (default on macOS; elsewhere headless
 *                      Chromium uses the GPU too, and captures faster)
 *   --software-gl      force software WebGL (Linux servers without a GPU)
 *
 * Each distinct frame is drawn once and captured straight from the compositor
 * (DevTools Page.captureScreenshot, ~100x faster than page.screenshot()). Repeated
 * frames, the holds on each election and the outro, are over half of every video
 * and reuse the previous capture. Frames are piped into ffmpeg and written to
 * <name>.partial.mp4, which is renamed once complete, so a failed or interrupted
 * render never leaves a truncated MP4 behind.
 *
 * Works on Windows, macOS and Linux. Needs Playwright's Chromium
 * (`npx playwright install chromium`, or use --browser msedge on Windows) and
 * ffmpeg: the bundled ffmpeg-static binary, FFMPEG_PATH, or ffmpeg on PATH.
 */
import { createServer } from "node:http";
import { createReadStream, existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { once } from "node:events";
import { dirname, extname, join, normalize, relative, resolve, sep } from "node:path";
import { spawn, spawnSync } from "node:child_process";
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
const parallel = Math.max(1, Number(opt("parallel", "3")) || 3);
const browserName = opt("browser", "chromium");
const encoderName = opt("encoder", "libx264");
// Headless Chromium gets the GPU on Windows (D3D11) and Linux; macOS stays headed
// unless asked, as headless there is untested.
const headless = !flag("headed") && (flag("headless") || process.platform !== "darwin");

function fail(msg) {
  console.error(`\n${msg}\n`);
  process.exit(1);
}

/** Rejects with "timed out ... <what>" if the promise takes longer than ms. */
function withTimeout(promise, ms, what) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timed out after ${ms / 1000}s ${what}`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// ---------------------------------------------------------------- static build
if (!existsSync(join(OUT, "video.html")) && !existsSync(join(OUT, "video", "index.html"))) fail("No static build found. Run `npm run build` first.");

/** Newest file under path: [mtime, file]. */
function newest(path) {
  const s = statSync(path);
  if (!s.isDirectory()) return [s.mtimeMs, path];
  return readdirSync(path).reduce((best, f) => {
    const n = newest(join(path, f));
    return n[0] > best[0] ? n : best;
  }, [0, path]);
}
const builtAt = statSync(existsSync(join(OUT, "video.html")) ? join(OUT, "video.html") : join(OUT, "video", "index.html")).mtimeMs;
const [changedAt, changed] = ["app", "components", "lib", "config", join("public", "data", "manifest.json")]
  .map((p) => join(ROOT, p))
  .filter(existsSync)
  .map(newest)
  .reduce((a, b) => (b[0] > a[0] ? b : a), [0, ""]);
if (changedAt > builtAt) console.warn(`Note: out/ is older than ${relative(ROOT, changed)}. Run \`npm run build\` to include recent changes.\n`);

// ---------------------------------------------------------------- ffmpeg
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

// ffmpeg encoder settings (all produce H.264 yuv420p MP4 for social platforms).
const ENCODERS = {
  libx264: ["-c:v", "libx264", "-preset", "medium", "-crf", "18"],
  nvenc: ["-c:v", "h264_nvenc", "-preset", "p5", "-rc", "vbr", "-cq", "19", "-b:v", "0"],
  qsv: ["-c:v", "h264_qsv", "-global_quality", "20"],
  amf: ["-c:v", "h264_amf", "-quality", "quality", "-rc", "cqp", "-qp_i", "18", "-qp_p", "20"],
};
if (!ENCODERS[encoderName]) fail(`Unknown --encoder ${encoderName}. Use one of: ${Object.keys(ENCODERS).join(", ")}`);
// Check ffmpeg and the encoder on a few blank frames before starting a browser.
{
  const probe = spawnSync(ffmpeg, ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "color=c=black:s=1080x1920:r=30:d=0.1", ...ENCODERS[encoderName], "-pix_fmt", "yuv420p", "-f", "null", "-"], { encoding: "utf8", windowsHide: true });
  if (probe.error) fail(`Could not start ffmpeg (${ffmpeg}): ${probe.error.message}. Install ffmpeg or set FFMPEG_PATH.`);
  const why = (probe.stderr || "").trim().split(/\r?\n/).pop();
  if (probe.status !== 0) fail(`ffmpeg cannot encode with ${encoderName}: ${why}${encoderName !== "libx264" ? "\nIs it supported by your GPU and driver? Try --encoder libx264." : ""}`);
}

/** An ffmpeg process encoding piped JPEG frames into file. */
function startEncoder(file, fps) {
  const proc = spawn(ffmpeg, ["-y", "-loglevel", "error", "-f", "image2pipe", "-c:v", "mjpeg", "-framerate", String(fps), "-i", "-", ...ENCODERS[encoderName], "-pix_fmt", "yuv420p", "-movflags", "+faststart", file], {
    stdio: ["pipe", "ignore", "pipe"],
    windowsHide: true,
  });
  let stderr = "";
  let code = null;
  proc.stderr.on("data", (d) => (stderr = (stderr + d).slice(-2000)));
  const exited = new Promise((res) => {
    proc.on("error", (e) => {
      stderr += e.message;
      code ??= -1;
      res(code);
    });
    proc.on("close", (c) => {
      code ??= c ?? -1;
      res(code);
    });
  });
  // Writing to an ffmpeg that has died raises EPIPE; its exit code and stderr are reported instead.
  proc.stdin.on("error", () => {});
  const failure = () => new Error(`ffmpeg exited with code ${code}: ${stderr.trim() || "no message"}`);
  return {
    async write(buf) {
      if (code !== null) throw failure();
      // Wait for ffmpeg to catch up, unless it exits meanwhile.
      if (!proc.stdin.write(buf)) await Promise.race([once(proc.stdin, "drain").catch(() => {}), exited]);
      if (code !== null) throw failure();
    },
    async finish() {
      proc.stdin.end();
      if ((await exited) !== 0) throw failure();
    },
    kill: () => proc.kill(),
  };
}

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

// ---------------------------------------------------------------- browser
mkdirSync(outDir, { recursive: true });
const gpuArgs = flag("software-gl")
  ? ["--use-gl=angle", "--use-angle=swiftshader"]
  : [
      "--ignore-gpu-blocklist",
      "--enable-gpu-rasterization",
      // Ask for the discrete GPU on machines with two (laptops, desktops with an iGPU).
      "--force_high_performance_gpu",
      ...(process.platform === "win32" ? ["--use-angle=d3d11"] : process.platform === "darwin" ? ["--use-angle=metal"] : []),
    ];
const browser = await chromium.launch({
  headless,
  // "chromium" uses Playwright's full browser (new headless mode when headless);
  // "msedge"/"chrome" use the installed browser.
  channel: browserName,
  // Ctrl+C is handled below, so unfinished videos are removed before exiting.
  handleSIGINT: false,
  args: [
    ...gpuArgs,
    // Keep rendering at full speed when a window is covered or minimised.
    "--disable-backgrounding-occluded-windows",
    "--disable-renderer-backgrounding",
    "--disable-background-timer-throttling",
  ],
});

let stopping = false;
process.on("SIGINT", () => {
  if (stopping) process.exit(130);
  stopping = true;
  console.log("\nStopping: removing unfinished videos (Ctrl+C again to quit at once)...");
  browser.close().catch(() => {});
});

// ---------------------------------------------------------------- render
async function renderArea(id) {
  const name = [id, mode === "party" ? party : mode, vote === "electorate" ? "electorate" : ""].filter(Boolean).join("-");
  const file = join(outDir, `${name}.mp4`);
  const partial = join(outDir, `${name}.partial.mp4`);
  const started = Date.now();
  const page = await browser.newPage({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 });
  page.on("pageerror", (e) => console.error(`  ${name}: page error: ${e.message}`));
  page.on("console", (m) => m.type() === "error" && console.error(`  ${name}: console: ${m.text()}`));
  let enc = null;
  let keepPartial = false;
  try {
    const q = new URLSearchParams({ area: id, mode, party, ...(vote === "electorate" ? { vk: "c" } : {}), ...(site ? { site } : {}) });
    await page.goto(`${base}/video?${q}`);
    await page.waitForFunction(() => window.__video !== undefined, null, { timeout: 60_000 });
    const info = await withTimeout(
      page.evaluate(() => window.__video.ready),
      120_000,
      "loading the data and starting WebGL",
    );
    if (!Array.isArray(info.keys)) throw new Error("out/ was built from an older video page. Run `npm run build`.");
    const frames = Math.min(info.frames, maxFrames);
    const distinct = info.keys.slice(0, frames).filter((k, f) => f === 0 || k !== info.keys[f - 1]).length;
    const softwareNote = info.software && !flag("software-gl") ? `  <-- SOFTWARE rendering (slow): check GPU drivers${headless ? " or try --headed" : ""}` : "";
    console.log(`${name}: ${frames} frames (${distinct} distinct) at ${info.fps} fps, WebGL: ${info.gpu}${softwareNote}`);

    enc = startEncoder(partial, info.fps);
    const cdp = await page.context().newCDPSession(page);
    let jpg = null;
    let lastReport = 0;
    for (let f = 0; f < frames; f++) {
      if (stopping) throw new Error("stopped");
      if (f === 0 || info.keys[f] !== info.keys[f - 1]) {
        // The first frame uploads every election's geometry to the GPU, so allow it longer.
        await withTimeout(
          page.evaluate((n) => window.__video.render(n), f),
          f === 0 ? 120_000 : 30_000,
          `drawing frame ${f}`,
        );
        const { data } = await withTimeout(cdp.send("Page.captureScreenshot", { format: "jpeg", quality: 92, optimizeForSpeed: true }), 30_000, `capturing frame ${f}`);
        jpg = Buffer.from(data, "base64");
      }
      await enc.write(jpg);
      const pct = Math.floor(((f + 1) / frames) * 10) * 10;
      if (pct > lastReport || f === frames - 1) {
        lastReport = pct;
        const fps = (f + 1) / ((Date.now() - started) / 1000);
        console.log(`  ${name}: ${String(pct).padStart(3)}%  (${fps.toFixed(1)} frames/s)`);
      }
    }
    await enc.finish();
    try {
      writeFileSync(join(outDir, `${name}.jpg`), jpg);
    } catch (e) {
      console.warn(`  ${name}: could not write the poster image: ${e.message}`);
    }
    try {
      renameSync(partial, file);
    } catch (e) {
      // Windows locks files that are open, e.g. in a video player.
      keepPartial = true;
      throw new Error(`could not replace ${file} (${e.code}); is it open in another program? The new video is ${partial}`);
    }
    const seconds = Math.round((Date.now() - started) / 1000);
    console.log(`  ${name}: done in ${seconds}s -> ${file}`);
    return { name, seconds };
  } catch (e) {
    enc?.kill();
    if (!keepPartial) rmSync(partial, { force: true });
    throw new Error(`${name}: ${stopping ? "stopped" : e.message}`);
  } finally {
    await withTimeout(page.close(), 10_000, "closing the page").catch(() => {});
  }
}

const started = Date.now();
const queue = [...wanted];
const done = [];
const failed = [];
await Promise.all(
  Array.from({ length: Math.min(parallel, queue.length) }, async () => {
    while (queue.length && !stopping) {
      try {
        done.push(await renderArea(queue.shift()));
      } catch (e) {
        failed.push(e.message);
        if (!stopping) console.error(`  ${e.message}`);
      }
    }
  }),
);

await withTimeout(browser.close(), 15_000, "closing the browser").catch(() => {});
server.close();
const total = Math.round((Date.now() - started) / 1000);
if (done.length) console.log(`\n${done.length} video${done.length === 1 ? "" : "s"} in ${outDir} (${total}s)`);
if (failed.length && !stopping) console.error(`\nFailed:\n${failed.map((m) => `  ${m}`).join("\n")}`);
// Exit explicitly: on Windows, Node was seen to stay alive after Playwright closed a headless browser.
process.exit(stopping ? 130 : failed.length ? 1 : 0);
