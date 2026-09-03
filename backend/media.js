const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const { spawn } = require("child_process");
const sharp = require("sharp");
const ffmpegPath = require("ffmpeg-static");

const IMAGE_TARGET_BYTES = 450 * 1024; // land inside the ~200KB-500KB band
const IMAGE_MIN_QUALITY = 40;
const VIDEO_TARGET_BYTES = 8 * 1024 * 1024; // aim for the middle of the 5-10MB band
const VIDEO_MIN_BYTES = 5 * 1024 * 1024;
const VIDEO_MAX_BYTES = 10 * 1024 * 1024;
const AUDIO_BITRATE_KBPS = 64;

// Windows (and some antivirus/indexer setups) can briefly hold a lock on a
// file right after sharp/ffmpeg finish reading it, so an immediate unlink()
// throws EBUSY/EPERM even though the process is done with it. Retry with a
// short backoff instead of crashing the request over what's ultimately just
// leftover temp-file cleanup.
async function safeUnlink(filePath, { retries = 8, delayMs = 150 } = {}) {
  for (let attempt = 0; attempt < retries; attempt += 1) {
    try {
      await fsp.rm(filePath, { force: true });
      return;
    } catch (error) {
      if (error.code === "ENOENT") return;
      if ((error.code === "EBUSY" || error.code === "EPERM") && attempt < retries - 1) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        continue;
      }
      console.warn(`[media] Could not remove ${filePath}: ${error.message}`);
      return;
    }
  }
}

async function safeRename(fromPath, toPath, { retries = 8, delayMs = 150 } = {}) {
  for (let attempt = 0; attempt < retries; attempt += 1) {
    try {
      await fsp.rename(fromPath, toPath);
      return;
    } catch (error) {
      if ((error.code === "EBUSY" || error.code === "EPERM") && attempt < retries - 1) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        continue;
      }
      throw error;
    }
  }
}

async function readDimensions(filePath) {
  try {
    const meta = await sharp(filePath).metadata();
    return { width: meta.width || null, height: meta.height || null };
  } catch {
    return { width: null, height: null };
  }
}

async function compressImage(inputPath, outputDir, baseName, { trim = false } = {}) {
  const outputPath = path.join(outputDir, `${baseName}.webp`);
  const originalSize = fs.statSync(inputPath).size;
  try {
    let dimension = 2400;
    let quality = 82;
    let lastMeta = null;
    // Quality first, then — for very large or busy source images where
    // quality alone can't reach the target — progressively shrink the
    // dimensions too, the same two-lever approach the browser-side
    // compressor uses before the file is even uploaded.
    for (let attempt = 0; attempt < 9; attempt += 1) {
      let pipeline = sharp(inputPath).rotate();
      // Logo uploads are frequently exported with a lot of blank canvas
      // around the actual mark (a square artboard around a wide horizontal
      // lockup, for example) — trim that away first so the real artwork
      // fills whatever size it's displayed at, instead of shrinking along
      // with a mostly-empty box.
      if (trim) pipeline = pipeline.trim({ threshold: 10 });
      lastMeta = await pipeline
        .resize({ width: dimension, height: dimension, fit: "inside", withoutEnlargement: true })
        .webp({ quality })
        .toFile(outputPath);
      if (fs.statSync(outputPath).size <= IMAGE_TARGET_BYTES) break;
      if (quality > IMAGE_MIN_QUALITY) quality -= 8; else dimension = Math.round(dimension * 0.8);
    }
    return { outputPath, mime: "image/webp", compressed: true, quality, originalSize, width: lastMeta?.width || null, height: lastMeta?.height || null };
  } catch (error) {
    // sharp is a native module — on some machines/OSes the prebuilt binary
    // can fail to load (wrong Node ABI, missing libvips, etc). Rather than
    // failing the whole upload, fall back to storing the original file
    // untouched so the platform keeps working; compression just won't
    // happen until the environment issue is resolved.
    console.error("[media] Image compression failed, storing the original file instead:", error.message);
    const extension = path.extname(inputPath) || ".jpg";
    const fallbackPath = path.join(outputDir, `${baseName}${extension}`);
    fs.copyFileSync(inputPath, fallbackPath);
    const dims = await readDimensions(fallbackPath);
    return { outputPath: fallbackPath, mime: `image/${extension.replace(".", "") || "jpeg"}`, compressed: false, originalSize, reason: "compression-failed", ...dims };
  }
}

// Reads the source duration via ffmpeg's own stderr banner (Duration: HH:MM:SS.ms)
// instead of pulling in a separate ffprobe dependency.
function getDuration(inputPath) {
  return new Promise((resolve) => {
    const proc = spawn(ffmpegPath, ["-i", inputPath], { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    proc.stdout?.on("data", () => {});
    proc.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    proc.on("error", () => resolve(null));
    proc.on("close", () => {
      const match = stderr.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
      if (!match) return resolve(null);
      const [, hours, minutes, seconds] = match;
      resolve(Number(hours) * 3600 + Number(minutes) * 60 + Number(seconds));
    });
  });
}

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpegPath, args, { stdio: "ignore" });
    proc.on("error", reject);
    proc.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited with code ${code}`))));
  });
}

async function transcodeVideo(inputPath, outputDir, baseName) {
  const outputPath = path.join(outputDir, `${baseName}.mp4`);
  if (!ffmpegPath) return { outputPath: inputPath, mime: "video/mp4", compressed: false, reason: "ffmpeg unavailable" };
  const originalSize = fs.statSync(inputPath).size;
  const duration = await getDuration(inputPath);

  // Target a specific final file size by computing the bitrate that gets us
  // there given the clip's real duration, instead of a fixed CRF that could
  // land anywhere depending on footage complexity and length.
  const encode = (targetBytes) => {
    let args;
    if (duration && duration > 0) {
      const totalKbps = Math.floor((targetBytes * 8) / duration / 1000);
      const videoKbps = Math.max(200, totalKbps - AUDIO_BITRATE_KBPS);
      args = [
        "-y", "-i", inputPath,
        "-vf", "scale='min(1280,iw)':-2",
        "-c:v", "libx264", "-preset", "veryfast",
        "-b:v", `${videoKbps}k`, "-maxrate", `${Math.round(videoKbps * 1.4)}k`, "-bufsize", `${videoKbps * 2}k`,
        "-c:a", "aac", "-b:a", `${AUDIO_BITRATE_KBPS}k`, "-movflags", "+faststart",
        outputPath
      ];
    } else {
      // Duration couldn't be read — fall back to a fixed, moderate quality target.
      args = [
        "-y", "-i", inputPath,
        "-vf", "scale='min(1280,iw)':-2",
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "28",
        "-c:a", "aac", "-b:a", `${AUDIO_BITRATE_KBPS}k`, "-movflags", "+faststart",
        outputPath
      ];
    }
    return runFfmpeg(args);
  };

  try {
    await encode(VIDEO_TARGET_BYTES);
    if (!fs.existsSync(outputPath)) throw new Error("ffmpeg did not produce an output file");
    let compressedSize = fs.statSync(outputPath).size;
    // Bitrate math can overshoot on dense/high-motion footage — one
    // corrective pass, scaled by how far off the first pass landed.
    if (compressedSize > VIDEO_MAX_BYTES * 1.15 && duration) {
      const correctedTarget = Math.max(VIDEO_MIN_BYTES, Math.floor(VIDEO_TARGET_BYTES * (VIDEO_TARGET_BYTES / compressedSize)));
      await encode(correctedTarget);
      compressedSize = fs.statSync(outputPath).size;
    }
    if (compressedSize >= originalSize) {
      await safeUnlink(outputPath);
      return { outputPath: inputPath, mime: "video/mp4", compressed: false, originalSize, reason: "original was already smaller" };
    }
    return { outputPath, mime: "video/mp4", compressed: true, originalSize };
  } catch (error) {
    console.error("[media] ffmpeg transcode error, storing the original video instead:", error.message);
    await safeUnlink(outputPath);
    return { outputPath: inputPath, mime: "video/mp4", compressed: false, originalSize, reason: "transcode failed" };
  }
}

async function processMedia(inputPath, outputDir, baseName, mime, options = {}) {
  if (mime.startsWith("image/")) return compressImage(inputPath, outputDir, baseName, options);
  if (mime.startsWith("video/")) return transcodeVideo(inputPath, outputDir, baseName);
  // PDFs and anything else: store as-is.
  return { outputPath: inputPath, mime, compressed: false, originalSize: fs.statSync(inputPath).size };
}

module.exports = { processMedia, safeUnlink, safeRename };
