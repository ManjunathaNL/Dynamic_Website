// Security building blocks for the API: session cookies + CSRF, input
// sanitising/validation, password policy and origin checks.
//
// Admin sessions are a signed JWT in an httpOnly, SameSite=Strict cookie, so
// page scripts can never read it (an XSS bug can't steal a session) and
// other sites can't ride it. Every state-changing admin request must also
// echo a per-session CSRF token (double-submit, bound inside the JWT).
const crypto = require("crypto");

const SESSION_COOKIE = "gp_session";
const CSRF_COOKIE = "gp_csrf";
const SESSION_HOURS = 8;

function parseCookies(header = "") {
  const out = {};
  header.split(";").forEach((part) => {
    const index = part.indexOf("=");
    if (index < 0) return;
    const key = part.slice(0, index).trim();
    if (!key) return;
    try {
      out[key] = decodeURIComponent(part.slice(index + 1).trim());
    } catch {
      out[key] = part.slice(index + 1).trim();
    }
  });
  return out;
}

// Secure cookies need HTTPS; localhost counts as secure in browsers, so this
// only relaxes for plain-HTTP LAN testing outside production.
function cookieBase(req) {
  const local = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(req.get("host") || "");
  const secure = process.env.COOKIE_SECURE === "false" ? false : req.secure || (process.env.NODE_ENV === "production" && !local);
  return { secure, sameSite: "strict", path: "/" };
}
function setSessionCookies(req, res, token, csrf) {
  const base = cookieBase(req);
  const maxAge = SESSION_HOURS * 60 * 60 * 1000;
  res.cookie(SESSION_COOKIE, token, { ...base, httpOnly: true, maxAge });
  // Readable by the admin app on purpose — it's the CSRF token it echoes
  // back in a header, which a cross-site attacker can't read or forge.
  res.cookie(CSRF_COOKIE, csrf, { ...base, httpOnly: false, maxAge });
}
function clearSessionCookies(req, res) {
  const base = cookieBase(req);
  res.clearCookie(SESSION_COOKIE, { ...base, httpOnly: true });
  res.clearCookie(CSRF_COOKIE, { ...base, httpOnly: false });
}
const newCsrfToken = () => crypto.randomBytes(32).toString("hex");
function safeEqual(a, b) {
  const x = Buffer.from(String(a || ""));
  const y = Buffer.from(String(b || ""));
  return x.length === y.length && x.length > 0 && crypto.timingSafeEqual(x, y);
}

// Strip MongoDB operator / dotted keys and prototype-pollution keys from
// anything a client sends, so a body like {"email": {"$ne": ""}} or
// {"__proto__": …} can never reach a query or an update.
const BAD_KEY = /^\$|\.|^__proto__$|^constructor$|^prototype$/;
function sanitize(value, depth = 0) {
  if (depth > 8) return undefined;
  if (Array.isArray(value)) return value.slice(0, 200).map((v) => sanitize(v, depth + 1));
  if (value && typeof value === "object") {
    const out = {};
    for (const [key, v] of Object.entries(value)) if (!BAD_KEY.test(key)) out[key] = sanitize(v, depth + 1);
    return out;
  }
  return value;
}
function sanitizeRequest(req, _res, next) {
  if (req.body) req.body = sanitize(req.body);
  if (req.query) req.query = sanitize(req.query);
  next();
}

// Links that end up in href/src on the public site: only http(s), site-
// relative paths, mailto: and tel: — never javascript:, data: or vbscript:.
const SAFE_URL = /^(https?:\/\/[^\s<>"']+|\/(?!\/)[^\s<>"']*|mailto:[^\s<>"']+|tel:[+\d\s()-]+)$/i;
const safeUrl = (value) => {
  const s = String(value ?? "").trim();
  return s && SAFE_URL.test(s) ? s : "";
};
const cleanText = (value, max) =>
  String(value ?? "")
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .replace(/<\s*\/?\s*(script|iframe|object|embed|style)[^>]*>/gi, "")
    .trim()
    .slice(0, max);

// Field schemas: text(max) / url / list(of, max) / number(min,max) / enum.
const t = {
  text: (max = 200) => ({ kind: "text", max }),
  url: () => ({ kind: "url" }),
  list: (of, max = 50) => ({ kind: "list", of, max }),
  number: (min, max) => ({ kind: "number", min, max }),
  oneOf: (...values) => ({ kind: "enum", values }),
  color: () => ({ kind: "color" }),
  bool: () => ({ kind: "bool" })
};
function coerce(spec, value) {
  if (value === undefined) return undefined;
  switch (spec.kind) {
    case "text": return cleanText(value, spec.max);
    case "url": return safeUrl(value);
    case "number": {
      const n = Number(value);
      return Number.isFinite(n) ? Math.min(spec.max, Math.max(spec.min, n)) : undefined;
    }
    case "enum": return spec.values.includes(value) ? value : undefined;
    case "color": return /^#[0-9a-f]{3,8}$/i.test(String(value)) ? String(value) : undefined;
    case "bool": return Boolean(value);
    case "list": return (Array.isArray(value) ? value : []).slice(0, spec.max).map((v) => coerce(spec.of, v)).filter((v) => v !== undefined && v !== "");
    case "object": return validateObject(spec.fields, value);
    default: return undefined;
  }
}
// Keeps only known fields, coerced to their type — anything else a client
// sends (role, tenantId, internal counters, injected keys) is dropped.
function validateObject(fields, input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  const out = {};
  for (const [key, spec] of Object.entries(fields)) {
    const value = coerce(spec, input[key]);
    if (value !== undefined) out[key] = value;
  }
  return out;
}
const object = (fields) => ({ kind: "object", fields });

const status = t.oneOf("draft", "published", "archived");
const seo = { seoTitle: t.text(160), seoDescription: t.text(320) };
const RESOURCE_SCHEMAS = {
  services: { title: t.text(160), slug: t.text(120), category: t.text(60), description: t.text(1200), content: t.text(20000), imageUrl: t.url(), benefits: t.list(t.text(240), 30), status, ...seo },
  projects: { title: t.text(160), slug: t.text(120), category: t.text(60), client: t.text(160), location: t.text(160), year: t.text(12), imageUrl: t.url(), videoUrl: t.url(), summary: t.text(8000), status, ...seo },
  blogs: { title: t.text(200), slug: t.text(140), category: t.text(60), coverUrl: t.url(), excerpt: t.text(800), body: t.text(60000), publishedAt: t.text(40), status, ...seo },
  testimonials: { name: t.text(120), role: t.text(160), quote: t.text(2000), rating: t.number(1, 5), photoUrl: t.url(), slug: t.text(120), status },
  clients: { name: t.text(160), logoUrl: t.url(), websiteUrl: t.url(), slug: t.text(120), status },
  cards: {
    name: t.text(120), slug: t.text(120), designation: t.text(120), phone: t.text(40), whatsapp: t.text(20), email: t.text(160),
    website: t.url(), address: t.text(300), bio: t.text(1500), linkedin: t.url(), instagram: t.url(), facebook: t.url(),
    photoUrl: t.url(), coverUrl: t.url(), status
  }
};

const pageSeo = object({ title: t.text(160), description: t.text(320) });
const heading = { eyebrow: t.text(120), title: t.text(240), linkLabel: t.text(80) };
const pageHero = object({ eyebrow: t.text(120), title: t.text(240), lede: t.text(800) });
const CONTENT_SCHEMA = object({
  nav: object({ home: t.text(40), about: t.text(40), services: t.text(40), projects: t.text(40), blog: t.text(40), contact: t.text(40), cta: t.text(60) }),
  home: object({
    heroEyebrow: t.text(160), heroTitle: t.text(300), heroLede: t.text(800),
    primaryCtaLabel: t.text(60), primaryCtaLink: t.url(), secondaryCtaLabel: t.text(60), secondaryCtaLink: t.url(),
    stampNumber: t.text(10), stampText: t.text(120), trustLabel: t.text(120), trustItems: t.list(t.text(80), 12),
    introEyebrow: t.text(120), introTitle: t.text(300), introText: t.text(1500), introLinkLabel: t.text(80)
  }),
  sections: object({
    services: object(heading), projects: object(heading), clients: object(heading), reviews: object(heading), blog: object(heading)
  }),
  stats: t.list(object({ value: t.text(30), label: t.text(80) }), 8),
  process: object({ eyebrow: t.text(120), title: t.text(240), text: t.text(800), steps: t.list(object({ title: t.text(60), text: t.text(160) }), 12) }),
  pages: object({ about: pageHero, services: pageHero, projects: pageHero, blog: pageHero, contact: pageHero }),
  contact: object({ eyebrow: t.text(120), title: t.text(240), text: t.text(800), submitLabel: t.text(60), successTitle: t.text(120), successText: t.text(300) }),
  detail: object({
    approachEyebrow: t.text(120), approachTitle: t.text(240), insightEyebrow: t.text(120), insightTitle: t.text(240),
    ctaLabel: t.text(60), contactEyebrow: t.text(120), contactTitle: t.text(240)
  }),
  seo: object({ siteTitle: t.text(160), defaultDescription: t.text(320) }),
  categories: object({ services: t.list(t.text(60), 30), projects: t.list(t.text(60), 30) })
});
const SETTINGS_SCHEMA = {
  companyName: t.text(120),
  tagline: t.text(300),
  announcement: t.text(300),
  overview: t.text(3000),
  vision: t.text(1500),
  mission: t.text(1500),
  values: t.list(t.text(80), 20),
  brand: object({
    primary: t.color(), secondary: t.color(), accent: t.color(), surface: t.color(), text: t.color(), muted: t.color(),
    radius: t.text(10), font: t.text(60), logoUrl: t.url(), heroUrl: t.url(), heroVideo: t.url(), heroImages: t.list(t.url(), 12),
    // Homepage banner slider: images and/or videos, in display order.
    heroSlides: t.list(object({ type: t.oneOf("image", "video"), url: t.url() }), 12)
  }),
  contact: object({ email: t.text(160), secondaryEmail: t.text(160), phone: t.text(40), whatsapp: t.text(20), address: t.text(300), hours: t.text(160) }),
  social: object({ instagram: t.url(), linkedin: t.url(), facebook: t.url(), youtube: t.url() }),
  seo: object({ home: pageSeo, about: pageSeo, services: pageSeo, projects: pageSeo, blog: pageSeo, contact: pageSeo }),
  pageBanners: object({ about: t.url(), services: t.url(), projects: t.url(), blog: t.url(), contact: t.url() }),
  googleReviews: object({
    enabled: t.bool(), placeId: t.text(300), apiKey: t.text(200), reviewUrl: t.url(), showOnHome: t.bool(), showOnContact: t.bool(), showOnCards: t.bool(),
    minRating: t.number(1, 5), maxReviews: t.number(1, 10), cacheMinutes: t.number(5, 1440), clearApiKey: t.bool()
  }),
  content: CONTENT_SCHEMA,
  features: object({ blog: t.bool(), video: t.bool(), testimonials: t.bool() })
};
const validateResource = (resource, body) => validateObject(RESOURCE_SCHEMAS[resource] || {}, body);
// Only the top-level settings keys actually present in the request are
// returned, so a partial save stays partial.
function validateSettings(body) {
  const out = {};
  for (const [key, spec] of Object.entries(SETTINGS_SCHEMA)) {
    if (body?.[key] === undefined) continue;
    const value = coerce(spec, body[key]);
    if (value !== undefined) out[key] = value;
  }
  return out;
}

const COMMON_PASSWORDS = new Set(["admin123", "password", "password1", "12345678", "123456789", "1234567890", "qwerty123", "admin@123", "welcome123", "gagnant123"]);
function passwordProblem(password, email = "") {
  const p = String(password || "");
  if (p.length < 10) return "Password must be at least 10 characters";
  if (p.length > 128) return "Password is too long";
  if (!/[a-z]/i.test(p) || !/\d/.test(p)) return "Password must include both letters and numbers";
  if (COMMON_PASSWORDS.has(p.toLowerCase())) return "That password is too common — choose another";
  if (email && p.toLowerCase().includes(String(email).split("@")[0].toLowerCase())) return "Password must not contain your email name";
  return null;
}

// State-changing requests from a browser must come from this site (or an
// explicitly allowed origin) — a second line of defence behind SameSite
// cookies and CSRF tokens, and the only one for public forms.
function sameOriginGuard(allowedOrigins) {
  return (req, res, next) => {
    if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
    const origin = req.get("origin");
    if (!origin || allowedOrigins.includes("*") || allowedOrigins.includes(origin)) return next();
    try {
      if (new URL(origin).host === req.get("host")) return next();
    } catch {
      /* malformed Origin header → reject below */
    }
    res.status(403).json({ error: "Request blocked: cross-site request" });
  };
}

module.exports = {
  SESSION_COOKIE, CSRF_COOKIE, SESSION_HOURS, parseCookies, setSessionCookies, clearSessionCookies, newCsrfToken, safeEqual,
  sanitizeRequest, safeUrl, cleanText, validateResource, validateSettings, passwordProblem, sameOriginGuard, RESOURCE_SCHEMAS
};
