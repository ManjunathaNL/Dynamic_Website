const fs = require("fs");
const path = require("path");
const { pipeline } = require("stream/promises");

// One-time data migrations, run on every start and idempotent.
//
// legacy-content: the public site used to have its wording (hero headline,
// stats, process steps, page headings…) written into the frontend code. All
// of that now lives in settings.content and is edited in the admin under
// "Website content". For a site that existed before that change, the exact
// wording it was showing is copied into its database record once, so the
// live site looks the same after the upgrade — and from then on every line
// can be edited or deleted. New installs skip this and start empty.
const LEGACY_CONTENT = {
  nav: { home: "Home", about: "About Us", services: "Services", projects: "Projects", blog: "Blog", contact: "Contact Us", cta: "Start a conversation" },
  home: {
    heroEyebrow: "Construction · Interiors · Project Delivery",
    heroTitle: "Building with *purpose.*\nDelivering with discipline.",
    heroLede: "We bring clarity to complex builds, from first scope to final handover. Thoughtful spaces. Dependable delivery.",
    primaryCtaLabel: "Discuss your project",
    primaryCtaLink: "/contact",
    secondaryCtaLabel: "Explore our work",
    secondaryCtaLink: "/projects",
    stampNumber: "01",
    stampText: "One accountable\ndelivery partner",
    trustLabel: "Trusted to deliver across",
    trustItems: ["Corporate & MNC", "Industrial", "Commercial", "Residential"],
    introEyebrow: "The Gagnant way",
    introTitle: "Good work is built on *good thinking.*",
    introText: "Gagnant Promoters is a construction, interiors and project management partner for teams who value a clear plan, a steady hand and a finished space that works.",
    introLinkLabel: "Get to know us"
  },
  sections: {
    services: { eyebrow: "What we do", title: "Built around your *ambition.*", linkLabel: "See all services" },
    projects: { eyebrow: "Selected work", title: "Made for the *real world.*", linkLabel: "See all projects" },
    clients: { eyebrow: "Trusted by", title: "Brands we’ve *delivered for.*", linkLabel: "" },
    reviews: { eyebrow: "Google reviews", title: "Rated by the people *we build for.*", linkLabel: "See all reviews on Google" },
    blog: { eyebrow: "From the field", title: "Ideas worth *building on.*", linkLabel: "See all insights" }
  },
  stats: [
    { value: "7", label: "Integrated\ncapabilities" },
    { value: "Pan–India", label: "Project\ncapability" },
    { value: "01", label: "Accountable\npartner" },
    { value: "100%", label: "Ownership\nof delivery" }
  ],
  process: {
    eyebrow: "How we work",
    title: "Progress you can *see.*",
    text: "We turn moving parts into a shared rhythm — with a clear scope, visible decisions and no surprises.",
    steps: [
      { title: "Scope", text: "Understand the brief" },
      { title: "Plan", text: "Make the next move" },
      { title: "Mobilise", text: "Make the next move" },
      { title: "Execute", text: "Make the next move" },
      { title: "Control", text: "Make the next move" },
      { title: "Handover", text: "Leave it better" }
    ]
  },
  pages: {
    about: { eyebrow: "About Gagnant Promoters", title: "Good work is built on good thinking.", lede: "" },
    services: { eyebrow: "What we do", title: "Built around your ambition.", lede: "From structure to finish, our capabilities work together to make the project simpler for you." },
    projects: { eyebrow: "Selected work", title: "Made for the real world.", lede: "" },
    blog: { eyebrow: "From the field", title: "Ideas worth building on.", lede: "" },
    contact: { eyebrow: "Contact Us", title: "Let’s start the conversation.", lede: "Reach out however works best for you — phone, WhatsApp, email or the form below." }
  },
  contact: {
    eyebrow: "Let’s build something",
    title: "Have a project\n*in mind?*",
    text: "Tell us a little about it. We’ll come back with the right next step.",
    submitLabel: "Send enquiry",
    successTitle: "Message received.",
    successText: "Thank you. Our team will be in touch shortly."
  },
  detail: {
    approachEyebrow: "Our approach",
    approachTitle: "A clear path from brief to handover.",
    insightEyebrow: "The insight",
    insightTitle: "Ideas worth building on.",
    ctaLabel: "Discuss this project",
    contactEyebrow: "Keep the conversation moving",
    contactTitle: "Let’s make the\n*next move.*"
  },
  seo: {
    siteTitle: "Gagnant Promoters | Construction, Interiors & Project Management",
    defaultDescription: "Pan-India construction, interiors and project delivery with disciplined execution."
  },
  categories: {
    services: ["Residential", "Commercial", "Industrial", "Interiors", "Management"],
    projects: ["Commercial", "Industrial", "Residential", "Institutional", "Retail"]
  }
};
// The About page used to fall back to this when no company overview was set.
const LEGACY_ABOUT_LEDE = "Gagnant Promoters is a construction, interiors and project management partner for teams who value a clear plan, a steady hand and a finished space that works.";
const LEGACY_PAGE_SEO = {
  services: "Explore our construction and interior capabilities.",
  projects: "Selected work delivered by Gagnant Promoters.",
  blog: "Insights from the field.",
  contact: "Get in touch with Gagnant Promoters."
};

async function migrateLegacyContent(db) {
  const settingsList = await db.collection("settings").find({ content: { $exists: false } }).toArray();
  for (const settings of settingsList) {
    const tenant = await db.collection("tenants").findOne({ id: settings.tenantId });
    const content = JSON.parse(JSON.stringify(LEGACY_CONTENT));
    if (!settings.overview) content.pages.about.lede = LEGACY_ABOUT_LEDE;
    const seo = { ...(settings.seo || {}) };
    for (const [page, description] of Object.entries(LEGACY_PAGE_SEO)) {
      if (!seo[page]?.description) seo[page] = { ...(seo[page] || {}), description };
    }
    await db.collection("settings").updateOne(
      { _id: settings._id },
      { $set: { content, seo, companyName: settings.companyName || tenant?.name || "", updatedAt: new Date().toISOString() } }
    );
    console.log(`[migrations] Moved the site's built-in wording into the database for "${tenant?.name || settings.tenantId}" — edit it under Website content in the admin.`);
  }
}

// local-uploads: uploaded images/videos used to be kept only as files on the
// server's disk. They now live in MongoDB (GridFS bucket "uploads"), so the
// database alone holds the whole site. Any file a media record points at that
// is still only on disk is copied in once; the disk copy is left untouched as
// a backup and can be deleted afterwards.
const TYPE_BY_EXTENSION = { ".webp": "image/webp", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".gif": "image/gif", ".avif": "image/avif", ".tiff": "image/tiff", ".heic": "image/heic", ".mp4": "video/mp4", ".pdf": "application/pdf" };

async function importLocalUploads(db, { uploads, uploadDir }) {
  const media = await db.collection("media").find({ url: { $regex: "^/uploads/" } }).toArray();
  let imported = 0;
  const missing = [];
  for (const record of media) {
    const name = path.basename(record.url);
    if (await db.collection("uploads.files").findOne({ filename: name }, { projection: { _id: 1 } })) continue;
    const filePath = path.join(uploadDir, name);
    if (!fs.existsSync(filePath)) { missing.push(name); continue; }
    const contentType = record.type || TYPE_BY_EXTENSION[path.extname(name).toLowerCase()] || "application/octet-stream";
    await pipeline(fs.createReadStream(filePath), uploads.openUploadStream(name, { metadata: { contentType, tenantId: record.tenantId || null } }));
    imported += 1;
  }
  if (imported) console.log(`[migrations] Copied ${imported} uploaded file(s) from ${uploadDir} into MongoDB — images and videos are now served from the database.`);
  if (missing.length) console.warn(`[migrations] ${missing.length} media record(s) point at a file that is neither in MongoDB nor in ${uploadDir}: ${missing.join(", ")}`);
}

async function runMigrations(db, options) {
  await migrateLegacyContent(db);
  await importLocalUploads(db, options);
}

module.exports = { runMigrations };
