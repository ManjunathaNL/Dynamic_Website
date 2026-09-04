require("dotenv").config();
const express = require("express");
const path = require("path");
const fs = require("fs");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const helmet = require("helmet");
const cors = require("cors");
const compression = require("compression");
const morgan = require("morgan");
const multer = require("multer");
const rateLimit = require("express-rate-limit");
const store = require("./store");
const { processMedia, safeUnlink, safeRename } = require("./media");
const { sendLeadNotification } = require("./mailer");

const app = express();
const PORT = process.env.PORT;
const NODE_ENV = process.env.NODE_ENV || "development";
const JWT_SECRET = process.env.JWT_SECRET || "local-development-secret-change-me";

if (NODE_ENV === "production" && JWT_SECRET === "local-development-secret-change-me") {
  console.warn("\n⚠️  WARNING: JWT_SECRET is still the default value. Set a strong, random JWT_SECRET in backend/.env before going live.\n");
}
// APP_URL and CORS_ORIGIN default to values that only make sense on a
// developer's own machine (see below). They're easy to forget when moving
// from localhost to a real domain, and the failure is silent — sitemap.xml
// keeps emitting localhost links, or the API keeps accepting requests from
// anywhere — so call it out loudly at startup instead of leaving it to be
// discovered later.
// FRONTEND_URL (the public site's URL) doubles as a fallback for both APP_URL
// and CORS_ORIGIN when they're not set separately — in this app's normal
// single-server deployment the API and the site share the same domain, so
// one URL is usually enough.
if (!process.env.APP_URL && process.env.FRONTEND_URL) process.env.APP_URL = process.env.FRONTEND_URL;
if (NODE_ENV === "production" && !process.env.APP_URL) {
  console.warn("\n⚠️  WARNING: APP_URL is not set. sitemap.xml and robots.txt will fall back to http://localhost — set APP_URL (or FRONTEND_URL) to your real production domain (e.g. https://gagnantpromoters.com) in backend/.env.\n");
}
if (NODE_ENV === "production" && !process.env.CORS_ORIGIN && !process.env.FRONTEND_URL) {
  console.warn("\n⚠️  WARNING: Neither CORS_ORIGIN nor FRONTEND_URL is set, so the API accepts requests from any origin. Set one of them to your real frontend domain(s) in backend/.env before going live.\n");
}

// Ceiling is generous (up to ~300MB source videos) — everything gets
// compressed down server-side (media.js) before it's stored for good.
const MAX_UPLOAD_BYTES = 320 * 1024 * 1024;
const upload = multer({
  dest: store.UPLOAD_DIR,
  limits: { fileSize: MAX_UPLOAD_BYTES },
  fileFilter: (_, file, cb) => cb(null, /^(image|video|application\/pdf)/.test(file.mimetype))
});

// --- Core middleware ---------------------------------------------------
app.set("trust proxy", 1);
app.use(helmet({ crossOriginResourcePolicy: false }));
app.use(compression());
if (NODE_ENV !== "test") app.use(morgan(NODE_ENV === "production" ? "combined" : "dev"));

const allowedOrigins = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(",").map((x) => x.trim()).filter(Boolean)
  : process.env.FRONTEND_URL
  ? [process.env.FRONTEND_URL.replace(/\/$/, "")]
  : ["*"];
app.use(cors({
  origin: allowedOrigins.includes("*") ? true : allowedOrigins,
  credentials: true
}));

app.use(express.json({ limit: "2mb" }));
app.use("/uploads", express.static(store.UPLOAD_DIR, { maxAge: "7d" }));

// Basic abuse protection on public-facing write endpoints.
const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20, standardHeaders: true, legacyHeaders: false, message: { error: "Too many login attempts. Please try again later." } });
const leadLimiter = rateLimit({ windowMs: 10 * 60 * 1000, max: 30, standardHeaders: true, legacyHeaders: false, message: { error: "Too many submissions. Please try again later." } });
const uploadLimiter = rateLimit({ windowMs: 10 * 60 * 1000, max: 60, standardHeaders: true, legacyHeaders: false, message: { error: "Too many uploads. Please slow down." } });

// --- Helpers -------------------------------------------------------------
const clean = (value) => typeof value === "string" ? value.replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, "").trim() : value;
const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
async function tenantFor(req) {
  if (req.user.role !== "super_admin") return req.user.tenantId;
  if (req.query.tenantId || req.body.tenantId) return req.query.tenantId || req.body.tenantId;
  const [firstTenant] = await store.list("tenants");
  return firstTenant?.id;
}
const tokenFor = (user) => jwt.sign({ id: user.id, email: user.email, role: user.role, tenantId: user.tenantId }, JWT_SECRET, { expiresIn: "8h" });
const isBcryptHash = (value) => /^\$2[aby]\$/.test(value || "");
// Accepts both a bcrypt hash (the normal case) and a plain-text password —
// the latter only matters for accounts seeded before hashing was added, and
// login() below transparently upgrades one to a hash on first successful use.
async function verifyPassword(user, plain) {
  if (!user || !plain) return false;
  return isBcryptHash(user.password) ? bcrypt.compare(plain, user.password) : user.password === plain;
}
function auth(req, res, next) {
  const token = (req.headers.authorization || "").replace("Bearer ", "");
  if (!token) return res.status(401).json({ error: "Authentication required" });
  try { req.user = jwt.verify(token, JWT_SECRET); next(); } catch { res.status(401).json({ error: "Session expired" }); }
}
async function audit(req, action, resource, resourceId, before, after) {
  await store.addAudit({ tenantId: await tenantFor(req), userId: req.user.id, action, resource, resourceId, before, after, at: store.now() });
}
function visible(items) { return items.filter((item) => item.status === "published"); }
// Wraps an async route handler so a rejected promise reaches the error
// middleware instead of crashing the process with an unhandled rejection.
const asyncRoute = (handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);

// --- Health & auth ---------------------------------------------------------
app.get("/api/health", (_, res) => res.json({ ok: true, service: "gagnant-promoters-api", env: NODE_ENV, time: store.now() }));
app.post("/api/auth/login", loginLimiter, asyncRoute(async (req, res) => {
  const { email, password } = req.body || {};
  const user = await store.find("users", { email: { $regex: `^${escapeRegex(String(email || ""))}$`, $options: "i" } });
  if (!user || !(await verifyPassword(user, password))) return res.status(401).json({ error: "Invalid email or password" });
  if (!isBcryptHash(user.password)) await store.update("users", user.id, { password: await bcrypt.hash(password, 10) });
  res.json({ token: tokenFor(user), user: { id: user.id, name: user.name, email: user.email, role: user.role, tenantId: user.tenantId } });
}));

// --- Public site endpoints --------------------------------------------------
app.get("/api/public/:slug/bootstrap", asyncRoute(async (req, res) => {
  const tenant = await store.find("tenants", { slug: req.params.slug, status: "active" });
  if (!tenant) return res.status(404).json({ error: "Tenant not found" });
  const [settings, services, projects, blogs, testimonials, clients, media] = await Promise.all([
    store.find("settings", { tenantId: tenant.id }),
    store.list("services", tenant.id),
    store.list("projects", tenant.id),
    store.list("blogs", tenant.id),
    store.list("testimonials", tenant.id),
    store.list("clients", tenant.id),
    store.list("media", tenant.id)
  ]);
  res.json({ tenant, settings, services: visible(services), projects: visible(projects), blogs: visible(blogs), testimonials: visible(testimonials), clients: visible(clients), media });
}));
app.post("/api/public/:slug/leads", leadLimiter, asyncRoute(async (req, res) => {
  const tenant = await store.find("tenants", { slug: req.params.slug, status: "active" });
  if (!tenant) return res.status(404).json({ error: "Tenant not found" });
  const { name, email, phone, message, source = "website", honeypot } = req.body || {};
  if (honeypot) return res.json({ ok: true, message: "Thanks" });
  if (!name || !email || !message) return res.status(400).json({ error: "Name, email and message are required" });
  const lead = await store.create("leads", { tenantId: tenant.id, name: clean(name), email: clean(email), phone: clean(phone || ""), message: clean(message), source, status: "new", notes: "", createdAt: store.now() });
  const settings = await store.find("settings", { tenantId: tenant.id });
  sendLeadNotification({ tenant, settings, lead }).catch(() => {});
  res.status(201).json({ ok: true, leadId: lead.id, message: "Thank you — we will be in touch shortly." });
}));

// --- Authenticated core ----------------------------------------------------
app.get("/api/me", auth, (req, res) => res.json({ user: req.user }));
// Self-service profile: update your own display name and/or password.
// Changing the password requires the current one — this is not an admin
// "reset someone else's password" endpoint, only "change my own".
app.patch("/api/me", auth, asyncRoute(async (req, res) => {
  const user = await store.find("users", { id: req.user.id });
  if (!user) return res.status(404).json({ error: "User not found" });
  const patch = {};
  if (typeof req.body.name === "string" && req.body.name.trim()) patch.name = clean(req.body.name);
  if (req.body.newPassword) {
    if (!(await verifyPassword(user, req.body.currentPassword))) return res.status(401).json({ error: "Current password is incorrect" });
    if (String(req.body.newPassword).length < 6) return res.status(400).json({ error: "New password must be at least 6 characters" });
    patch.password = await bcrypt.hash(String(req.body.newPassword), 10);
  }
  if (!Object.keys(patch).length) return res.status(400).json({ error: "Nothing to update" });
  const next = await store.update("users", user.id, patch);
  await audit(req, "update", "profile", user.id, null, null);
  res.json({ user: { id: next.id, name: next.name, email: next.email, role: next.role, tenantId: next.tenantId } });
}));
app.get("/api/tenants", auth, asyncRoute(async (req, res) => {
  res.json({ items: req.user.role === "super_admin" ? await store.list("tenants") : await store.list("tenants", req.user.tenantId) });
}));
app.post("/api/tenants", auth, asyncRoute(async (req, res) => {
  if (req.user.role !== "super_admin") return res.status(403).json({ error: "Super Admin only" });
  const { name, slug, domain = "" } = req.body || {};
  if (!name || !slug) return res.status(400).json({ error: "Name and slug are required" });
  if (await store.find("tenants", { slug })) return res.status(409).json({ error: "Slug already exists" });
  const tenant = await store.create("tenants", { name: clean(name), slug: clean(slug).toLowerCase(), domain, status: "active" });
  await store.create("settings", { tenantId: tenant.id, brand: { primary: "#c86b32", secondary: "#14221f", accent: "#e8b563", surface: "#f5f1e9", text: "#18201d", muted: "#67716c", radius: "18px", font: "Manrope", logoUrl: "", heroUrl: "" }, tagline: "Built for what matters.", contact: {}, social: {}, features: { blog: true, video: true, testimonials: true }, seo: {} });
  await audit(req, "create", "tenant", tenant.id, null, tenant);
  res.status(201).json(tenant);
}));
app.get("/api/settings", auth, asyncRoute(async (req, res) => res.json((await store.find("settings", { tenantId: await tenantFor(req) })) || {})));
app.patch("/api/settings", auth, asyncRoute(async (req, res) => {
  const current = await store.find("settings", { tenantId: await tenantFor(req) });
  if (!current) return res.status(404).json({ error: "Settings not found" });
  // Merge nested objects field-by-field instead of replacing them wholesale —
  // a caller sending only { brand: { heroImages: [...] } } should update just
  // that key, not blank out every other brand/contact/social field.
  const patch = { ...req.body };
  for (const key of ["brand", "contact", "social", "features", "seo"]) {
    if (patch[key]) patch[key] = { ...current[key], ...patch[key] };
  }
  const next = await store.update("settings", current.id, patch);
  await audit(req, "update", "settings", current.id, current, next);
  res.json(next);
}));

// --- Image lifecycle: keep uploaded files and the media library in sync
// with whatever content actually references them. ---------------------
const IMAGE_FIELDS = { services: ["imageUrl"], projects: ["imageUrl"], blogs: ["coverUrl"], testimonials: ["photoUrl"], clients: ["logoUrl"] };

async function findFileReferences(url) {
  const refs = [];
  const settingsList = await store.list("settings");
  settingsList.forEach((s) => {
    if (s.brand?.logoUrl === url) refs.push({ resource: "settings", id: s.id, field: "brand.logoUrl" });
    if (s.brand?.heroUrl === url) refs.push({ resource: "settings", id: s.id, field: "brand.heroUrl" });
  });
  for (const [resource, fields] of Object.entries(IMAGE_FIELDS)) {
    const items = await store.list(resource);
    items.forEach((item) => fields.forEach((field) => { if (item[field] === url) refs.push({ resource, id: item.id, field }); }));
  }
  return refs;
}

// Called after a content item (service/project/blog...) is deleted. If the
// image it pointed to isn't used anywhere else, delete the underlying file
// and its media-library record too, instead of leaving an orphaned upload.
async function deleteFileIfUnreferenced(url) {
  if (!url || !url.startsWith("/uploads/")) return;
  if ((await findFileReferences(url)).length) return; // still in use elsewhere — keep it
  const filePath = path.join(store.UPLOAD_DIR, path.basename(url));
  if (fs.existsSync(filePath)) await safeUnlink(filePath);
  const mediaRecord = await store.find("media", { url });
  if (mediaRecord) await store.remove("media", mediaRecord.id);
}

// Called when an image is deleted directly from the Media Library. Clears
// out any place still pointing at it (brand logo/hero, content cover
// images) so the site never shows a broken image after the fact.
async function clearFileReferences(url) {
  const refs = await findFileReferences(url);
  for (const ref of refs) {
    if (ref.resource === "settings") {
      const current = await store.find("settings", { id: ref.id });
      const key = ref.field.split(".")[1];
      await store.update("settings", ref.id, { brand: { ...current.brand, [key]: "" } });
    } else {
      await store.update(ref.resource, ref.id, { [ref.field]: "" });
    }
  }
  return refs;
}

const resources = ["services", "projects", "blogs", "testimonials", "clients"];
resources.forEach((resource) => {
  app.get(`/api/${resource}`, auth, asyncRoute(async (req, res) => {
    let items = await store.list(resource, await tenantFor(req));
    if (req.query.search) {
      const q = req.query.search.toLowerCase();
      items = items.filter((item) => JSON.stringify(item).toLowerCase().includes(q));
    }
    res.json({ items });
  }));
  app.post(`/api/${resource}`, auth, asyncRoute(async (req, res) => {
    const generatedSlug = req.body.slug || req.body.title?.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    const value = { ...req.body, tenantId: await tenantFor(req), slug: generatedSlug, status: req.body.status || "draft" };
    const item = await store.create(resource, value);
    await audit(req, "create", resource, item.id, null, item);
    res.status(201).json(item);
  }));
  app.patch(`/api/${resource}/:id`, auth, asyncRoute(async (req, res) => {
    const current = await store.find(resource, { id: req.params.id, tenantId: await tenantFor(req) });
    if (!current) return res.status(404).json({ error: "Not found" });
    const next = await store.update(resource, req.params.id, { ...req.body, tenantId: current.tenantId });
    await audit(req, "update", resource, current.id, current, next);
    res.json(next);
  }));
  app.delete(`/api/${resource}/:id`, auth, asyncRoute(async (req, res) => {
    const current = await store.find(resource, { id: req.params.id, tenantId: await tenantFor(req) });
    if (!current) return res.status(404).json({ error: "Not found" });
    await store.remove(resource, req.params.id);
    for (const field of IMAGE_FIELDS[resource] || []) await deleteFileIfUnreferenced(current[field]);
    await audit(req, "delete", resource, req.params.id, current, null);
    res.json({ ok: true });
  }));
});

app.get("/api/leads", auth, asyncRoute(async (req, res) => {
  const items = await store.list("leads", await tenantFor(req));
  res.json({ items: items.sort((a, b) => b.createdAt.localeCompare(a.createdAt)) });
}));
app.patch("/api/leads/:id", auth, asyncRoute(async (req, res) => {
  const current = await store.find("leads", { id: req.params.id, tenantId: await tenantFor(req) });
  if (!current) return res.status(404).json({ error: "Lead not found" });
  res.json(await store.update("leads", req.params.id, { status: clean(req.body.status || current.status), notes: clean(req.body.notes || current.notes) }));
}));
app.get("/api/audit", auth, asyncRoute(async (req, res) => {
  const items = await store.list("audit", await tenantFor(req));
  res.json({ items: items.slice(-100).reverse() });
}));

// Media library: list (was missing — the admin dashboard's initial load
// calls this alongside every other resource, so its absence broke the
// whole dashboard) and delete.
app.get("/api/media", auth, asyncRoute(async (req, res) => res.json({ items: await store.list("media", await tenantFor(req)) })));
app.delete("/api/media/:id", auth, asyncRoute(async (req, res) => {
  const current = await store.find("media", { id: req.params.id, tenantId: await tenantFor(req) });
  if (!current) return res.status(404).json({ error: "Not found" });
  const filePath = path.join(store.UPLOAD_DIR, path.basename(current.url || ""));
  if (current.url && fs.existsSync(filePath)) await safeUnlink(filePath);
  await store.remove("media", req.params.id);
  const clearedReferences = current.url ? await clearFileReferences(current.url) : [];
  await audit(req, "delete", "media", req.params.id, current, null);
  res.json({ ok: true, clearedReferences });
}));
// Shared by both the single-file and multi-file upload routes: compress/
// transcode the file, move it to its final name, and create its media record.
async function ingestUploadedFile(file, { tenantId, alt, trim }) {
  const processed = await processMedia(file.path, store.UPLOAD_DIR, file.filename, file.mimetype, { trim });
  const extension = path.extname(processed.outputPath) || path.extname(file.originalname);
  const safeName = `${file.filename}${extension}`;
  const finalPath = path.join(store.UPLOAD_DIR, safeName);
  if (processed.outputPath !== finalPath) await safeRename(processed.outputPath, finalPath);
  if (file.path !== finalPath && fs.existsSync(file.path)) await safeUnlink(file.path);
  const compressedSize = fs.statSync(finalPath).size;
  return store.create("media", {
    tenantId, name: clean(file.originalname), type: processed.mime,
    size: compressedSize, originalSize: file.size, compressed: processed.compressed,
    compressionPercent: Math.max(0, Math.round((1 - compressedSize / file.size) * 100)),
    width: processed.width || null, height: processed.height || null,
    url: `/uploads/${safeName}`, alt: clean(alt || file.originalname), status: "published"
  });
}

app.post("/api/media", auth, uploadLimiter, upload.single("file"), asyncRoute(async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "Image, video or PDF is required" });
  try {
    const item = await ingestUploadedFile(req.file, { tenantId: await tenantFor(req), alt: req.body.alt, trim: req.body.trim === "true" });
    await audit(req, "upload", "media", item.id, null, item);
    res.status(201).json(item);
  } catch (error) {
    if (req.file?.path && fs.existsSync(req.file.path)) await safeUnlink(req.file.path);
    console.error("Media processing failed:", error.stack || error.message || error);
    res.status(500).json({ error: NODE_ENV === "production" ? "Media processing failed" : `Media processing failed: ${error.message}` });
  }
}));
// Upload several files (e.g. a batch of hero/gallery images) in one request.
// Each file is processed independently — one failure doesn't sink the rest.
app.post("/api/media/batch", auth, uploadLimiter, upload.array("files", 20), asyncRoute(async (req, res) => {
  if (!req.files?.length) return res.status(400).json({ error: "At least one image, video or PDF is required" });
  const tenantId = await tenantFor(req);
  const items = [];
  const errors = [];
  for (const file of req.files) {
    try {
      const item = await ingestUploadedFile(file, { tenantId, alt: file.originalname });
      await audit(req, "upload", "media", item.id, null, item);
      items.push(item);
    } catch (error) {
      if (file?.path && fs.existsSync(file.path)) await safeUnlink(file.path);
      console.error(`Media processing failed for ${file.originalname}:`, error.stack || error.message || error);
      errors.push({ name: file.originalname, error: error.message });
    }
  }
  res.status(items.length ? 201 : 500).json({ items, errors });
}));

// --- SEO endpoints -----------------------------------------------------------
app.get("/sitemap.xml", asyncRoute(async (req, res) => {
  const tenant = await store.find("tenants", { slug: req.query.tenant || "gagnant-promoters" });
  const base = process.env.APP_URL || `http://localhost:${PORT}`;
  const [services, projects, blogs] = await Promise.all([
    store.list("services", tenant && tenant.id),
    store.list("projects", tenant && tenant.id),
    store.list("blogs", tenant && tenant.id)
  ]);
  const staticEntries = ["/", "/about", "/services", "/projects", "/blog", "/contact"].map((r) => ({ loc: r }));
  const dynamicEntries = [
    ...visible(services).map((x) => ({ loc: `/services/${x.slug}`, lastmod: x.updatedAt })),
    ...visible(projects).map((x) => ({ loc: `/projects/${x.slug}`, lastmod: x.updatedAt })),
    ...visible(blogs).map((x) => ({ loc: `/blog/${x.slug}`, lastmod: x.updatedAt }))
  ];
  const entries = [...staticEntries, ...dynamicEntries];
  res.type("application/xml").send(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${entries.map((e) => `<url><loc>${base}${e.loc}</loc>${e.lastmod ? `<lastmod>${e.lastmod.slice(0, 10)}</lastmod>` : ""}</url>`).join("")}</urlset>`);
}));
app.get("/robots.txt", (req, res) => {
  const base = process.env.APP_URL || `http://localhost:${PORT}`;
  res.type("text/plain").send(`User-agent: *\nAllow: /\nDisallow: /admin\n\nSitemap: ${base}/sitemap.xml\n`);
});

// --- Serve the built frontend (production) -----------------------------------
const frontendDist = path.join(__dirname, "..", "frontend", "dist");
if (fs.existsSync(frontendDist)) {
  app.use(express.static(frontendDist, { index: false }));
  app.get("*", (req, res) => res.sendFile(path.join(frontendDist, "index.html")));
} else if (NODE_ENV === "production") {
  console.warn(`\n⚠️  frontend/dist was not found. Run "npm run build" in frontend/ (or "npm run build" at the repo root) before starting in production.\n`);
}

app.use((err, _req, res, _next) => {
  console.error(err.stack || err);
  if (err.name === "MulterError") {
    const messages = {
      LIMIT_FILE_SIZE: `File is too large. The maximum upload size is ${Math.round(MAX_UPLOAD_BYTES / (1024 * 1024))} MB.`,
      LIMIT_UNEXPECTED_FILE: "Unexpected file field in the upload.",
      LIMIT_FILE_COUNT: "Too many files in one upload — try a smaller batch."
    };
    return res.status(400).json({ error: messages[err.code] || `Upload error: ${err.message}` });
  }
  res.status(500).json({ error: NODE_ENV === "production" ? "Unexpected server error" : err.message });
});

store.connect()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Gagnant platform API listening on port ${PORT} (public URL: ${process.env.APP_URL || `http://localhost:${PORT}`})`);
      console.log(`Environment: ${NODE_ENV}`);
    });
  })
  .catch((error) => {
    console.error(`\n⚠️  Could not connect to MongoDB: ${error.message}\nCheck MONGO_URI in backend/.env (see backend/.env.example) — the server was not started.\n`);
    process.exit(1);
  });
