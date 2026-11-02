require("dotenv").config();
const express = require("express");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const helmet = require("helmet");
const cors = require("cors");
const compression = require("compression");
const morgan = require("morgan");
const multer = require("multer");
const rateLimit = require("express-rate-limit");
const store = require("./store");
const { processMedia, safeUnlink, extensionFor } = require("./media");
const mailer = require("./mailer");
const { buildVCard } = require("./vcard");
const { createReviewService } = require("./googleReviews");
const security = require("./security");

const app = express();
const PORT = Number(process.env.PORT) || 8787;
const NODE_ENV = process.env.NODE_ENV || "development";
const reviews = createReviewService(store);
// Every email attempt lands in the email log (the audit collection, resource
// "email" — Admin settings → Email templates → Email log).
mailer.setLogger((e) => store.addAudit({
  tenantId: e.tenantId, userId: null, action: `email_${e.status}`, resource: "email", template: e.kind,
  to: e.to, subject: e.subject || "", reason: e.reason || "", error: e.error || "", test: Boolean(e.test), at: store.now()
}));

// --- Session signing key ---------------------------------------------------
// Production refuses to start without a strong JWT_SECRET (a weak or
// published one would let anyone mint an admin session). In development a
// random per-process key is used instead, so sessions just reset on restart.
let JWT_SECRET = process.env.JWT_SECRET || "";
if (JWT_SECRET.length < 32 || JWT_SECRET === "local-development-secret-change-me") {
  if (NODE_ENV === "production") {
    console.error("\n⚠️  JWT_SECRET in backend/.env is missing or too short (needs 32+ random characters). Generate one with:\n    node -e \"console.log(require('crypto').randomBytes(48).toString('hex'))\"\n");
    process.exit(1);
  }
  JWT_SECRET = crypto.randomBytes(48).toString("hex");
  console.warn("[security] JWT_SECRET not set — using a temporary key for this development run.");
}
const JWT_OPTIONS = { issuer: "gagnant-api", audience: "gagnant-admin" };

// FRONTEND_URL (the public site's URL) doubles as a fallback for APP_URL and
// CORS_ORIGIN — in the normal single-server deployment they're one domain.
if (!process.env.APP_URL && process.env.FRONTEND_URL) process.env.APP_URL = process.env.FRONTEND_URL;
if (NODE_ENV === "production" && !process.env.APP_URL) {
  console.warn("\n⚠️  WARNING: APP_URL is not set. sitemap.xml and robots.txt will fall back to http://localhost — set APP_URL (or FRONTEND_URL) to your real production domain in backend/.env.\n");
}
if (NODE_ENV === "production" && !process.env.CORS_ORIGIN && !process.env.FRONTEND_URL) {
  console.warn("\n⚠️  WARNING: Neither CORS_ORIGIN nor FRONTEND_URL is set, so the API accepts requests from any origin. Set one of them to your real frontend domain(s) in backend/.env before going live.\n");
}

// Ceiling is generous (up to ~300MB source videos) — everything gets
// compressed down server-side (media.js) before it's stored for good.
const MAX_UPLOAD_BYTES = 320 * 1024 * 1024;
const upload = multer({
  dest: store.UPLOAD_DIR,
  limits: { fileSize: MAX_UPLOAD_BYTES, files: 20, fields: 10 },
  // First gate only — media.js then checks what the file really is.
  fileFilter: (_, file, cb) => cb(null, /^(image\/(?!svg)|video\/|application\/pdf$)/.test(file.mimetype))
});

// --- Core middleware ---------------------------------------------------
app.set("trust proxy", 1);
app.disable("x-powered-by");
app.use(helmet({
  crossOriginResourcePolicy: false,
  referrerPolicy: { policy: "strict-origin-when-cross-origin" },
  // HSTS only makes sense (and only takes effect) over HTTPS in production.
  strictTransportSecurity: NODE_ENV === "production" ? { maxAge: 31536000, includeSubDomains: true } : false,
  contentSecurityPolicy: {
    directives: {
      // YouTube project videos/thumbnails and Google reviewer photos need
      // these; scripts stay locked to this origin only.
      "img-src": ["'self'", "data:", "blob:", "https:"],
      "media-src": ["'self'", "blob:"],
      "frame-src": ["'self'", "https://www.youtube.com", "https://www.youtube-nocookie.com"],
      "frame-ancestors": ["'self'"],
      "form-action": ["'self'"],
      // Only meaningful over HTTPS; on plain-HTTP local runs it would force
      // same-origin assets to https:// and break them.
      "upgrade-insecure-requests": NODE_ENV === "production" ? [] : null
    }
  }
}));
app.use((_req, res, next) => {
  res.set("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=()");
  next();
});
app.use(compression());
if (NODE_ENV !== "test") app.use(morgan(NODE_ENV === "production" ? "combined" : "dev"));

const allowedOrigins = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(",").map((x) => x.trim().replace(/\/$/, "")).filter(Boolean)
  : process.env.FRONTEND_URL
  ? [process.env.FRONTEND_URL.replace(/\/$/, "")]
  : ["*"];
// With a wildcard, never also allow credentials — that combination would let
// any website make cookie-authenticated calls and read the answers.
app.use(cors({
  origin: allowedOrigins.includes("*") ? "*" : allowedOrigins,
  credentials: !allowedOrigins.includes("*"),
  allowedHeaders: ["Content-Type", "X-CSRF-Token"]
}));

app.use(express.json({ limit: "1mb" }));
app.use(security.sanitizeRequest);
app.use("/api", security.sameOriginGuard(allowedOrigins));

// Uploaded files are streamed out of MongoDB (GridFS — see store.js) and
// served with a locked-down policy of their own: even if someone managed to
// get a hostile file stored, it can't run script or render as a page on this
// site's origin. Byte ranges are supported so videos can stream and seek.
// File names are random and never reused, so they're safe to cache hard.
// The same files answer at /api/uploads/<name>: the public site and admin
// load them from there, so they're reachable whenever the API is — even
// behind a web server that only forwards /api to this app.
app.get(["/uploads/:name", "/api/uploads/:name"], (req, res, next) => {
  (async () => {
    if (!store.isConnected()) return res.set("Retry-After", "3").status(503).end();
    const file = await store.findFile(req.params.name);
    if (!file) return res.status(404).end();
    const etag = `"${file._id}"`;
    res.set({
      "Content-Type": file.metadata?.contentType || "application/octet-stream",
      "Cache-Control": "public, max-age=604800, immutable",
      "ETag": etag,
      "Last-Modified": new Date(file.uploadDate).toUTCString(),
      "Accept-Ranges": "bytes",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'; sandbox"
    });
    if (req.headers["if-none-match"] === etag) return res.status(304).end();
    let start = 0;
    let end = file.length - 1;
    const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || "");
    if (range && (range[1] || range[2])) {
      if (range[1]) {
        start = Number(range[1]);
        if (range[2]) end = Math.min(end, Number(range[2]));
      } else {
        start = Math.max(0, file.length - Number(range[2]));
      }
      if (start > end) return res.set("Content-Range", `bytes */${file.length}`).status(416).end();
      res.status(206).set("Content-Range", `bytes ${start}-${end}/${file.length}`);
    }
    res.set("Content-Length", String(Math.max(0, end - start + 1)));
    if (req.method === "HEAD" || file.length === 0) return res.end();
    const stream = store.openFile(file._id, { start, end: end + 1 });
    stream.on("error", (error) => {
      console.error(`[uploads] Could not stream ${file.filename}: ${error.message}`);
      if (!res.headersSent) res.status(500).end(); else res.destroy(error);
    });
    req.on("close", () => stream.destroy());
    stream.pipe(res);
  })().catch(next);
});
// A missing upload is a 404 — not the website's index.html (which the SPA
// catch-all further down would otherwise answer with, as a 200).
app.use("/uploads", (_req, res) => res.status(404).end());

// The HTTP server starts listening straight away (see the bottom of this
// file) while MongoDB connects in the background, so the dev proxy / a
// reverse proxy never sees a closed port. Until the database is ready, API
// calls get a clear, retryable 503 instead of ECONNREFUSED.
app.use(["/api", "/sitemap.xml"], (req, res, next) => {
  if (store.isConnected() || req.path === "/health") return next();
  res.set("Retry-After", "3").status(503).json({ error: "The server is starting up — please try again in a moment.", code: "starting" });
});

// Abuse protection: an overall ceiling per IP, plus tighter limits on login,
// public forms and uploads.
const limiter = (windowMinutes, max, error, extra = {}) => rateLimit({ windowMs: windowMinutes * 60 * 1000, max, standardHeaders: true, legacyHeaders: false, message: { error }, ...extra });
app.use("/api", limiter(10, 1000, "Too many requests. Please slow down and try again shortly."));
// Only failed sign-ins count, so a team sharing one office connection can all
// sign in normally; guessing is still capped per IP (and per account by the
// lockout in the login route).
const loginLimiter = limiter(15, 20, "Too many failed sign-in attempts. Please try again later.", { skipSuccessfulRequests: true });
const forgotLimiter = limiter(15, 5, "Too many password reset requests. Please wait a few minutes and try again.");
const resetLimiter = limiter(15, 20, "Too many attempts. Please wait a few minutes and try again.");
const leadLimiter = limiter(10, 30, "Too many submissions. Please try again later.");
const uploadLimiter = limiter(10, 60, "Too many uploads. Please slow down.");

// --- Helpers -------------------------------------------------------------
const clean = (value) => (typeof value === "string" ? security.cleanText(value, 5000) : value);
const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const isEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
async function defaultTenantId() {
  const [firstTenant] = await store.list("tenants");
  return firstTenant?.id;
}
async function tenantFor(req) {
  if (req.user.role !== "super_admin") return req.user.tenantId;
  const requested = req.query.tenantId || req.body?.tenantId;
  if (requested && (await store.find("tenants", { id: String(requested) }))) return String(requested);
  return defaultTenantId();
}
const isBcryptHash = (value) => /^\$2[aby]\$/.test(value || "");
// Accepts a bcrypt hash (the normal case) or, for very old accounts, a
// plain-text password — login upgrades that to a hash on first use.
async function verifyPassword(user, plain) {
  if (!user || !plain) return false;
  return isBcryptHash(user.password) ? bcrypt.compare(plain, user.password) : security.safeEqual(user.password, plain);
}
// Compared against when the email doesn't exist, so "no such user" takes as
// long as "wrong password" and response timing can't reveal valid emails.
const DUMMY_HASH = bcrypt.hashSync(crypto.randomBytes(16).toString("hex"), 12);
const MAX_FAILED_LOGINS = 5;
const LOCK_MINUTES = 15;
const publicUser = (user) => ({ id: user.id, name: user.name, email: user.email, role: user.role, tenantId: user.tenantId, mustChangePassword: Boolean(user.mustChangePassword) });
const signSession = (user, csrf) =>
  jwt.sign({ sub: user.id, role: user.role, tv: user.tokenVersion || 0, csrf }, JWT_SECRET, { ...JWT_OPTIONS, algorithm: "HS256", expiresIn: `${security.SESSION_HOURS}h` });
function startSession(req, res, user) {
  const csrf = security.newCsrfToken();
  security.setSessionCookies(req, res, signSession(user, csrf), csrf);
}

// Admin authentication: a signed, httpOnly session cookie whose token
// version must still match the user's (bumped on password change / "sign
// out everywhere"), plus the CSRF token on every state-changing request.
function requireAuth({ allowPasswordChange = false } = {}) {
  return async (req, res, next) => {
    try {
      const token = security.parseCookies(req.headers.cookie)[security.SESSION_COOKIE];
      if (!token) return res.status(401).json({ error: "Please sign in", code: "unauthenticated" });
      let claims;
      try {
        claims = jwt.verify(token, JWT_SECRET, { ...JWT_OPTIONS, algorithms: ["HS256"] });
      } catch {
        security.clearSessionCookies(req, res);
        return res.status(401).json({ error: "Your session has expired — please sign in again", code: "expired" });
      }
      const user = await store.find("users", { id: String(claims.sub) });
      if (!user || user.disabled || (user.tokenVersion || 0) !== claims.tv) {
        security.clearSessionCookies(req, res);
        return res.status(401).json({ error: "Your session has ended — please sign in again", code: "revoked" });
      }
      if (!["GET", "HEAD", "OPTIONS"].includes(req.method) && !security.safeEqual(req.get("x-csrf-token"), claims.csrf)) {
        return res.status(403).json({ error: "Security check failed — please reload the page and try again", code: "csrf" });
      }
      req.user = publicUser(user);
      if (user.mustChangePassword && !allowPasswordChange) {
        return res.status(403).json({ error: "Please set a new password before continuing", code: "password_change_required" });
      }
      next();
    } catch (error) {
      next(error);
    }
  };
}
const auth = requireAuth();
const authSelf = requireAuth({ allowPasswordChange: true });

async function audit(req, action, resource, resourceId, before, after) {
  await store.addAudit({ tenantId: await tenantFor(req), userId: req.user.id, action, resource, resourceId, before, after, ip: req.ip, at: store.now() });
}
// Sign-ins, failures, lockouts and password changes, with IP + browser.
async function securityLog(req, user, action, detail = "") {
  await store.addAudit({
    tenantId: user?.tenantId || (await defaultTenantId()), userId: user?.id || null, action, resource: "security", detail,
    ip: req.ip, userAgent: String(req.get("user-agent") || "").slice(0, 300), at: store.now()
  }).catch(() => {});
}
function visible(items) { return items.filter((item) => item.status === "published"); }
// Settings are served publicly (bootstrap), so secrets inside them — the
// Google Places API key, the SMTP server (mail) and the email templates —
// must never leave the server. The admin gets a "key is set" flag instead of
// the key itself; mail and templates have their own owner-only endpoints.
function publicSettings(settings) {
  if (!settings) return settings;
  const { mail, emailTemplates, ...rest } = settings;
  const { apiKey, ...googleReviews } = settings.googleReviews || {};
  return { ...rest, googleReviews };
}
function adminSettings(settings) {
  if (!settings) return settings;
  const apiKey = settings.googleReviews?.apiKey;
  return { ...publicSettings(settings), googleReviews: { ...publicSettings(settings).googleReviews, apiKey: "", apiKeySet: Boolean(apiKey), apiKeyFromEnv: !apiKey && Boolean(process.env.GOOGLE_PLACES_API_KEY) } };
}
const companyNameOf = (tenant, settings) => settings?.companyName || tenant?.name || "";
const slugify = (value) => String(value || "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 100);
// Slugs become public URLs (/projects/:slug, /card/:slug), so two items
// sharing one would make the second unreachable — suffix -2, -3… instead.
async function uniqueSlug(resource, tenantId, base, exceptId) {
  const root = slugify(base) || resource.replace(/s$/, "");
  for (let n = 1; ; n += 1) {
    const candidate = n === 1 ? root : `${root}-${n}`;
    const clash = await store.find(resource, { tenantId, slug: candidate });
    if (!clash || clash.id === exceptId) return candidate;
  }
}
// Wraps an async route handler so a rejected promise reaches the error
// middleware instead of crashing the process with an unhandled rejection.
const asyncRoute = (handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
const activeTenant = (slug) => store.find("tenants", { slug: String(slug), status: "active" });

// --- Health & auth ---------------------------------------------------------
// `version` + `startedAt` show which build of the API is actually running —
// a backend left running from before an update keeps serving its old code.
const API_VERSION = require("./package.json").version;
const STARTED_AT = new Date().toISOString();
app.get("/api/health", (_, res) => res.json({ ok: true, service: "gagnant-promoters-api", version: API_VERSION, startedAt: STARTED_AT, database: store.isConnected() ? "connected" : "connecting", time: store.now() }));
app.post("/api/auth/login", loginLimiter, asyncRoute(async (req, res) => {
  const email = String(req.body?.email || "").trim().toLowerCase().slice(0, 200);
  const password = String(req.body?.password || "").slice(0, 200);
  const user = email ? await store.find("users", { email: { $regex: `^${escapeRegex(email)}$`, $options: "i" } }) : null;
  if (user?.lockedUntil && new Date(user.lockedUntil) > new Date()) {
    const minutes = Math.ceil((new Date(user.lockedUntil) - Date.now()) / 60000);
    await securityLog(req, user, "login_blocked", "account locked");
    return res.status(429).json({ error: `Too many failed attempts. This account is locked for ${minutes} more minute${minutes === 1 ? "" : "s"}.` });
  }
  const ok = user ? await verifyPassword(user, password) : (await bcrypt.compare(password || "x", DUMMY_HASH), false);
  if (!ok) {
    if (user) {
      const failures = (user.failedLogins || 0) + 1;
      const lock = failures >= MAX_FAILED_LOGINS;
      await store.update("users", user.id, { failedLogins: lock ? 0 : failures, lockedUntil: lock ? new Date(Date.now() + LOCK_MINUTES * 60000).toISOString() : null });
      await securityLog(req, user, lock ? "account_locked" : "login_failed");
      if (lock) return res.status(429).json({ error: `Too many failed attempts. This account is locked for ${LOCK_MINUTES} minutes.` });
    } else {
      await securityLog(req, null, "login_failed", "unknown email");
    }
    return res.status(401).json({ error: "Invalid email or password" });
  }
  // Checked only after the password is right, so these answers never reveal
  // anything about an account to someone who doesn't know its password.
  if (user.disabled) {
    await securityLog(req, user, "login_blocked", "account disabled");
    return res.status(403).json({ error: "This account has been disabled. Contact your administrator." });
  }
  if (user.mustChangePassword && user.tempPasswordExpiresAt && new Date(user.tempPasswordExpiresAt) < new Date()) {
    await securityLog(req, user, "login_blocked", "temporary password expired");
    return res.status(401).json({ error: "Your temporary password has expired. Ask an administrator to send you a new one." });
  }
  const patch = { failedLogins: 0, lockedUntil: null, lastLoginAt: store.now(), lastLoginIp: req.ip };
  if (!isBcryptHash(user.password)) patch.password = await bcrypt.hash(password, 12);
  // A weak or default password (e.g. the old admin123) still signs in, but
  // the account can do nothing except set a new one.
  if (security.passwordProblem(password, user.email)) patch.mustChangePassword = true;
  const next = await store.update("users", user.id, patch);
  startSession(req, res, next);
  await securityLog(req, next, "login");
  res.json({ user: publicUser(next) });
}));
app.post("/api/auth/logout", asyncRoute(async (req, res) => {
  security.clearSessionCookies(req, res);
  res.json({ ok: true });
}));
// --- Forgot / reset password ------------------------------------------------
// "Forgot password?" emails a one-time link. Only a SHA-256 hash of the token
// is stored (on the user record), so a database leak can't be used to reset
// anyone's password, and the link stops working once used or after
// RESET_LINK_MINUTES. The answer is the same whether or not the email
// exists, so this can't be used to discover accounts.
const RESET_LINK_MINUTES = 60;
const hashToken = (token) => crypto.createHash("sha256").update(String(token)).digest("hex");
const FORGOT_REPLY = { ok: true, message: "If that email belongs to an account, a link to reset the password is on its way. Check your inbox (and spam folder)." };
app.post("/api/auth/forgot-password", forgotLimiter, asyncRoute(async (req, res) => {
  const email = String(req.body?.email || "").trim().toLowerCase().slice(0, 200);
  if (!isEmail(email)) return res.status(400).json({ error: "Please enter a valid email address" });
  // Without working email (or with this email switched off) there's no way
  // to deliver the link — say so up front, before looking the account up, so
  // the answer still reveals nothing about which emails have accounts.
  const siteSettings = await store.find("settings", { tenantId: await defaultTenantId() });
  if (!mailer.isConfigured(siteSettings) || !mailer.isEnabled(siteSettings, "forgotPassword")) {
    return res.status(503).json({ error: "Password reset by email isn't available on this site. Ask the site owner to reset your password from Users." });
  }
  const user = await store.find("users", { email: { $regex: `^${escapeRegex(email)}$`, $options: "i" } });
  if (!user || user.disabled) {
    await securityLog(req, user, "password_reset_requested", user ? "account disabled — ignored" : `unknown email ${email}`);
    return res.json(FORGOT_REPLY);
  }
  const token = crypto.randomBytes(32).toString("hex");
  await store.update("users", user.id, { resetTokenHash: hashToken(token), resetTokenExpiresAt: new Date(Date.now() + RESET_LINK_MINUTES * 60000).toISOString() });
  const result = await sendUserEmail(req, user, "forgotPassword", {
    resetUrl: `${siteBase(req)}/admin/reset-password?token=${token}`, expiresMinutes: String(RESET_LINK_MINUTES)
  });
  await securityLog(req, user, "password_reset_requested", result.sent ? "reset link emailed" : `email not sent (${result.reason})`);
  res.json(FORGOT_REPLY);
}));
async function userForResetToken(token) {
  if (!/^[a-f0-9]{64}$/.test(String(token || ""))) return null;
  const user = await store.find("users", { resetTokenHash: hashToken(token) });
  if (!user || user.disabled || !user.resetTokenExpiresAt || new Date(user.resetTokenExpiresAt) < new Date()) return null;
  return user;
}
const RESET_LINK_INVALID = "This reset link is invalid or has expired. Request a new one from the sign-in page.";
// Lets the reset page say "link expired" up front, before anyone types.
app.post("/api/auth/reset-password/check", resetLimiter, asyncRoute(async (req, res) => {
  const user = await userForResetToken(req.body?.token);
  if (!user) return res.status(400).json({ error: RESET_LINK_INVALID, code: "invalid_token" });
  res.json({ ok: true, email: user.email });
}));
app.post("/api/auth/reset-password", resetLimiter, asyncRoute(async (req, res) => {
  const user = await userForResetToken(req.body?.token);
  if (!user) return res.status(400).json({ error: RESET_LINK_INVALID, code: "invalid_token" });
  const password = String(req.body?.password || "");
  const problem = security.passwordProblem(password, user.email);
  if (problem) return res.status(400).json({ error: problem });
  const next = await store.update("users", user.id, {
    password: await bcrypt.hash(password, 12), resetTokenHash: null, resetTokenExpiresAt: null,
    mustChangePassword: false, tempPasswordExpiresAt: null, failedLogins: 0, lockedUntil: null,
    tokenVersion: (user.tokenVersion || 0) + 1, passwordChangedAt: store.now()
  });
  await securityLog(req, next, "password_reset_completed");
  notifyPasswordChanged(req, next).catch(() => {});
  res.json({ ok: true, message: "Your password has been reset. You can sign in with it now." });
}));

// Ends every session for this account (e.g. after a lost laptop).
app.post("/api/auth/logout-all", authSelf, asyncRoute(async (req, res) => {
  const user = await store.find("users", { id: req.user.id });
  await store.update("users", user.id, { tokenVersion: (user.tokenVersion || 0) + 1 });
  await securityLog(req, user, "logout_all");
  security.clearSessionCookies(req, res);
  res.json({ ok: true });
}));

// --- Public site endpoints --------------------------------------------------
app.get("/api/public/:slug/bootstrap", asyncRoute(async (req, res) => {
  const tenant = await activeTenant(req.params.slug);
  if (!tenant) return res.status(404).json({ error: "Tenant not found" });
  const [settings, services, projects, blogs, testimonials, clients] = await Promise.all([
    store.find("settings", { tenantId: tenant.id }),
    store.list("services", tenant.id),
    store.list("projects", tenant.id),
    store.list("blogs", tenant.id),
    store.list("testimonials", tenant.id),
    store.list("clients", tenant.id)
  ]);
  res.set("Cache-Control", "no-cache");
  res.json({
    tenant: { id: tenant.id, slug: tenant.slug, name: companyNameOf(tenant, settings) },
    settings: publicSettings(settings),
    services: visible(services), projects: visible(projects), blogs: visible(blogs), testimonials: visible(testimonials), clients: visible(clients)
  });
}));
app.post("/api/public/:slug/leads", leadLimiter, asyncRoute(async (req, res) => {
  const tenant = await activeTenant(req.params.slug);
  if (!tenant) return res.status(404).json({ error: "Tenant not found" });
  const { name = "", email = "", phone = "", message = "", cardSlug, website } = req.body || {};
  // Honeypot: the forms include a visually hidden "website" field that people
  // never see — only bots fill it in. Pretend success, store nothing.
  if (website) return res.status(201).json({ ok: true, message: "Thank you — we will be in touch shortly." });
  // A website enquiry needs an email + message; a contact shared from a
  // business card ("Share your details") only needs a name and some way to
  // reach the person back.
  const card = cardSlug ? await store.find("cards", { tenantId: tenant.id, slug: String(cardSlug), status: "published" }) : null;
  if (cardSlug && !card) return res.status(404).json({ error: "Card not found" });
  if (!String(name).trim()) return res.status(400).json({ error: "Please enter your name" });
  if (card ? !email && !phone : !email || !String(message).trim()) return res.status(400).json({ error: card ? "Please add an email address or phone number" : "Name, email and message are required" });
  if (email && !isEmail(String(email).trim())) return res.status(400).json({ error: "Please enter a valid email address" });
  if ([name, email, phone].some((v) => String(v).length > 200) || String(message).length > 5000) return res.status(400).json({ error: "That message is too long" });
  const lead = await store.create("leads", {
    tenantId: tenant.id, name: clean(String(name)), email: clean(String(email)), phone: clean(String(phone)), message: clean(String(message)),
    source: card ? "business-card" : "website", ...(card ? { cardId: card.id, cardName: card.name } : {}),
    status: "new", notes: "", ip: req.ip, createdAt: store.now()
  });
  await store.addAudit({ tenantId: tenant.id, userId: null, action: "lead_received", resource: "leads", resourceId: lead.id, detail: `${lead.name} (${lead.source})`, ip: req.ip, at: store.now() });
  res.status(201).json({ ok: true, leadId: lead.id, message: "Thank you — we will be in touch shortly." });
  // Emails go out after the visitor has their answer — a slow mail server
  // never holds up the form.
  sendLeadEmails(req, tenant, lead, card).catch((error) => console.error("[mailer] lead emails:", error.message));
}));

// --- Digital business cards (public) ------------------------------------------
const publicCard = ({ views, saves, ...card }) => card;
async function findPublicCard(req) {
  const tenant = await activeTenant(req.params.slug);
  if (!tenant) return {};
  const card = await store.find("cards", { tenantId: tenant.id, slug: String(req.params.cardSlug), status: "published" });
  return { tenant, card };
}
const siteBase = (req) => (process.env.APP_URL || `${req.protocol}://${req.get("host")}`).replace(/\/$/, "");
app.get("/api/public/:slug/cards/:cardSlug", asyncRoute(async (req, res) => {
  const { tenant, card } = await findPublicCard(req);
  if (!card) return res.status(404).json({ error: "This business card doesn't exist or is no longer active." });
  const settings = await store.find("settings", { tenantId: tenant.id });
  // ?track=0 — admin previews and the card's own live refreshes — doesn't
  // count as a view.
  if (req.query.track !== "0") store.increment("cards", card.id, "views").catch(() => {});
  res.set("Cache-Control", "no-cache");
  res.json({ tenant: { id: tenant.id, name: companyNameOf(tenant, settings), slug: tenant.slug }, card: publicCard(card), settings: publicSettings(settings) });
}));
app.get("/api/public/:slug/cards/:cardSlug/vcard", asyncRoute(async (req, res) => {
  const { tenant, card } = await findPublicCard(req);
  if (!card) return res.status(404).json({ error: "Card not found" });
  const settings = (await store.find("settings", { tenantId: tenant.id })) || {};
  const vcf = await buildVCard({
    card,
    company: { name: companyNameOf(tenant, settings), website: siteBase(req), address: settings.contact?.address, phone: settings.contact?.phone },
    cardUrl: `${siteBase(req)}/card/${card.slug}`,
    readUpload: store.readFile
  });
  store.increment("cards", card.id, "saves").catch(() => {});
  const fileName = slugify(card.name) || "contact";
  res.set({ "Content-Type": "text/vcard; charset=utf-8", "Content-Disposition": `attachment; filename="${fileName}.vcf"`, "Cache-Control": "no-store" });
  res.send(vcf);
}));

// --- Google reviews (public) ----------------------------------------------------
app.get("/api/public/:slug/google-reviews", asyncRoute(async (req, res) => {
  const tenant = await activeTenant(req.params.slug);
  if (!tenant) return res.status(404).json({ error: "Tenant not found" });
  const settings = await store.find("settings", { tenantId: tenant.id });
  res.set("Cache-Control", "public, max-age=60");
  res.json(await reviews.getPublic(tenant.id, settings));
}));

// --- Authenticated core ----------------------------------------------------
app.get("/api/me", authSelf, (req, res) => res.json({ user: req.user }));
// Self-service profile: update your own display name and/or password.
// Changing the password requires the current one, ends every other session
// (token version bump) and re-issues this one.
app.patch("/api/me", authSelf, asyncRoute(async (req, res) => {
  const user = await store.find("users", { id: req.user.id });
  if (!user) return res.status(404).json({ error: "User not found" });
  const patch = {};
  if (typeof req.body.name === "string" && req.body.name.trim()) patch.name = security.cleanText(req.body.name, 80);
  if (req.body.newPassword) {
    if (!(await verifyPassword(user, String(req.body.currentPassword || "")))) {
      await securityLog(req, user, "password_change_failed");
      // 400, not 401: a 401 means "session ended" and would sign the admin out.
      return res.status(400).json({ error: "Current password is incorrect", code: "wrong_password" });
    }
    const newPassword = String(req.body.newPassword);
    const problem = security.passwordProblem(newPassword, user.email);
    if (problem) return res.status(400).json({ error: problem });
    if (await verifyPassword(user, newPassword)) return res.status(400).json({ error: "Choose a password you haven't used here before" });
    Object.assign(patch, { password: await bcrypt.hash(newPassword, 12), mustChangePassword: false, tempPasswordExpiresAt: null, tokenVersion: (user.tokenVersion || 0) + 1, passwordChangedAt: store.now() });
  } else if (user.mustChangePassword) {
    return res.status(403).json({ error: "Please set a new password before continuing", code: "password_change_required" });
  }
  if (!Object.keys(patch).length) return res.status(400).json({ error: "Nothing to update" });
  const next = await store.update("users", user.id, patch);
  if (patch.password) {
    startSession(req, res, next);
    await securityLog(req, next, "password_changed");
    notifyPasswordChanged(req, next).catch(() => {});
  } else {
    await audit(req, "update", "profile", user.id, null, null);
  }
  res.json({ user: publicUser(next) });
}));
// --- Users (owners only) -----------------------------------------------------
// Two roles: "super_admin" (Owner — everything, including managing users) and
// "admin" (manages the whole website, but not other users). A new user gets
// a strong temporary password — emailed in a welcome message — that must be
// replaced at first sign-in and expires after TEMP_PASSWORD_DAYS.
const ROLES = ["super_admin", "admin"];
const TEMP_PASSWORD_DAYS = 7;
const requireOwner = (req, res, next) =>
  req.user.role === "super_admin" ? next() : res.status(403).json({ error: "Only an owner can manage users" });
// 14 characters from an unambiguous alphabet (no 0/O, 1/l/I), always with
// upper, lower and digits — satisfies the password policy.
function temporaryPassword() {
  const sets = ["ABCDEFGHJKLMNPQRSTUVWXYZ", "abcdefghijkmnpqrstuvwxyz", "23456789"];
  const all = sets.join("");
  const chars = sets.map((set) => set[crypto.randomInt(set.length)]);
  while (chars.length < 14) chars.push(all[crypto.randomInt(all.length)]);
  for (let i = chars.length - 1; i > 0; i -= 1) {
    const j = crypto.randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("");
}
const userView = (user, me) => ({
  ...publicUser(user),
  disabled: Boolean(user.disabled),
  createdAt: user.createdAt || null,
  lastLoginAt: user.lastLoginAt || null,
  invitedBy: user.invitedBy || null,
  tempPasswordExpiresAt: user.mustChangePassword ? user.tempPasswordExpiresAt || null : null,
  isYou: user.id === me.id
});
// Everything an email needs about the site: its settings (SMTP, templates,
// brand colours) and the placeholders every template can use.
async function emailContext(req, tenantId) {
  const id = tenantId || (await defaultTenantId());
  const [settings, tenant] = await Promise.all([store.find("settings", { tenantId: id }), store.find("tenants", { id })]);
  const base = siteBase(req);
  const logo = settings?.brand?.logoUrl;
  return {
    tenantId: id, settings,
    values: { companyName: companyNameOf(tenant, settings), loginUrl: `${base}/admin`, siteUrl: base, logoUrl: logo ? (/^https?:\/\//.test(logo) ? logo : `${base}${logo}`) : "" }
  };
}
const firstNameOf = (name) => String(name || "").trim().split(/\s+/)[0] || "there";
// An email to an admin user, with their name/email/role filled in.
async function sendUserEmail(req, user, kind, values = {}, details = null) {
  const context = await emailContext(req, user.tenantId);
  return mailer.send(context.settings, kind, {
    tenantId: context.tenantId, to: user.email, details,
    values: { ...context.values, firstName: firstNameOf(user.name), name: user.name || "", email: user.email, role: user.role === "super_admin" ? "Owner" : "Admin", ...values }
  });
}
function notifyPasswordChanged(req, user) {
  return sendUserEmail(req, user, "passwordChanged", { changedAt: new Date().toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" }) + " IST" });
}
// New enquiry: the team (and the card's owner, for a business-card contact),
// plus the optional thank-you to the person who enquired.
async function sendLeadEmails(req, tenant, lead, card) {
  const context = await emailContext(req, tenant.id);
  const { settings } = context;
  const team = mailer.smtpConfig(settings)?.notifyTo || settings?.contact?.email || "";
  const values = {
    ...context.values, leadName: lead.name, leadEmail: lead.email || "—", leadPhone: lead.phone || "—", leadMessage: lead.message || "—",
    cardName: card?.name || "", manageUrl: `${context.values.siteUrl}/admin`, firstName: firstNameOf(lead.name)
  };
  const common = { tenantId: tenant.id, values, replyTo: lead.email || undefined };
  if (card) {
    const to = [...new Set([team, card.email].flatMap((x) => String(x || "").split(",")).map((x) => x.trim()).filter(Boolean))].join(", ");
    await mailer.send(settings, "cardLeadNotification", { ...common, to, details: mailer.leadDetails(lead) });
  } else {
    await mailer.send(settings, "leadNotification", { ...common, to: team, details: mailer.leadDetails(lead) });
  }
  if (lead.email) await mailer.send(settings, "leadAutoReply", { tenantId: tenant.id, values, to: lead.email });
}
async function issueTemporaryPassword(req, user, kind) {
  const tempPassword = temporaryPassword();
  const updated = await store.update("users", user.id, {
    password: await bcrypt.hash(tempPassword, 12),
    mustChangePassword: true,
    tempPasswordExpiresAt: new Date(Date.now() + TEMP_PASSWORD_DAYS * 86400000).toISOString(),
    tokenVersion: (user.tokenVersion || 0) + 1, // any existing session ends
    failedLogins: 0,
    lockedUntil: null
  });
  const email = await sendUserEmail(
    req, { ...updated, tenantId: updated.tenantId || (await tenantFor(req)) }, kind === "welcome" ? "welcome" : "passwordReset",
    { expiresIn: `${TEMP_PASSWORD_DAYS} days`, invitedBy: req.user.name || "An owner" },
    [["Email", updated.email], ["Temporary password", tempPassword]]
  );
  // The temporary password is only ever returned when the email couldn't be
  // sent, so the owner can pass it on by hand — it's never stored readable.
  return { user: updated, email, tempPassword: email.sent ? undefined : tempPassword };
}
async function ownerCount() {
  return (await store.list("users")).filter((u) => u.role === "super_admin" && !u.disabled).length;
}

app.get("/api/users", auth, requireOwner, asyncRoute(async (req, res) => {
  const users = await store.list("users");
  const settings = await store.find("settings", { tenantId: await tenantFor(req) });
  res.json({ items: users.sort((a, b) => String(a.createdAt || "").localeCompare(String(b.createdAt || ""))).map((u) => userView(u, req.user)), emailConfigured: mailer.isConfigured(settings) });
}));
app.post("/api/users", auth, requireOwner, asyncRoute(async (req, res) => {
  const name = security.cleanText(req.body?.name, 80);
  const email = security.cleanText(req.body?.email, 200).toLowerCase();
  const role = ROLES.includes(req.body?.role) ? req.body.role : "admin";
  if (!name) return res.status(400).json({ error: "Please enter the person's name" });
  if (!isEmail(email)) return res.status(400).json({ error: "Please enter a valid email address" });
  if (await store.find("users", { email: { $regex: `^${escapeRegex(email)}$`, $options: "i" } })) return res.status(409).json({ error: "A user with that email already exists" });
  const created = await store.create("users", {
    name, email, role, tenantId: role === "super_admin" ? null : await tenantFor(req),
    password: "!", tokenVersion: 0, invitedBy: req.user.name || req.user.email, createdBy: req.user.id
  });
  const result = await issueTemporaryPassword(req, created, "welcome");
  await securityLog(req, req.user, "user_created", `${email} (${role})`);
  res.status(201).json({ user: userView(result.user, req.user), emailSent: result.email.sent, emailError: result.email.reason, tempPassword: result.tempPassword });
}));
app.patch("/api/users/:id", auth, requireOwner, asyncRoute(async (req, res) => {
  const user = await store.find("users", { id: String(req.params.id) });
  if (!user) return res.status(404).json({ error: "User not found" });
  const patch = {};
  if (req.body.name !== undefined) {
    patch.name = security.cleanText(req.body.name, 80);
    if (!patch.name) return res.status(400).json({ error: "Name can't be empty" });
  }
  if (req.body.role !== undefined && req.body.role !== user.role) {
    if (!ROLES.includes(req.body.role)) return res.status(400).json({ error: "Unknown role" });
    if (user.id === req.user.id) return res.status(400).json({ error: "You can't change your own role" });
    if (user.role === "super_admin" && (await ownerCount()) <= 1) return res.status(400).json({ error: "There must always be at least one owner" });
    patch.role = req.body.role;
    patch.tenantId = req.body.role === "super_admin" ? null : await tenantFor(req);
    patch.tokenVersion = (user.tokenVersion || 0) + 1; // new permissions take effect on next sign-in
  }
  if (req.body.disabled !== undefined && Boolean(req.body.disabled) !== Boolean(user.disabled)) {
    if (user.id === req.user.id) return res.status(400).json({ error: "You can't disable your own account" });
    if (req.body.disabled && user.role === "super_admin" && (await ownerCount()) <= 1) return res.status(400).json({ error: "There must always be at least one active owner" });
    patch.disabled = Boolean(req.body.disabled);
    if (patch.disabled) patch.tokenVersion = (user.tokenVersion || 0) + 1; // signs them out everywhere
  }
  if (!Object.keys(patch).length) return res.json({ user: userView(user, req.user) });
  const next = await store.update("users", user.id, patch);
  await securityLog(req, req.user, patch.disabled === true ? "user_disabled" : patch.disabled === false ? "user_enabled" : "user_updated", next.email);
  res.json({ user: userView(next, req.user) });
}));
app.post("/api/users/:id/reset-password", auth, requireOwner, asyncRoute(async (req, res) => {
  const user = await store.find("users", { id: String(req.params.id) });
  if (!user) return res.status(404).json({ error: "User not found" });
  if (user.id === req.user.id) return res.status(400).json({ error: "Change your own password from your account menu instead" });
  const result = await issueTemporaryPassword(req, user, "reset");
  await securityLog(req, req.user, "user_password_reset", user.email);
  res.json({ user: userView(result.user, req.user), emailSent: result.email.sent, emailError: result.email.reason, tempPassword: result.tempPassword });
}));
app.delete("/api/users/:id", auth, requireOwner, asyncRoute(async (req, res) => {
  const user = await store.find("users", { id: String(req.params.id) });
  if (!user) return res.status(404).json({ error: "User not found" });
  if (user.id === req.user.id) return res.status(400).json({ error: "You can't delete your own account" });
  if (user.role === "super_admin" && !user.disabled && (await ownerCount()) <= 1) return res.status(400).json({ error: "There must always be at least one owner" });
  await store.remove("users", user.id);
  await securityLog(req, req.user, "user_deleted", user.email);
  res.json({ ok: true });
}));

// --- Email (SMTP), email templates and the email log (owners only) -------------
// Kept out of /api/settings on purpose: the SMTP password is write-only (an
// empty password in a save means "unchanged") and admins who aren't owners
// can't read or change where the site's email goes.
const mailView = (settings) => {
  const mail = settings?.mail || {};
  const env = mailer.smtpConfig({});
  return {
    host: mail.host || "", port: Number(mail.port) || 587, secure: mail.secure === true || mail.secure === "ssl" || (mail.secure === undefined && Number(mail.port) === 465),
    user: mail.user || "", passSet: Boolean(mail.pass), fromEmail: mail.fromEmail || "", fromName: mail.fromName || "", notifyTo: mail.notifyTo || "",
    // What's actually in use right now, so the page can say "using .env".
    activeSource: mailer.activeSource(settings),
    env: env ? { host: env.host, port: env.port, user: env.user, fromEmail: env.fromEmail } : null,
    contactEmail: settings?.contact?.email || ""
  };
};
const templateView = (settings, kind) => {
  const spec = mailer.TEMPLATES[kind];
  return {
    kind, group: spec.group, label: spec.label, description: spec.description, recipient: spec.recipient,
    placeholders: [...spec.placeholders, ...mailer.COMMON_PLACEHOLDERS], hasButton: Boolean(spec.button),
    extras: spec.credentials ? "credentials" : spec.details ? "details" : null,
    defaults: spec.defaults, current: mailer.templateFor(settings, kind),
    customised: Object.entries(settings?.emailTemplates?.[kind] || {}).some(([k, v]) => k !== "enabled" && v)
  };
};
const templatesView = (settings) => mailer.TEMPLATE_KINDS.map((kind) => templateView(settings, kind));
const badRequest = (message) => Object.assign(new Error(message), { status: 400 });
// The SMTP fields a request may set, cleaned; pass is only replaced when given.
function mailPatch(body, current = {}) {
  const port = Number(body?.port);
  const next = {
    host: security.cleanText(body?.host, 200).replace(/\s/g, ""),
    port: Number.isInteger(port) && port > 0 && port < 65536 ? port : 587,
    secure: Boolean(body?.secure),
    user: security.cleanText(body?.user, 200),
    fromEmail: security.cleanText(body?.fromEmail, 200),
    fromName: security.cleanText(body?.fromName, 120).replace(/["<>]/g, ""),
    notifyTo: security.cleanText(body?.notifyTo, 400),
    // Gmail shows app passwords in groups of four ("abcd efgh …") — spaces
    // aren't part of the password.
    pass: body?.clearPass ? "" : String(body?.pass || "").replace(/\s+/g, "").slice(0, 500) || current.pass || ""
  };
  if (next.host && !/^[a-z0-9.-]+$/i.test(next.host)) throw badRequest("SMTP host should look like smtp.example.com");
  if (next.fromEmail && !isEmail(next.fromEmail)) throw badRequest("“From” email address isn't valid");
  if (next.notifyTo && !next.notifyTo.split(",").every((x) => isEmail(x.trim()))) throw badRequest("Enquiry notification emails must be valid addresses, separated by commas");
  return next;
}
const settingsForMail = async (req) => {
  const settings = await store.find("settings", { tenantId: await tenantFor(req) });
  if (!settings) throw Object.assign(new Error("Settings not found"), { status: 404 });
  return settings;
};
// Wraps a handler so a thrown { status: 400/404 } error becomes that response.
const ownerRoute = (handler) => asyncRoute(async (req, res, next) => {
  try {
    await handler(req, res, next);
  } catch (error) {
    if (error.status === 400 || error.status === 404) return res.status(error.status).json({ error: error.message });
    throw error;
  }
});
const testRecipient = (req) => {
  const to = security.cleanText(req.body?.to, 200) || req.user.email;
  if (!isEmail(to)) throw badRequest("Enter a valid email address to send the test to");
  return to;
};

app.get("/api/admin/mail", auth, requireOwner, ownerRoute(async (req, res) => {
  const settings = await settingsForMail(req);
  res.json({ mail: mailView(settings), templates: templatesView(settings) });
}));
app.put("/api/admin/mail", auth, requireOwner, ownerRoute(async (req, res) => {
  const settings = await settingsForMail(req);
  const mail = mailPatch(req.body, settings.mail);
  if (mail.host && (!mail.user || !mail.pass)) throw badRequest("Add the SMTP username and password too — or clear the host to use the server's .env settings");
  const next = await store.update("settings", settings.id, { mail });
  await securityLog(req, req.user, "smtp_settings_changed", mail.host ? `${mail.host}:${mail.port} as ${mail.user}` : "cleared — using .env");
  res.json({ mail: mailView(next) });
}));
// Tests the settings in the form (falling back to the saved password) without
// saving them, then sends a test message.
app.post("/api/admin/mail/test", auth, requireOwner, ownerRoute(async (req, res) => {
  const settings = await settingsForMail(req);
  const to = testRecipient(req);
  const trial = { ...settings, mail: mailPatch(req.body, settings.mail) };
  const context = await emailContext(req, settings.tenantId);
  const entry = { tenantId: settings.tenantId, userId: req.user.id, resource: "email", template: "smtpTest", to, subject: "SMTP test", test: true };
  try {
    await mailer.verifySmtp(trial);
    await mailer.deliver(trial, {
      to,
      subject: `Test email from ${context.values.companyName || "your website"}`,
      text: `This is a test email from the ${context.values.companyName || "website"} admin.\n\nIf you're reading this, your email (SMTP) settings work.`
    });
    await store.addAudit({ ...entry, action: "email_sent", at: store.now() });
    res.json({ ok: true, message: `Connected — a test email was sent to ${to}` });
  } catch (error) {
    await store.addAudit({ ...entry, action: "email_failed", error: error.message, at: store.now() });
    res.status(400).json({ error: `Mail server said: ${error.message}` });
  }
}));
const templateKind = (req) => {
  if (!mailer.TEMPLATE_KINDS.includes(req.params.kind)) throw Object.assign(new Error("Unknown email template"), { status: 404 });
  return req.params.kind;
};
const templateFields = (input = {}) => ({
  enabled: Boolean(input.enabled),
  eyebrow: security.cleanText(input.eyebrow, 80),
  subject: security.cleanText(input.subject, 200).replace(/[\r\n]+/g, " "),
  body: security.cleanText(input.body, 5000),
  buttonLabel: security.cleanText(input.buttonLabel, 60)
});
app.put("/api/admin/email-templates/:kind", auth, requireOwner, ownerRoute(async (req, res) => {
  const kind = templateKind(req);
  const settings = await settingsForMail(req);
  const fields = templateFields(req.body);
  if (!fields.subject) throw badRequest("The subject can't be empty");
  if (!fields.body) throw badRequest("The message can't be empty");
  // Fields equal to the default are stored empty, so later improvements to
  // the defaults still reach templates nobody customised.
  const defaults = mailer.TEMPLATES[kind].defaults;
  const stored = Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, key !== "enabled" && value === defaults[key] ? "" : value]));
  const next = await store.update("settings", settings.id, { emailTemplates: { ...(settings.emailTemplates || {}), [kind]: stored } });
  const before = mailer.templateFor(settings, kind);
  const action = before.enabled !== fields.enabled ? (fields.enabled ? "email_template_enabled" : "email_template_disabled") : "update";
  await audit(req, action, "email-templates", kind, { label: mailer.TEMPLATES[kind].label, ...before }, { label: mailer.TEMPLATES[kind].label, ...mailer.templateFor(next, kind) });
  res.json({ template: templateView(next, kind) });
}));
app.delete("/api/admin/email-templates/:kind", auth, requireOwner, ownerRoute(async (req, res) => {
  const kind = templateKind(req);
  const settings = await settingsForMail(req);
  const { [kind]: _removed, ...rest } = settings.emailTemplates || {};
  const next = await store.update("settings", settings.id, { emailTemplates: rest });
  await audit(req, "email_template_reset", "email-templates", kind, { label: mailer.TEMPLATES[kind].label }, { label: mailer.TEMPLATES[kind].label });
  res.json({ template: templateView(next, kind) });
}));
// Renders a template as edited (saved or not) with sample data — for the
// live preview, or sent to an address with { send: true, to }.
app.post("/api/admin/email-templates/:kind/preview", auth, requireOwner, ownerRoute(async (req, res) => {
  const kind = templateKind(req);
  const settings = await settingsForMail(req);
  const edited = Object.entries(templateFields(req.body?.template)).filter(([k, v]) => k !== "enabled" && v);
  const template = { ...mailer.templateFor(settings, kind), ...Object.fromEntries(edited) };
  const context = await emailContext(req, settings.tenantId);
  const values = mailer.sampleValues(kind, { ...context.values, userName: req.user.name });
  const details = mailer.sampleDetails(kind, values);
  if (!req.body?.send) return res.json(mailer.render(settings, kind, { values, details, template }));
  const to = testRecipient(req);
  const result = await mailer.send(settings, kind, { tenantId: settings.tenantId, to, values, details, template, test: true });
  if (!result.sent) throw badRequest(result.reason === "smtp-not-configured" ? "Set up the email (SMTP) settings first." : `Mail server said: ${result.detail || result.reason}`);
  res.json({ ok: true, message: `Test email sent to ${to}` });
}));

// Email log: every email the app tried to send, newest first.
const pageArgs = (req, max = 100) => {
  const limit = Math.min(max, Math.max(1, Number(req.query.limit) || 25));
  const page = Math.max(1, Number(req.query.page) || 1);
  return { limit, page, skip: (page - 1) * limit };
};
const searchRegex = (q) => ({ $regex: escapeRegex(String(q).slice(0, 100)), $options: "i" });
app.get("/api/admin/email-log", auth, requireOwner, ownerRoute(async (req, res) => {
  const { limit, page, skip } = pageArgs(req);
  const filter = { tenantId: await tenantFor(req), resource: "email" };
  if (["sent", "failed", "skipped"].includes(req.query.status)) filter.action = `email_${req.query.status}`;
  if (req.query.q) filter.$or = ["to", "subject", "template", "error"].map((field) => ({ [field]: searchRegex(req.query.q) }));
  const [items, total] = await Promise.all([store.query("audit", filter, { sort: { at: -1 }, skip, limit }), store.count("audit", filter)]);
  const labels = Object.fromEntries(mailer.TEMPLATE_KINDS.map((k) => [k, mailer.TEMPLATES[k].label]));
  res.json({
    page, pages: Math.max(1, Math.ceil(total / limit)), total,
    items: items.map((e) => ({
      id: e.id, at: e.at, status: String(e.action).replace("email_", ""), template: e.template, templateLabel: e.template === "smtpTest" ? "SMTP connection test" : labels[e.template] || e.template,
      to: e.to, subject: e.subject || "", reason: e.reason || "", error: e.error || "", test: Boolean(e.test)
    }))
  });
}));

app.get("/api/tenants", auth, asyncRoute(async (req, res) => {
  // Tenant records are keyed by their own id (they have no tenantId field).
  const items = req.user.role === "super_admin" ? await store.list("tenants") : [await store.find("tenants", { id: req.user.tenantId })].filter(Boolean);
  const withNames = await Promise.all(items.map(async (tenant) => ({ ...tenant, name: companyNameOf(tenant, await store.find("settings", { tenantId: tenant.id })) })));
  res.json({ items: withNames });
}));
app.post("/api/tenants", auth, asyncRoute(async (req, res) => {
  if (req.user.role !== "super_admin") return res.status(403).json({ error: "Super Admin only" });
  const name = security.cleanText(req.body?.name, 120);
  const slug = slugify(req.body?.slug);
  if (!name || !slug) return res.status(400).json({ error: "Name and slug are required" });
  if (await store.find("tenants", { slug })) return res.status(409).json({ error: "Slug already exists" });
  const tenant = await store.create("tenants", { name, slug, domain: security.cleanText(req.body?.domain, 200), status: "active" });
  await store.create("settings", { tenantId: tenant.id, companyName: name, brand: { primary: "#c86b32", secondary: "#14221f", accent: "#e8b563", surface: "#f5f1e9", text: "#18201d", muted: "#67716c", radius: "18px", font: "Manrope", logoUrl: "", heroUrl: "" }, contact: {}, social: {}, seo: {}, pageBanners: {}, content: {} });
  await audit(req, "create", "tenant", tenant.id, null, tenant);
  res.status(201).json(tenant);
}));
app.get("/api/settings", auth, asyncRoute(async (req, res) => res.json(adminSettings(await store.find("settings", { tenantId: await tenantFor(req) })) || {})));
app.patch("/api/settings", auth, asyncRoute(async (req, res) => {
  const current = await store.find("settings", { tenantId: await tenantFor(req) });
  if (!current) return res.status(404).json({ error: "Settings not found" });
  // Whitelisted + type-checked (security.js), then nested groups merged
  // field-by-field — a save sending only { brand: { heroUrl } } updates just
  // that key instead of blanking every other brand field.
  const patch = security.validateSettings(req.body);
  for (const key of ["brand", "contact", "social", "features", "seo", "pageBanners", "googleReviews", "content"]) {
    if (patch[key]) patch[key] = { ...current[key], ...patch[key] };
  }
  if (patch.googleReviews) {
    // The admin never sees the stored key (adminSettings blanks it), so an
    // empty key in a save means "unchanged"; clearApiKey removes it.
    const { clearApiKey, ...googleReviews } = patch.googleReviews;
    const incomingKey = String(req.body.googleReviews?.apiKey || "").trim();
    googleReviews.apiKey = req.body.googleReviews?.clearApiKey ? "" : incomingKey || current.googleReviews?.apiKey || "";
    patch.googleReviews = googleReviews;
  }
  const next = await store.update("settings", current.id, patch);
  const stillUsed = new Set(settingsFileUrls(next));
  for (const url of new Set(settingsFileUrls(current))) if (!stillUsed.has(url)) await deleteFileIfUnreferenced(url);
  reviews.invalidate(current.tenantId);
  indexCache.clear();
  await audit(req, "update", "settings", current.id, publicSettings(current), publicSettings(next));
  res.json(adminSettings(next));
}));

// --- Google reviews (admin) ------------------------------------------------------
// "Sync now" — bypasses the cache and surfaces Google's own error message
// (bad key, API not enabled, wrong Place ID…) so setup problems are obvious.
app.post("/api/integrations/google-reviews/sync", auth, asyncRoute(async (req, res) => {
  const tenantId = await tenantFor(req);
  const settings = await store.find("settings", { tenantId });
  try {
    res.json(await reviews.getPublic(tenantId, settings, { force: true, throwOnError: true }));
  } catch (error) {
    res.status(error.status === 400 || !error.status ? 400 : 502).json({ error: `Google: ${error.message}` });
  }
}));
// "Find my business" — looks a business up by name so the admin doesn't have
// to dig the Place ID out of Google's developer tools by hand.
app.post("/api/integrations/google-reviews/search", auth, asyncRoute(async (req, res) => {
  const query = security.cleanText(req.body.query, 200);
  if (query.length < 3) return res.status(400).json({ error: "Type at least 3 characters of your business name" });
  const settings = await store.find("settings", { tenantId: await tenantFor(req) });
  const apiKey = security.cleanText(req.body.apiKey, 200) || reviews.apiKeyFor(settings);
  if (!apiKey) return res.status(400).json({ error: "Add a Google Places API key first" });
  try {
    res.json({ items: await reviews.searchPlaces(query, apiKey) });
  } catch (error) {
    res.status(502).json({ error: `Google: ${error.message}` });
  }
}));

// --- Image lifecycle: keep uploaded files and the media library in sync
// with whatever content actually references them. ---------------------
const IMAGE_FIELDS = { services: ["imageUrl"], projects: ["imageUrl"], blogs: ["coverUrl"], testimonials: ["photoUrl"], clients: ["logoUrl"], cards: ["photoUrl", "coverUrl"] };
// Every place inside settings that can hold an uploaded file, as
// [group, key] pairs. brand.heroSlides is a list of { type, url } (the
// homepage banner slider), brand.heroImages a list of URLs (the older
// carousel), pageBanners one image per page.
const SETTINGS_FILE_FIELDS = [["brand", "logoUrl"], ["brand", "heroUrl"], ["brand", "heroVideo"], ["brand", "heroImages"], ["brand", "heroSlides"], ...["about", "services", "projects", "blog", "contact"].map((page) => ["pageBanners", page])];
const fileUrlOf = (entry) => (entry && typeof entry === "object" ? entry.url : entry);
// Every uploaded-file URL a settings record currently points at.
const settingsFileUrls = (settings) =>
  SETTINGS_FILE_FIELDS.flatMap(([group, key]) => {
    const value = settings?.[group]?.[key];
    return (Array.isArray(value) ? value.map(fileUrlOf) : [value]).filter((u) => typeof u === "string" && u.startsWith("/uploads/"));
  });

async function findFileReferences(url) {
  const refs = [];
  const settingsList = await store.list("settings");
  settingsList.forEach((s) => SETTINGS_FILE_FIELDS.forEach(([group, key]) => {
    const value = s[group]?.[key];
    if (Array.isArray(value) ? value.some((v) => fileUrlOf(v) === url) : value === url) refs.push({ resource: "settings", id: s.id, field: `${group}.${key}` });
  }));
  for (const [resource, fields] of Object.entries(IMAGE_FIELDS)) {
    const items = await store.list(resource);
    items.forEach((item) => fields.forEach((field) => { if (item[field] === url) refs.push({ resource, id: item.id, field }); }));
  }
  return refs;
}

// Called when a content item (service/project/blog...) is deleted, or one
// of its images/videos is replaced or removed. If the old file isn't used
// anywhere else, delete it and its media record instead of leaving an
// orphaned upload behind (there's no media library to tidy up by hand).
async function deleteFileIfUnreferenced(url) {
  if (!url || !url.startsWith("/uploads/")) return;
  if ((await referencedUploads()).has(path.basename(url))) return; // still in use elsewhere — keep it
  await removeStoredFile(url);
  for (const record of await store.list("media")) if (record.url === url) await store.remove("media", record.id);
}

// Every uploaded file name any content still points at — found anywhere in
// a record (image fields, banner lists, slide posters, text that embeds an
// image), not just in the fields known to hold one.
const CONTENT_COLLECTIONS = ["settings", "tenants", "services", "projects", "blogs", "testimonials", "clients", "cards"];
async function referencedUploads() {
  const names = new Set();
  for (const resource of CONTENT_COLLECTIONS) {
    for (const doc of await store.list(resource)) {
      for (const match of JSON.stringify(doc).matchAll(/\/uploads\/([A-Za-z0-9._-]+)/g)) names.add(match[1]);
    }
  }
  return names;
}

// Deletes an uploaded file from MongoDB, plus any copy still left on disk
// from before uploads moved into the database.
async function removeStoredFile(url) {
  await store.deleteFile(url);
  const filePath = path.join(store.UPLOAD_DIR, path.basename(url));
  if (fs.existsSync(filePath)) await safeUnlink(filePath);
}

// Called when an image is deleted directly from the Media Library. Clears
// out any place still pointing at it (brand logo/hero, content cover
// images) so the site never shows a broken image after the fact.
async function clearFileReferences(url) {
  const refs = await findFileReferences(url);
  for (const ref of refs) {
    if (ref.resource === "settings") {
      const current = await store.find("settings", { id: ref.id });
      const [group, key] = ref.field.split(".");
      const value = current[group]?.[key];
      await store.update("settings", ref.id, { [group]: { ...current[group], [key]: Array.isArray(value) ? value.filter((v) => fileUrlOf(v) !== url) : "" } });
    } else {
      await store.update(ref.resource, ref.id, { [ref.field]: "" });
    }
  }
  return refs;
}

const resources = ["services", "projects", "blogs", "testimonials", "clients", "cards"];
resources.forEach((resource) => {
  // A blog post's date is set the first time it's published.
  const withDefaults = (value, current = {}) =>
    resource === "blogs" && value.status === "published" && !value.publishedAt && !current.publishedAt ? { ...value, publishedAt: store.now() } : value;
  app.get(`/api/${resource}`, auth, asyncRoute(async (req, res) => {
    let items = await store.list(resource, await tenantFor(req));
    if (req.query.search) {
      const q = String(req.query.search).toLowerCase();
      items = items.filter((item) => JSON.stringify(item).toLowerCase().includes(q));
    }
    res.json({ items });
  }));
  app.post(`/api/${resource}`, auth, asyncRoute(async (req, res) => {
    const tenantId = await tenantFor(req);
    const body = security.validateResource(resource, req.body);
    if (!(body.title || body.name)) return res.status(400).json({ error: resource === "testimonials" || resource === "clients" || resource === "cards" ? "Name is required" : "Title is required" });
    const slug = await uniqueSlug(resource, tenantId, body.slug || body.title || body.name);
    const value = withDefaults({ ...body, tenantId, slug, status: body.status || "draft", ...(resource === "cards" ? { views: 0, saves: 0 } : {}) });
    const item = await store.create(resource, value);
    await audit(req, "create", resource, item.id, null, item);
    res.status(201).json(item);
  }));
  app.patch(`/api/${resource}/:id`, auth, asyncRoute(async (req, res) => {
    const current = await store.find(resource, { id: String(req.params.id), tenantId: await tenantFor(req) });
    if (!current) return res.status(404).json({ error: "Not found" });
    const patch = withDefaults(security.validateResource(resource, req.body), current);
    if ((patch.title ?? patch.name) === "") return res.status(400).json({ error: "This field can't be empty" });
    if (patch.slug !== undefined && patch.slug !== current.slug) patch.slug = await uniqueSlug(resource, current.tenantId, patch.slug || patch.title || patch.name || current.slug, current.id);
    const next = await store.update(resource, current.id, patch);
    for (const field of IMAGE_FIELDS[resource] || []) if (current[field] && current[field] !== next[field]) await deleteFileIfUnreferenced(current[field]);
    await audit(req, "update", resource, current.id, current, next);
    res.json(next);
  }));
  app.delete(`/api/${resource}/:id`, auth, asyncRoute(async (req, res) => {
    const current = await store.find(resource, { id: String(req.params.id), tenantId: await tenantFor(req) });
    if (!current) return res.status(404).json({ error: "Not found" });
    await store.remove(resource, current.id);
    for (const field of IMAGE_FIELDS[resource] || []) await deleteFileIfUnreferenced(current[field]);
    await audit(req, "delete", resource, current.id, current, null);
    res.json({ ok: true });
  }));
});

const LEAD_STATUSES = ["new", "contacted", "qualified", "won", "lost"];
app.get("/api/leads", auth, asyncRoute(async (req, res) => {
  const items = await store.list("leads", await tenantFor(req));
  res.json({ items: items.sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || ""))) });
}));
app.patch("/api/leads/:id", auth, asyncRoute(async (req, res) => {
  const current = await store.find("leads", { id: String(req.params.id), tenantId: await tenantFor(req) });
  if (!current) return res.status(404).json({ error: "Lead not found" });
  const body = req.body || {};
  const patch = {};
  if (LEAD_STATUSES.includes(body.status)) patch.status = body.status;
  if (body.notes !== undefined) patch.notes = security.cleanText(body.notes, 5000);
  if (body.name !== undefined) {
    patch.name = security.cleanText(body.name, 200);
    if (!patch.name) return res.status(400).json({ error: "Name can't be empty" });
  }
  if (body.email !== undefined) {
    patch.email = security.cleanText(body.email, 200);
    if (patch.email && !isEmail(patch.email)) return res.status(400).json({ error: "Please enter a valid email address" });
  }
  if (body.phone !== undefined) patch.phone = security.cleanText(body.phone, 40);
  const next = await store.update("leads", current.id, patch);
  await audit(req, "update", "leads", current.id, current, next);
  res.json(next);
}));
app.delete("/api/leads/:id", auth, asyncRoute(async (req, res) => {
  const current = await store.find("leads", { id: String(req.params.id), tenantId: await tenantFor(req) });
  if (!current) return res.status(404).json({ error: "Lead not found" });
  await store.remove("leads", current.id);
  await audit(req, "delete", "leads", current.id, current, null);
  res.json({ ok: true });
}));
// --- Audit log (owners only) ------------------------------------------------------
// A trail of security- and business-sensitive actions: sign-ins and lockouts,
// password and user changes, content/settings edits, leads, emails.
const SETTINGS_RESOURCES = ["settings", "email-templates", "tenant", "profile"];
const AUDIT_CATEGORIES = {
  security: { resource: "security", action: { $not: /^user_/ } },
  users: { resource: "security", action: /^user_/ },
  content: { resource: { $in: ["services", "projects", "blogs", "testimonials", "clients", "cards", "media"] } },
  settings: { resource: { $in: SETTINGS_RESOURCES } },
  leads: { resource: "leads" },
  email: { resource: "email" }
};
const categoryOf = (e) =>
  e.resource === "email" ? "email" : e.resource === "security" ? (/^user_/.test(e.action) ? "users" : "security") : e.resource === "leads" ? "leads"
    : SETTINGS_RESOURCES.includes(e.resource) ? "settings" : "content";
const IGNORED_FIELDS = new Set(["updatedAt", "createdAt", "id", "tenantId", "views", "saves"]);
// Field-level "what changed" for an update, with short before/after values.
function changesOf(before, after) {
  if (!before || !after || typeof before !== "object" || typeof after !== "object") return [];
  const short = (v) => (v === undefined || v === null || v === "" ? "—" : typeof v === "object" ? null : String(v).length > 80 ? `${String(v).slice(0, 77)}…` : String(v));
  return [...new Set([...Object.keys(before), ...Object.keys(after)])]
    .filter((key) => !IGNORED_FIELDS.has(key) && JSON.stringify(before[key]) !== JSON.stringify(after[key]))
    .slice(0, 12)
    .map((field) => ({ field, from: short(before[field]), to: short(after[field]) }));
}
const subjectOf = (e) => {
  const doc = e.after || e.before;
  return (doc && (doc.title || doc.name || doc.label || doc.email || doc.companyName)) || "";
};
app.get("/api/audit", auth, requireOwner, ownerRoute(async (req, res) => {
  const { limit, page, skip } = pageArgs(req, 1000);
  const filter = { tenantId: await tenantFor(req) };
  const category = String(req.query.category || "");
  if (AUDIT_CATEGORIES[category]) Object.assign(filter, AUDIT_CATEGORIES[category]);
  else filter.resource = { $ne: "email" }; // "All": emails have their own log
  if (req.query.q) filter.$or = ["action", "detail", "resource", "ip", "after.title", "after.name", "before.title", "before.name"].map((field) => ({ [field]: searchRegex(req.query.q) }));
  const range = {};
  if (req.query.from && !Number.isNaN(Date.parse(req.query.from))) range.$gte = new Date(req.query.from).toISOString();
  if (req.query.to && !Number.isNaN(Date.parse(req.query.to))) range.$lte = new Date(new Date(req.query.to).getTime() + 86399999).toISOString();
  if (Object.keys(range).length) filter.at = range;
  if (req.query.userId) filter.userId = String(req.query.userId);
  const [entries, total, users] = await Promise.all([store.query("audit", filter, { sort: { at: -1 }, skip, limit }), store.count("audit", filter), store.list("users")]);
  const people = Object.fromEntries(users.map((u) => [u.id, { name: u.name, email: u.email }]));
  res.json({
    page, pages: Math.max(1, Math.ceil(total / limit)), total,
    users: users.map((u) => ({ id: u.id, name: u.name || u.email })),
    items: entries.map((e) => ({
      id: e.id, at: e.at || e.createdAt, action: e.action, resource: e.resource, category: categoryOf(e), resourceId: e.resourceId || null,
      subject: subjectOf(e), detail: e.detail || (e.resource === "email" ? `${e.subject || e.template} → ${e.to}` : ""),
      user: e.userId ? people[e.userId] || { name: "Deleted user", email: "" } : null,
      ip: e.ip || "", userAgent: e.userAgent || "", changes: e.action === "update" ? changesOf(e.before, e.after) : []
    }))
  });
}));

// Media library: list, rename / alt text, delete, upload.
app.get("/api/media", auth, asyncRoute(async (req, res) => res.json({ items: await store.list("media", await tenantFor(req)) })));
app.patch("/api/media/:id", auth, asyncRoute(async (req, res) => {
  const current = await store.find("media", { id: String(req.params.id), tenantId: await tenantFor(req) });
  if (!current) return res.status(404).json({ error: "Not found" });
  const patch = {};
  if (req.body.name !== undefined) patch.name = security.cleanText(req.body.name, 200) || current.name;
  if (req.body.alt !== undefined) patch.alt = security.cleanText(req.body.alt, 300);
  const next = await store.update("media", current.id, patch);
  await audit(req, "update", "media", current.id, current, next);
  res.json(next);
}));
app.delete("/api/media/:id", auth, asyncRoute(async (req, res) => {
  const current = await store.find("media", { id: String(req.params.id), tenantId: await tenantFor(req) });
  if (!current) return res.status(404).json({ error: "Not found" });
  if (current.url) await removeStoredFile(current.url);
  await store.remove("media", current.id);
  const clearedReferences = current.url ? await clearFileReferences(current.url) : [];
  await audit(req, "delete", "media", current.id, current, null);
  res.json({ ok: true, clearedReferences });
}));
// The admin hands back an image/video that was replaced or removed in a
// form. It's deleted only if no saved content uses it, so this can never
// take away something the live site shows (saving the form deletes that).
app.post("/api/media/discard", auth, asyncRoute(async (req, res) => {
  const url = String(req.body?.url || "");
  if (!/^\/uploads\/[A-Za-z0-9._-]+$/.test(url)) return res.status(400).json({ error: "Not an uploaded file" });
  const record = await store.find("media", { url });
  if (record && record.tenantId !== (await tenantFor(req))) return res.status(404).json({ error: "Not found" });
  const inUse = (await referencedUploads()).has(path.basename(url));
  if (!inUse) {
    await deleteFileIfUnreferenced(url);
    if (record) await audit(req, "delete", "media", record.id, record, null);
  }
  res.json({ ok: true, deleted: !inUse });
}));

// Shared by both the single-file and multi-file upload routes: verify and
// compress/transcode the file, store it in MongoDB under a random name with
// an extension that matches what it really is, and create its media record.
// The working copies on disk are removed either way.
async function ingestUploadedFile(file, { tenantId, alt, trim }) {
  const processed = await processMedia(file.path, store.UPLOAD_DIR, file.filename, file.mimetype, { trim });
  const safeName = `${file.filename}${extensionFor(processed)}`;
  let compressedSize;
  try {
    compressedSize = fs.statSync(processed.outputPath).size;
    await store.saveFile(safeName, processed.outputPath, { contentType: processed.mime, tenantId });
  } finally {
    await safeUnlink(processed.outputPath);
    if (file.path !== processed.outputPath) await safeUnlink(file.path);
  }
  return store.create("media", {
    tenantId, name: security.cleanText(file.originalname, 200), type: processed.mime,
    size: compressedSize, originalSize: file.size, compressed: processed.compressed,
    compressionPercent: Math.max(0, Math.round((1 - compressedSize / file.size) * 100)),
    width: processed.width || null, height: processed.height || null,
    url: `/uploads/${safeName}`, alt: security.cleanText(alt || file.originalname, 300), status: "published"
  });
}
const uploadError = (error) => (error.status === 400 ? error.message : NODE_ENV === "production" ? "Media processing failed" : `Media processing failed: ${error.message}`);

app.post("/api/media", auth, uploadLimiter, upload.single("file"), asyncRoute(async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "Only images (not SVG), videos and PDFs can be uploaded" });
  try {
    const item = await ingestUploadedFile(req.file, { tenantId: await tenantFor(req), alt: req.body.alt, trim: req.body.trim === "true" });
    await audit(req, "upload", "media", item.id, null, item);
    res.status(201).json(item);
  } catch (error) {
    if (req.file?.path && fs.existsSync(req.file.path)) await safeUnlink(req.file.path);
    if (error.status !== 400) console.error("Media processing failed:", error.stack || error.message || error);
    res.status(error.status === 400 ? 400 : 500).json({ error: uploadError(error) });
  }
}));
// Upload several files in one request. Each file is processed independently
// — one failure doesn't sink the rest.
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
      errors.push({ name: file.originalname, error: uploadError(error) });
    }
  }
  res.status(items.length ? 201 : 400).json({ items, errors });
}));

// --- SEO endpoints -----------------------------------------------------------
app.get("/sitemap.xml", asyncRoute(async (req, res) => {
  const tenant = await store.find("tenants", { slug: String(req.query.tenant || "gagnant-promoters") });
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

// Unknown API routes get a JSON 404 rather than falling through to the SPA's
// index.html below (which would make a typo'd endpoint look like it worked).
app.use("/api", (_req, res) => res.status(404).json({ error: "Not found" }));

// --- Serve the built frontend (production) -----------------------------------
// index.html carries no hardcoded title/description: the site name, page
// description and theme colour are filled in from the database here, so
// search engines and link previews (which don't run the app's JavaScript)
// see the real, current values.
const frontendDist = path.join(__dirname, "..", "frontend", "dist");
const indexCache = new Map();
const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
async function renderIndex() {
  const template = fs.readFileSync(path.join(frontendDist, "index.html"), "utf8");
  if (!store.isConnected()) return template;
  if (indexCache.has("index")) return indexCache.get("index");
  const tenant = await store.find("tenants", { slug: "gagnant-promoters" });
  const settings = tenant ? await store.find("settings", { tenantId: tenant.id }) : null;
  const name = companyNameOf(tenant, settings);
  const title = settings?.seo?.home?.title || settings?.content?.seo?.siteTitle || name;
  const description = settings?.seo?.home?.description || settings?.content?.seo?.defaultDescription || settings?.tagline || "";
  const meta = [
    `<title>${escapeHtml(title)}</title>`,
    description && `<meta name="description" content="${escapeHtml(description)}" />`,
    settings?.brand?.primary && `<meta name="theme-color" content="${escapeHtml(settings.brand.primary)}" />`,
    name && `<meta property="og:site_name" content="${escapeHtml(name)}" />`,
    `<meta property="og:title" content="${escapeHtml(title)}" />`,
    description && `<meta property="og:description" content="${escapeHtml(description)}" />`,
    `<meta name="twitter:title" content="${escapeHtml(title)}" />`,
    description && `<meta name="twitter:description" content="${escapeHtml(description)}" />`
  ].filter(Boolean).join("\n    ");
  const html = template.replace(/<title>[\s\S]*?<\/title>/, meta);
  indexCache.set("index", html);
  setTimeout(() => indexCache.delete("index"), 60 * 1000);
  return html;
}
if (fs.existsSync(frontendDist)) {
  app.use(express.static(frontendDist, { index: false }));
  app.get("*", asyncRoute(async (req, res) => {
    res.set("Cache-Control", "no-cache").type("html").send(await renderIndex());
  }));
} else if (NODE_ENV === "production") {
  console.warn(`\n⚠️  frontend/dist was not found. Run "npm run build" in frontend/ before starting in production.\n`);
}

app.use((err, req, res, _next) => {
  if (err.type === "entity.parse.failed") return res.status(400).json({ error: "Malformed request body" });
  if (err.type === "entity.too.large") return res.status(413).json({ error: "Request is too large" });
  // A short reference code ties what the browser shows to the full error in
  // this server's log — so "Unexpected server error" is never a dead end.
  const ref = crypto.randomBytes(3).toString("hex");
  console.error(`[error ${ref}] ${req.method} ${req.originalUrl}\n${err.stack || err}`);
  // Two requests racing to save the same unique value (e.g. a card link).
  if (err.code === 11000) return res.status(409).json({ error: "That conflicts with an existing item — try a different name or link.", ref });
  if (store.isCollectionLimitError(err)) return res.status(507).json({ error: `Couldn't save: ${store.COLLECTION_LIMIT_HELP}`, code: "collection_limit", ref });
  if (err.name === "MulterError") {
    const messages = {
      LIMIT_FILE_SIZE: `File is too large. The maximum upload size is ${Math.round(MAX_UPLOAD_BYTES / (1024 * 1024))} MB.`,
      LIMIT_UNEXPECTED_FILE: "Unexpected file field in the upload.",
      LIMIT_FILE_COUNT: "Too many files in one upload — try a smaller batch."
    };
    return res.status(400).json({ error: messages[err.code] || `Upload error: ${err.message}` });
  }
  res.status(500).json({ error: NODE_ENV === "production" ? `Unexpected server error (ref ${ref})` : `${err.message} (ref ${ref})`, ref });
});

// Listen first, connect second: the port is open from the very first second
// (requests get a 503 "starting up" until Mongo is ready — see the guard near
// the top), and a slow or flaky Atlas connection is retried with backoff
// instead of leaving nothing listening on PORT.
const server = app.listen(PORT, () => {
  console.log(`Gagnant platform API v${API_VERSION} (server.js) listening on port ${PORT} (public URL: ${process.env.APP_URL || `http://localhost:${PORT}`})`);
  console.log(`Environment: ${NODE_ENV}`);
});
server.on("error", (error) => {
  if (error.code === "EADDRINUSE") console.error(`\n⚠️  Port ${PORT} is already in use — another copy of the API is probably still running. Stop it, or set a different PORT in backend/.env (and VITE_DEV_PROXY_TARGET in frontend/.env to match).\n`);
  else console.error(error);
  process.exit(1);
});
// Slow-client protection: drop connections that dribble headers or bodies.
server.headersTimeout = 30 * 1000;
server.requestTimeout = 10 * 60 * 1000; // long enough for a large video upload

// --- Storage housekeeping -----------------------------------------------------
// Files are uploaded the moment they're picked in the admin, before the form
// is saved — so picking a second image before saving, or closing the form,
// leaves a file nothing uses. Saving already deletes a replaced or removed
// file straight away; this sweep catches everything else. A file (and its
// media record) that no content references is deleted once it's older than
// the grace period, which keeps an upload waiting for "Save" safe. The
// upload folder is only scratch space: anything in it that's already in
// MongoDB, or that nothing references, goes once it's an hour old.
const ORPHAN_GRACE_MS = 6 * 60 * 60 * 1000;
const SCRATCH_MAX_AGE_MS = 60 * 60 * 1000;
async function sweepStorage({ graceMs = ORPHAN_GRACE_MS } = {}) {
  const used = await referencedUploads();
  const cutoff = Date.now() - graceMs;
  let files = 0;
  let records = 0;
  let scratch = 0;
  const stored = await store.listFiles();
  for (const file of stored) {
    if (used.has(file.filename) || new Date(file.uploadDate).getTime() > cutoff) continue;
    await store.deleteFile(file.filename);
    files += 1;
  }
  for (const record of await store.list("media")) {
    const name = path.basename(String(record.url || ""));
    if (used.has(name) || new Date(record.createdAt || 0).getTime() > cutoff) continue;
    await store.deleteFile(name);
    await store.remove("media", record.id);
    records += 1;
  }
  const inDatabase = new Set(stored.map((f) => f.filename));
  for (const name of fs.existsSync(store.UPLOAD_DIR) ? fs.readdirSync(store.UPLOAD_DIR) : []) {
    const filePath = path.join(store.UPLOAD_DIR, name);
    const stat = fs.statSync(filePath, { throwIfNoEntry: false });
    if (!stat?.isFile() || Date.now() - stat.mtimeMs < SCRATCH_MAX_AGE_MS) continue;
    if (used.has(name) && !inDatabase.has(name)) continue; // never drop the only copy of a file in use
    await safeUnlink(filePath);
    scratch += 1;
  }
  console.log(files || records || scratch
    ? `[storage] Cleanup done: removed ${files} unused file(s) and ${records} unused media record(s) from MongoDB, and ${scratch} file(s) from ${store.UPLOAD_DIR}.`
    : "[storage] Cleanup done: nothing to remove.");
  return { files, records, scratch };
}
function scheduleStorageSweep() {
  const run = () => sweepStorage().catch((error) => console.error("[storage] Cleanup failed:", error.message));
  run();
  setInterval(run, 60 * 60 * 1000).unref();
}

async function connectDatabase(attempt = 1) {
  try {
    await store.connect();
    scheduleStorageSweep();
  } catch (error) {
    if (!process.env.MONGO_URI) {
      console.error(`\n⚠️  ${error.message}\n`);
      process.exit(1);
    }
    const delay = Math.min(30000, 2000 * attempt);
    console.error(`[store] Could not connect to MongoDB (attempt ${attempt}): ${error.message} — retrying in ${delay / 1000}s. Check MONGO_URI in backend/.env and that this machine's IP is allowed in Atlas → Network Access.`);
    setTimeout(() => connectDatabase(attempt + 1), delay);
  }
}
connectDatabase();
