// Optional SMTP email notifications for new leads.
// If SMTP_HOST / SMTP_USER / SMTP_PASS are not set in .env, this module
// simply logs a note and skips sending — nothing breaks without SMTP configured.
const nodemailer = require("nodemailer");

let transporter = null;
let checked = false;

function getTransporter() {
  if (checked) return transporter;
  checked = true;
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS } = process.env;
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) {
    console.log("[mailer] SMTP not configured — lead email notifications are disabled. Set SMTP_HOST/SMTP_PORT/SMTP_USER/SMTP_PASS in backend/.env to enable them.");
    return null;
  }
  transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(SMTP_PORT) || 587,
    secure: Number(SMTP_PORT) === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 10000
  });
  return transporter;
}

async function sendLeadNotification({ tenant, settings, lead }) {
  const mailer = getTransporter();
  if (!mailer) return { sent: false, reason: "smtp-not-configured" };
  const to = settings?.contact?.email || process.env.LEAD_NOTIFY_TO;
  if (!to) return { sent: false, reason: "no-recipient" };
  try {
    await mailer.sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to,
      subject: `New enquiry — ${tenant.name}: ${lead.name}`,
      text: [
        `New website enquiry for ${tenant.name}`,
        "",
        `Name: ${lead.name}`,
        `Email: ${lead.email}`,
        `Phone: ${lead.phone || "—"}`,
        `Source: ${lead.source || "website"}`,
        "",
        "Message:",
        lead.message
      ].join("\n")
    });
    return { sent: true };
  } catch (error) {
    console.error("[mailer] Failed to send lead notification email", error.message);
    return { sent: false, reason: "send-failed" };
  }
}

module.exports = { sendLeadNotification };
