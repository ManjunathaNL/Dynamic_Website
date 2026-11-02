// Outgoing email. Every email the app sends is a template in TEMPLATES below,
// editable in the admin (Admin settings → Email templates): wording, on/off,
// preview and test. Saved edits live in settings.emailTemplates; anything
// left empty uses the default here.
//
// The SMTP server is configured in the admin (Admin settings → Email), stored
// in settings.mail. If that's empty, SMTP_* from .env is used instead. With
// neither, sending is skipped — nothing else breaks.
// MAIL_OUTBOX_DIR (development/testing): write each email to that folder as
// .eml + .html instead of sending it, to preview templates locally.
//
// Every send attempt (sent, failed, skipped) is reported to the logger set
// with setLogger() — server.js records it in the email log.
const fs = require("fs");
const path = require("path");
const nodemailer = require("nodemailer");

// --- SMTP configuration -------------------------------------------------------
const truthy = (value) => value === true || value === "true" || value === "ssl";
// Resolved per send from the tenant's settings, falling back to .env.
function smtpConfig(settings) {
  const db = settings?.mail || {};
  if (db.host && db.user && db.pass) {
    return {
      source: "admin", host: db.host, port: Number(db.port) || 587, secure: truthy(db.secure),
      user: db.user, pass: db.pass, fromEmail: db.fromEmail || db.user, fromName: db.fromName || "", notifyTo: db.notifyTo || ""
    };
  }
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_SECURE, SMTP_FROM, SMTP_FROM_NAME, LEAD_NOTIFY_TO } = process.env;
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) return null;
  return {
    source: "env", host: SMTP_HOST, port: Number(SMTP_PORT) || 587,
    // SMTP_SECURE overrides the port-based guess when set — some providers
    // run TLS-from-the-start ("secure") on ports other than 465.
    secure: SMTP_SECURE != null ? SMTP_SECURE === "true" : Number(SMTP_PORT) === 465,
    user: SMTP_USER, pass: SMTP_PASS, fromEmail: SMTP_FROM || SMTP_USER, fromName: SMTP_FROM_NAME || "", notifyTo: LEAD_NOTIFY_TO || ""
  };
}

// One transporter per distinct configuration, so changing the SMTP settings
// in the admin takes effect on the very next email.
const transporters = new Map();
let outbox = null;
let warned = false;
function getTransporter(config) {
  if (process.env.MAIL_OUTBOX_DIR) {
    if (!outbox) {
      fs.mkdirSync(process.env.MAIL_OUTBOX_DIR, { recursive: true });
      outbox = nodemailer.createTransport({ streamTransport: true, buffer: true, newline: "unix" });
    }
    return outbox;
  }
  if (!config) {
    if (!warned) console.log("[mailer] SMTP not configured — emails are disabled. Set it up in the admin under Admin settings → Email (or SMTP_* in backend/.env).");
    warned = true;
    return null;
  }
  const key = JSON.stringify([config.host, config.port, config.secure, config.user, config.pass]);
  if (!transporters.has(key)) {
    if (transporters.size > 10) transporters.clear();
    transporters.set(key, nodemailer.createTransport({
      host: config.host, port: config.port, secure: config.secure, auth: { user: config.user, pass: config.pass },
      connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 15000
    }));
  }
  return transporters.get(key);
}
const isConfigured = (settings) => Boolean(process.env.MAIL_OUTBOX_DIR || smtpConfig(settings));
const activeSource = (settings) => (process.env.MAIL_OUTBOX_DIR ? "outbox" : smtpConfig(settings)?.source || "none");
const fromHeader = (config) => {
  const address = config?.fromEmail || "no-reply@localhost";
  return config?.fromName ? `"${config.fromName.replace(/"/g, "")}" <${address}>` : address;
};
async function deliver(settings, message) {
  const config = smtpConfig(settings);
  const transporter = getTransporter(config);
  if (!transporter) {
    const error = new Error("Email isn't set up yet — add your SMTP server under Admin settings → Email.");
    error.reason = "smtp-not-configured";
    throw error;
  }
  const info = await transporter.sendMail({ from: fromHeader(config), ...message });
  if (process.env.MAIL_OUTBOX_DIR && info.message) {
    const base = path.join(process.env.MAIL_OUTBOX_DIR, `${Date.now()}-${String(message.to).replace(/[^a-z0-9@.]+/gi, "_")}`);
    fs.writeFileSync(`${base}.eml`, info.message);
    if (message.html) fs.writeFileSync(`${base}.html`, message.html);
    fs.writeFileSync(`${base}.json`, JSON.stringify({ to: message.to, subject: message.subject, text: message.text }, null, 2));
  }
  return info;
}
// "Send test email" on the Email (SMTP) tab: checks the settings in the form
// and reports the mail server's own error message.
async function verifySmtp(settings) {
  if (process.env.MAIL_OUTBOX_DIR) return { ok: true, source: "outbox" };
  const config = smtpConfig(settings);
  if (!config) throw new Error("Fill in the SMTP host, username and password first.");
  await getTransporter(config).verify();
  return { ok: true, source: config.source };
}

// --- Templates ----------------------------------------------------------------
const COMMON_PLACEHOLDERS = ["companyName", "loginUrl", "year"];
const TEMPLATES = {
  forgotPassword: {
    group: "Account", label: "Password reset link", recipient: "The person who asked to reset their password",
    description: "Sent when someone clicks “Forgot password?” on the sign-in page.",
    placeholders: ["firstName", "name", "email", "resetUrl", "expiresMinutes"], button: "resetUrl",
    defaults: {
      enabled: true, subject: "Reset your {{companyName}} admin password", eyebrow: "Password reset", buttonLabel: "Reset password",
      body: "Hello {{firstName}},\n\nWe received a request to reset the password for your {{companyName}} admin account ({{email}}). The link below is valid for {{expiresMinutes}} minutes and works once.\n\nIf you did not ask for this, you can safely ignore this email — your password stays the same."
    }
  },
  passwordChanged: {
    group: "Account", label: "Password changed", recipient: "The account owner",
    description: "Sent after a password is changed or reset, as a security confirmation.",
    placeholders: ["firstName", "name", "email", "changedAt"], button: "loginUrl",
    defaults: {
      enabled: true, subject: "Your {{companyName}} admin password was changed", eyebrow: "Security notice", buttonLabel: "Go to the admin",
      body: "Hello {{firstName}},\n\nThe password for your {{companyName}} admin account ({{email}}) was changed on {{changedAt}}, and every other signed-in session was signed out.\n\nIf this was you, there's nothing else to do. If it wasn't:\n- reset your password straight away from the sign-in page\n- let the site owner know"
    }
  },
  welcome: {
    group: "Users", label: "Welcome and sign-in details", recipient: "The new user",
    description: "Sent when an owner adds a user. The email and temporary password are shown below the message.",
    placeholders: ["firstName", "name", "email", "role", "invitedBy", "expiresIn"], button: "loginUrl", credentials: true,
    defaults: {
      enabled: true, subject: "Welcome to the {{companyName}} website admin", eyebrow: "Welcome aboard", buttonLabel: "Sign in to the admin",
      body: "Hello {{firstName}},\n\n{{invitedBy}} has given you {{role}} access to manage the {{companyName}} website. Here are your sign-in details:\n\n- sign in with your email and the temporary password below\n- choose your own password — the temporary one stops working once you do\n- the temporary password expires in {{expiresIn}}"
    }
  },
  passwordReset: {
    group: "Users", label: "Temporary password from an owner", recipient: "The user whose password was reset",
    description: "Sent when an owner resets someone's password from Users. The temporary password is shown below the message.",
    placeholders: ["firstName", "name", "email", "invitedBy", "expiresIn"], button: "loginUrl", credentials: true,
    defaults: {
      enabled: true, subject: "Your {{companyName}} admin password has been reset", eyebrow: "Password reset", buttonLabel: "Sign in to the admin",
      body: "Hello {{firstName}},\n\n{{invitedBy}} has reset the password for your {{companyName}} admin account. Use the temporary password below to sign in — you'll be asked to choose a new one straight away.\n\nThe temporary password expires in {{expiresIn}}."
    }
  },
  leadNotification: {
    group: "Enquiries", label: "New website enquiry", recipient: "Your team (enquiry notification address, or the contact email)",
    description: "Sent to your team when someone submits the website's contact form.",
    placeholders: ["leadName", "leadEmail", "leadPhone", "leadMessage", "manageUrl"], button: "manageUrl", details: true,
    defaults: {
      enabled: true, subject: "New enquiry — {{leadName}}", eyebrow: "New enquiry", buttonLabel: "Open in the admin",
      body: "{{leadName}} just sent an enquiry through the {{companyName}} website. Their details are below — reply to this email to answer them directly."
    }
  },
  cardLeadNotification: {
    group: "Enquiries", label: "New contact from a business card", recipient: "The card's owner and your team",
    description: "Sent when someone shares their details from a digital business card.",
    placeholders: ["leadName", "leadEmail", "leadPhone", "leadMessage", "cardName", "manageUrl"], button: "manageUrl", details: true,
    defaults: {
      enabled: true, subject: "New contact via {{cardName}}'s business card — {{leadName}}", eyebrow: "New contact", buttonLabel: "Open in the admin",
      body: "{{leadName}} shared their details from {{cardName}}'s digital business card. Their details are below — reply to this email to answer them directly."
    }
  },
  leadAutoReply: {
    group: "Enquiries", label: "Thank-you to the person who enquired", recipient: "The person who sent the enquiry (when they gave an email)",
    description: "An automatic acknowledgement, so people know their message arrived.",
    placeholders: ["leadName", "firstName", "leadMessage"], button: null,
    defaults: {
      enabled: false, subject: "Thanks for contacting {{companyName}}", eyebrow: "Message received", buttonLabel: "",
      body: "Hello {{firstName}},\n\nThank you for getting in touch with {{companyName}}. We've received your message and someone from our team will get back to you shortly.\n\n— The {{companyName}} team"
    }
  }
};
const TEMPLATE_KINDS = Object.keys(TEMPLATES);
const EDITABLE = ["enabled", "eyebrow", "subject", "body", "buttonLabel"];

function templateFor(settings, kind) {
  const saved = settings?.emailTemplates?.[kind] || {};
  const base = TEMPLATES[kind].defaults;
  return {
    enabled: typeof saved.enabled === "boolean" ? saved.enabled : base.enabled,
    ...Object.fromEntries(["eyebrow", "subject", "body", "buttonLabel"].map((key) => [key, String(saved[key] || "").trim() || base[key]]))
  };
}
const isEnabled = (settings, kind) => templateFor(settings, kind).enabled;

const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const safeColor = (value, fallback) => (/^#[0-9a-f]{3,8}$/i.test(String(value || "")) ? value : fallback);
const fill = (text, values) => String(text || "").replace(/\{\{\s*(\w+)\s*\}\}/g, (match, key) => (key in values ? String(values[key] ?? "") : match));

// Message text → blocks: a blank line starts a new paragraph, lines starting
// with "- " become a bullet list.
function blocksOf(text) {
  return String(text || "").split(/\n\s*\n/).map((chunk) => chunk.split("\n")).filter((lines) => lines.some((l) => l.trim())).flatMap((lines) => {
    const out = [];
    let para = [];
    let list = [];
    const flushPara = () => { if (para.length) out.push({ type: "p", lines: para }); para = []; };
    const flushList = () => { if (list.length) out.push({ type: "ul", items: list }); list = []; };
    for (const line of lines) {
      const bullet = line.match(/^\s*[-•]\s+(.*)$/);
      if (bullet) { flushPara(); list.push(bullet[1]); } else if (line.trim()) { flushList(); para.push(line.trim()); }
    }
    flushPara();
    flushList();
    return out;
  });
}

// Table-based, inline-styled HTML (what email clients — Gmail, Outlook,
// Apple Mail — actually render), in the site's brand colours, plus a plain
// text version for clients that don't show HTML.
//   values: placeholder values; details: [label, value] rows shown in a box.
function render(settings, kind, { values = {}, details = null, template: override } = {}) {
  const spec = TEMPLATES[kind];
  const template = override || templateFor(settings, kind);
  const accent = safeColor(settings?.brand?.primary, "#c86b32");
  const dark = safeColor(settings?.brand?.secondary, "#14221f");
  const all = { year: String(new Date().getFullYear()), ...values };
  const companyName = all.companyName || "your website";
  const subject = fill(template.subject, all).replace(/[\r\n]+/g, " ").trim().slice(0, 200);
  const blocks = blocksOf(fill(template.body, all));
  const eyebrow = fill(template.eyebrow, all);
  const buttonUrl = spec.button ? all[spec.button] : "";
  const buttonLabel = buttonUrl ? fill(template.buttonLabel, all) : "";

  const text = [
    ...blocks.flatMap((b) => [b.type === "p" ? b.lines.join("\n") : b.items.map((i) => `  • ${i}`).join("\n"), ""]),
    ...(details ? [...details.map(([k, v]) => `${k}: ${v || "—"}`), ""] : []),
    ...(buttonLabel ? [`${buttonLabel}: ${buttonUrl}`, ""] : []),
    `— ${companyName}`
  ].join("\n");
  const logo = all.logoUrl
    ? `<img src="${esc(all.logoUrl)}" alt="${esc(companyName)}" height="44" style="display:block;height:44px;max-width:200px;border:0;background:#ffffff;border-radius:8px;padding:6px 10px;">`
    : `<span style="font:800 18px Arial,Helvetica,sans-serif;letter-spacing:2px;color:#ffffff;">${esc(companyName.toUpperCase())}</span>`;
  const blockHtml = blocks.map((b) => (b.type === "p"
    ? `<p style="margin:0 0 18px;color:#4e5b54;">${b.lines.map(esc).join("<br>")}</p>`
    : `<ul style="margin:0 0 18px;padding-left:22px;color:#4e5b54;">${b.items.map((i) => `<li style="margin:0 0 6px;">${esc(i)}</li>`).join("")}</ul>`)).join("\n");
  const detailsHtml = details
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f8f6f1;border:1px solid #ece8df;border-radius:12px;margin:0 0 8px;">
${details.map(([label, value], i) => `<tr><td style="padding:${i ? 4 : 18}px 20px 4px;font:12px Arial,Helvetica,sans-serif;color:#67716c;text-transform:uppercase;letter-spacing:1px;">${esc(label)}</td></tr>
<tr><td style="padding:0 20px ${i === details.length - 1 ? 18 : 12}px;font:${/password/i.test(label) ? "700 18px 'Courier New',Courier,monospace" : "16px Arial,Helvetica,sans-serif"};color:#18201d;word-break:break-word;">${esc(value || "—").replace(/\n/g, "<br>")}</td></tr>`).join("\n")}
</table>`
    : "";
  const buttonHtml = buttonLabel
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:22px 0 8px;"><tr><td style="border-radius:40px;background:${accent};">
<a href="${esc(buttonUrl)}" style="display:inline-block;padding:14px 28px;font:700 15px Arial,Helvetica,sans-serif;color:#ffffff;text-decoration:none;border-radius:40px;">${esc(buttonLabel)} &rarr;</a>
</td></tr></table>
<p style="margin:0 0 26px;font:12px Arial,Helvetica,sans-serif;color:#67716c;word-break:break-all;">Or open: <a href="${esc(buttonUrl)}" style="color:${accent};">${esc(buttonUrl)}</a></p>`
    : "";
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(subject)}</title></head>
<body style="margin:0;padding:0;background:#f5f1e9;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(blocks[0]?.lines?.join(" ") || subject)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f1e9;padding:32px 12px;">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:18px;overflow:hidden;box-shadow:0 20px 50px -25px rgba(20,34,31,.35);">
<tr><td style="background:${dark};padding:26px 32px;">${logo}</td></tr>
<tr><td style="height:4px;background:${accent};font-size:0;line-height:0;">&nbsp;</td></tr>
<tr><td style="padding:34px 32px 8px;font:15px/1.65 Arial,Helvetica,sans-serif;color:#18201d;">
${eyebrow ? `<p style="margin:0 0 14px;font:12px Arial,Helvetica,sans-serif;letter-spacing:2px;text-transform:uppercase;color:${accent};">${esc(eyebrow)}</p>` : ""}
${blockHtml}
${detailsHtml}
${buttonHtml}
</td></tr>
<tr><td style="padding:18px 32px 30px;border-top:1px solid #eeefea;font:12px/1.6 Arial,Helvetica,sans-serif;color:#8a948e;">
&copy; ${esc(all.year)} ${esc(companyName)}
</td></tr>
</table>
</td></tr></table>
</body></html>`;
  return { subject, text, html };
}

// --- Sending ------------------------------------------------------------------
let logger = () => {};
const setLogger = (fn) => { logger = fn; };

// Sends one templated email. Never throws — returns { sent: true } or
// { sent: false, reason, detail } — so a mail problem can't break the action
// that triggered it (creating a user, saving an enquiry…).
//   opts: { tenantId, to, values, details, replyTo, test, template }
async function send(settings, kind, opts) {
  const { tenantId, to, values, details, replyTo, test = false, template } = opts;
  const log = (status, extra = {}) => Promise.resolve(logger({ tenantId, kind, to, status, test, ...extra })).catch(() => {});
  if (!to) {
    await log("skipped", { reason: "no-recipient" });
    return { sent: false, reason: "no-recipient" };
  }
  if (!test && !isEnabled(settings, kind)) {
    await log("skipped", { reason: "turned-off" });
    return { sent: false, reason: "turned-off" };
  }
  const email = render(settings, kind, { values, details, template });
  if (!isConfigured(settings)) {
    await log("skipped", { reason: "smtp-not-configured", subject: email.subject });
    return { sent: false, reason: "smtp-not-configured" };
  }
  try {
    await deliver(settings, { to, ...(replyTo ? { replyTo } : {}), ...email, subject: test ? `[Test] ${email.subject}` : email.subject });
    await log("sent", { subject: email.subject });
    return { sent: true };
  } catch (error) {
    console.error(`[mailer] Failed to send ${kind} email to ${to}:`, error.message);
    await log("failed", { subject: email.subject, reason: "send-failed", error: error.message });
    return { sent: false, reason: "send-failed", detail: error.message };
  }
}

// Sample values for previews and test sends.
function sampleValues(kind, base) {
  return {
    firstName: "Priya", name: "Priya Sharma", email: "priya@example.com", role: "Admin", invitedBy: base.userName || "An owner",
    expiresIn: "7 days", expiresMinutes: "60", changedAt: new Date().toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }),
    resetUrl: `${base.siteUrl}/admin/reset-password?token=sample`, manageUrl: `${base.siteUrl}/admin`,
    leadName: "Rahul Verma", leadEmail: "rahul@example.com", leadPhone: "+91 98765 43210", leadMessage: "We're planning a 12,000 sq ft office fit-out in Bengaluru and would like a quote.",
    cardName: "Anita Rao", ...base
  };
}
function sampleDetails(kind, values) {
  if (TEMPLATES[kind].credentials) return [["Email", values.email], ["Temporary password", "Sample7Pass9Xy"]];
  if (TEMPLATES[kind].details) return leadDetails({ name: values.leadName, email: values.leadEmail, phone: values.leadPhone, message: values.leadMessage, source: kind === "cardLeadNotification" ? "business-card" : "website" });
  return null;
}
const leadDetails = (lead) => [["Name", lead.name], ["Email", lead.email], ["Phone", lead.phone], ["Source", lead.source === "business-card" ? "Business card" : "Website"], ["Message", lead.message]];

module.exports = {
  send, render, deliver, verifySmtp, isConfigured, activeSource, smtpConfig, setLogger, templateFor, isEnabled,
  sampleValues, sampleDetails, leadDetails, TEMPLATES, TEMPLATE_KINDS, EDITABLE, COMMON_PLACEHOLDERS
};
