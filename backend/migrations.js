const fs = require("fs");
const path = require("path");
const { pipeline } = require("stream/promises");

// One-time data migrations, run on every start and idempotent. They only
// move existing data into its current shape — no website content is written
// from code: everything the site shows is entered in the admin and read from
// MongoDB.

// local-uploads: uploaded images/videos used to be kept only as files on the
// server's disk. They now live in MongoDB (GridFS bucket "uploads"), so the
// database alone holds the whole site. Any file a media record or any content
// points at that is still only on disk is copied in once; the disk copy is
// then cleared out by the storage sweep (server.js).
const TYPE_BY_EXTENSION = { ".webp": "image/webp", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".gif": "image/gif", ".avif": "image/avif", ".tiff": "image/tiff", ".heic": "image/heic", ".mp4": "video/mp4", ".pdf": "application/pdf" };

async function importLocalUploads(db, { uploads, uploadDir }) {
  const media = await db.collection("media").find({ url: { $regex: "^/uploads/" } }).toArray();
  const byName = new Map(media.map((record) => [path.basename(record.url), record]));
  const usedByContent = new Set();
  for (const resource of ["settings", "tenants", "services", "projects", "blogs", "testimonials", "clients", "cards"]) {
    for (const doc of await db.collection(resource).find().toArray()) {
      for (const match of JSON.stringify(doc).matchAll(/\/uploads\/([A-Za-z0-9._-]+)/g)) {
        usedByContent.add(match[1]);
        if (!byName.has(match[1])) byName.set(match[1], { tenantId: doc.tenantId || null });
      }
    }
  }
  let imported = 0;
  const missing = [];
  for (const [name, record] of byName) {
    if (await db.collection("uploads.files").findOne({ filename: name }, { projection: { _id: 1 } })) continue;
    const filePath = path.join(uploadDir, name);
    if (!fs.existsSync(filePath)) {
      // A media record whose file is gone is tidied up by the storage sweep;
      // only a file the site actually shows is worth a warning.
      if (usedByContent.has(name)) missing.push(name);
      continue;
    }
    const contentType = record.type || TYPE_BY_EXTENSION[path.extname(name).toLowerCase()] || "application/octet-stream";
    await pipeline(fs.createReadStream(filePath), uploads.openUploadStream(name, { metadata: { contentType, tenantId: record.tenantId || null } }));
    imported += 1;
  }
  if (imported) console.log(`[migrations] Copied ${imported} uploaded file(s) from ${uploadDir} into MongoDB — images and videos are now served from the database.`);
  if (missing.length) console.warn(`[migrations] ${missing.length} uploaded file(s) are referenced but are neither in MongoDB nor in ${uploadDir}: ${missing.join(", ")}`);
}

async function runMigrations(db, options) {
  await importLocalUploads(db, options);
}

module.exports = { runMigrations };
