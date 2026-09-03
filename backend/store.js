const path = require("path");
const crypto = require("crypto");
const { MongoClient } = require("mongodb");

const UPLOAD_DIR = path.join(__dirname, "uploads");
const MONGO_URI = process.env.MONGO_URI;

const id = () => crypto.randomUUID();
const now = () => new Date().toISOString();

// Only the bare minimum needed for the app to be usable on a brand-new
// Atlas cluster: an account to log in with, and the one tenant the
// frontend is hardcoded to request (see frontend/src/main.jsx's calls to
// "/public/gagnant-promoters/bootstrap"). No demo services, projects,
// blogs, testimonials, pages, tagline or contact details — that content
// is entered for real through the admin dashboard.
const seed = {
  users: [{
    id: "user-super-admin",
    name: "Platform Administrator",
    email: "admin@gagnantpromoters.com",
    password: "admin123",
    role: "super_admin",
    tenantId: null,
    createdAt: now()
  }],
  tenants: [{
    id: "tenant-gagnant",
    name: "Gagnant Promoters",
    slug: "gagnant-promoters",
    status: "active",
    domain: "",
    createdAt: now()
  }],
  settings: [{
    id: "settings-gagnant",
    tenantId: "tenant-gagnant",
    brand: {
      primary: "#c86b32",
      secondary: "#14221f",
      accent: "#e8b563",
      surface: "#f5f1e9",
      text: "#18201d",
      muted: "#67716c",
      radius: "18px",
      font: "Manrope",
      logoUrl: "",
      heroUrl: "",
      heroImages: []
    },
    tagline: "",
    announcement: "",
    contact: { email: "", phone: "", whatsapp: "", address: "", hours: "" },
    social: { instagram: "", linkedin: "", facebook: "" },
    features: { blog: true, video: true, testimonials: true }
  }],
  pages: [],
  services: [],
  projects: [],
  blogs: [],
  testimonials: [],
  leads: [],
  media: [],
  audit: []
};

// --- MongoDB Atlas connection -----------------------------------------------
// The database is a set of collections (one per resource, mirroring the old
// JSON file's top-level keys) rather than one giant document, since that's
// the natural, indexable shape in Mongo. Every document keeps the same
// string `id` field the rest of the app (and the frontend) already reads —
// Mongo's own `_id` is left as whatever the driver assigns.
let client;
let db;
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
    db = client.db();
    await Promise.all(Object.keys(seed).map((resource) => db.collection(resource).createIndex({ id: 1 }, { unique: true }).catch(() => {})));
    await db.collection("tenants").createIndex({ slug: 1 }).catch(() => {});
    await db.collection("users").createIndex({ email: 1 }).catch(() => {});
    await seedIfEmpty();
    console.log(`[store] Connected to MongoDB Atlas (db: ${db.databaseName})`);
    return db;
  })();
  return connectPromise;
}

// First-run only: populate empty collections with the same starter content
// the old JSON file used to ship with, so a brand-new Atlas cluster isn't
// blank. Collections that already have data (a real deployment) are left
// untouched.
async function seedIfEmpty() {
  for (const [resource, items] of Object.entries(seed)) {
    if (!items.length) continue;
    const col = db.collection(resource);
    const count = await col.countDocuments();
    if (count === 0) await col.insertMany(items);
  }
}

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

module.exports = { connect, list, create, update, remove, find, addAudit, now, id, UPLOAD_DIR };
