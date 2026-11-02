const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { pipeline } = require("stream/promises");
const { MongoClient, GridFSBucket } = require("mongodb");

// Uploaded media (images, videos, PDFs) is stored in MongoDB itself (GridFS
// bucket "uploads"), so the database holds the whole site. UPLOAD_DIR is
// only a scratch folder for files while they're being processed — and the
// place older installs kept their uploads, which are copied into the
// database once on start (migrations.js).
const UPLOAD_DIR = process.env.UPLOAD_DIR ? path.resolve(process.env.UPLOAD_DIR) : path.join(__dirname, "uploads");
const MONGO_URI = process.env.MONGO_URI;

const COLLECTION_LIMIT_HELP = "the Atlas cluster has reached its collection limit (500 collections across all databases on the cluster). Free some up by dropping unused databases/collections in Atlas → Browse Collections, or point MONGO_URI at a cluster of its own.";
const isCollectionLimitError = (error) => error?.code === 8000 && /cannot create a new collection/i.test(error.message || "");

const id = () => crypto.randomUUID();
const now = () => new Date().toISOString();

// The collections the app uses (each gets a unique index on `id`).
const COLLECTIONS = ["users", "tenants", "settings", "services", "cards", "reviewCache", "projects", "blogs", "testimonials", "clients", "leads", "media", "audit"];

// No demo content and no built-in password: a brand-new database only gets
// the structural records the app can't run without — the one tenant the
// frontend renders (TENANT in frontend/src/main.jsx) with an empty settings
// record — plus a first admin account taken from ADMIN_EMAIL /
// ADMIN_PASSWORD in backend/.env. Everything else is entered in the admin.
async function bootstrapDatabase(database) {
  const tenants = database.collection("tenants");
  let tenant = await tenants.findOne({ slug: "gagnant-promoters" });
  if (!tenant) {
    tenant = { id: "tenant-gagnant", name: process.env.COMPANY_NAME || "", slug: "gagnant-promoters", status: "active", domain: "", createdAt: now() };
    await tenants.insertOne({ ...tenant });
  }
  if (!(await database.collection("settings").findOne({ tenantId: tenant.id }))) {
    await database.collection("settings").insertOne({
      id: id(), tenantId: tenant.id, companyName: tenant.name, createdAt: now(), updatedAt: now(),
      // Theme colours only (the site's default palette) — no copy.
      brand: { primary: "#c86b32", secondary: "#14221f", accent: "#e8b563", surface: "#f5f1e9", text: "#18201d", muted: "#67716c", radius: "18px", font: "Manrope", logoUrl: "", heroUrl: "", heroImages: [] },
      contact: {}, social: {}, seo: {}, pageBanners: {}, content: {}
    });
  }
  if ((await database.collection("users").countDocuments()) === 0) {
    const { ADMIN_EMAIL, ADMIN_PASSWORD } = process.env;
    if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
      console.warn("\n⚠️  No admin account exists yet. Set ADMIN_EMAIL and ADMIN_PASSWORD in backend/.env and restart to create one.\n");
      return;
    }
    const bcrypt = require("bcryptjs");
    await database.collection("users").insertOne({
      id: id(), name: process.env.ADMIN_NAME || "Administrator", email: ADMIN_EMAIL.trim().toLowerCase(),
      password: await bcrypt.hash(ADMIN_PASSWORD, 12), role: "super_admin", tenantId: null, tokenVersion: 0, createdAt: now()
    });
    console.log(`[store] Created the first admin account (${ADMIN_EMAIL}). You can remove ADMIN_PASSWORD from backend/.env now.`);
  }
}

// --- MongoDB Atlas connection -----------------------------------------------
// The database is a set of collections (one per resource, mirroring the old
// JSON file's top-level keys) rather than one giant document, since that's
// the natural, indexable shape in Mongo. Every document keeps the same
// string `id` field the rest of the app (and the frontend) already reads —
// Mongo's own `_id` is left as whatever the driver assigns.
let client;
let db;
let bucket;
let connectPromise;

async function connect() {
  if (db) return db;
  if (connectPromise) return connectPromise;
  if (!MONGO_URI) {
    throw new Error("MONGO_URI is not set in backend/.env — add your MongoDB Atlas connection string to enable the database.");
  }
  connectPromise = (async () => {
    try {
      client = new MongoClient(MONGO_URI);
      await client.connect();
    } catch (error) {
      // mongodb+srv:// needs DNS SRV/TXT lookups, which some networks (locked-down
      // routers, certain corporate/ISP resolvers, some containers) silently refuse
      // even though plain A-record lookups work fine. Retry once against a public
      // resolver before giving up, instead of failing on what looks like a bad
      // connection string but is actually just a local DNS limitation.
      const isSrvDnsFailure = MONGO_URI.startsWith("mongodb+srv://") && /querySrv|ENOTFOUND|ECONNREFUSED/.test(error.code || error.message || "");
      if (!isSrvDnsFailure) throw error;
      console.warn(`[store] mongodb+srv lookup failed via the system DNS resolver (${error.code || error.message}). Retrying with a public DNS resolver (8.8.8.8, 1.1.1.1)...`);
      require("dns").setServers(["8.8.8.8", "1.1.1.1"]);
      client = new MongoClient(MONGO_URI);
      await client.connect();
    }
    const database = client.db();
    // A shared Atlas cluster caps how many collections it may hold in total
    // (500 on the free/shared tiers, across *every* database on it). Past
    // that, a collection this app hasn't used yet can't be created and every
    // save to it fails — say so loudly at startup instead of failing later.
    const blocked = [];
    await Promise.all(COLLECTIONS.map((resource) => database.collection(resource).createIndex({ id: 1 }, { unique: true }).catch((error) => {
      if (isCollectionLimitError(error)) blocked.push(resource);
    })));
    if (blocked.length) console.error(`\n⚠️  [store] MongoDB refused to create the collection(s) ${blocked.join(", ")}: ${COLLECTION_LIMIT_HELP}\n`);
    await database.collection("tenants").createIndex({ slug: 1 }).catch(() => {});
    await database.collection("users").createIndex({ email: 1 }).catch(() => {});
    await database.collection("users").createIndex({ resetTokenHash: 1 }, { sparse: true }).catch(() => {});
    await database.collection("audit").createIndex({ tenantId: 1, resource: 1, at: -1 }).catch(() => {});
    await database.collection("uploads.files").createIndex({ filename: 1 }, { unique: true }).catch((error) => {
      if (isCollectionLimitError(error)) console.error(`
⚠️  [store] MongoDB refused to create the uploads (media file) collections: ${COLLECTION_LIMIT_HELP}
`);
    });
    const uploads = new GridFSBucket(database, { bucketName: "uploads" });
    await bootstrapDatabase(database);
    await require("./migrations").runMigrations(database, { uploads, uploadDir: UPLOAD_DIR });
    // Only now is the store "connected" — requests wait (503) until the
    // bootstrap and migrations above have finished.
    db = database;
    bucket = uploads;
    console.log(`[store] Connected to MongoDB (db: ${db.databaseName})`);
    return db;
  })().catch(async (error) => {
    // Forget the failed attempt so the caller can retry with a fresh client,
    // instead of every later connect() returning this same rejected promise.
    connectPromise = null;
    db = null;
    bucket = null;
    await client?.close().catch(() => {});
    throw error;
  });
  return connectPromise;
}
const isConnected = () => Boolean(db);

function col(resource) {
  if (!db) throw new Error("MongoDB is not connected yet — call store.connect() before using the store.");
  return db.collection(resource);
}

function stripMongoId(doc) {
  if (!doc) return doc;
  const { _id, ...rest } = doc;
  return rest;
}

async function list(resource, tenantId) {
  const docs = await col(resource).find(tenantId ? { tenantId } : {}).toArray();
  return docs.map(stripMongoId);
}
async function create(resource, value) {
  const item = { id: id(), createdAt: now(), updatedAt: now(), ...value };
  await col(resource).insertOne({ ...item });
  return item;
}
async function update(resource, itemId, patch) {
  const result = await col(resource).findOneAndUpdate(
    { id: itemId },
    { $set: { ...patch, updatedAt: now() } },
    { returnDocument: "after" }
  );
  return stripMongoId(result?.value ?? result ?? null);
}
async function remove(resource, itemId) {
  const found = await col(resource).findOne({ id: itemId });
  if (found) await col(resource).deleteOne({ id: itemId });
  return stripMongoId(found);
}
// `filter` is a plain MongoDB query object, e.g. { slug, status: "active" }.
async function find(resource, filter) {
  const doc = await col(resource).findOne(filter);
  return stripMongoId(doc);
}
async function addAudit(entry) { return create("audit", entry); }
// Paged, sorted reads for long collections (audit log, email log).
async function query(resource, filter, { sort = { _id: -1 }, skip = 0, limit = 50 } = {}) {
  const docs = await col(resource).find(filter).sort(sort).skip(skip).limit(limit).toArray();
  return docs.map(stripMongoId);
}
const count = (resource, filter) => col(resource).countDocuments(filter);
// Atomic counter bump (e.g. a business card's view/save stats) — avoids the
// read-modify-write race of update() when many visitors hit it at once.
async function increment(resource, itemId, field, by = 1) {
  await col(resource).updateOne({ id: itemId }, { $inc: { [field]: by } });
}
// Insert-or-replace by id, for single cached documents such as the latest
// Google reviews snapshot for a tenant.
async function upsert(resource, itemId, value) {
  await col(resource).updateOne({ id: itemId }, { $set: { ...value, id: itemId, updatedAt: now() } }, { upsert: true });
  return find(resource, { id: itemId });
}

// --- Uploaded files (GridFS) -------------------------------------------------
// Files are stored under the same name their public URL uses
// (/uploads/<name>), so content records never need to know where a file lives.
const uploadName = (urlOrName) => path.basename(String(urlOrName || ""));
function files() {
  if (!bucket) throw new Error("MongoDB is not connected yet — call store.connect() before using the store.");
  return bucket;
}
async function findFile(urlOrName) {
  return col("uploads.files").findOne({ filename: uploadName(urlOrName) });
}
// Store (or replace) a file from a path on disk.
async function saveFile(urlOrName, sourcePath, { contentType, tenantId } = {}) {
  const name = uploadName(urlOrName);
  await deleteFile(name);
  await pipeline(fs.createReadStream(sourcePath), files().openUploadStream(name, { metadata: { contentType, tenantId: tenantId || null } }));
  return findFile(name);
}
// `range` is { start, end } with `end` exclusive, as GridFS expects.
const openFile = (fileId, range) => files().openDownloadStream(fileId, range);
async function readFile(urlOrName) {
  const file = await findFile(urlOrName);
  if (!file) return null;
  const chunks = [];
  for await (const chunk of openFile(file._id)) chunks.push(chunk);
  return Buffer.concat(chunks);
}
async function deleteFile(urlOrName) {
  const found = await col("uploads.files").find({ filename: uploadName(urlOrName) }, { projection: { _id: 1 } }).toArray();
  for (const file of found) await files().delete(file._id).catch(() => {});
  return found.length > 0;
}

module.exports = { connect, isConnected, list, create, update, remove, find, addAudit, query, count, increment, upsert, now, id, findFile, saveFile, openFile, readFile, deleteFile, UPLOAD_DIR, isCollectionLimitError, COLLECTION_LIMIT_HELP };
