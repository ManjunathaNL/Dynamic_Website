// Builds a vCard 3.0 (.vcf) for a digital business card — the "Save contact"
// button. 3.0 rather than 4.0 because it's what iOS Contacts, Android and
// Outlook all import reliably; the photo is embedded as a small JPEG since
// several phones ignore WebP (our upload format) inside a vCard.
const sharp = require("sharp");

const escapeValue = (value) =>
  String(value ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/\r?\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");

// RFC 2425/6350 line folding: max 75 octets per line, continuation lines
// start with a single space. Counted in bytes so UTF-8 names fold correctly.
function fold(line) {
  if (Buffer.byteLength(line) <= 75) return line;
  const parts = [];
  let current = "";
  let size = 0;
  let limit = 75;
  for (const char of line) {
    const bytes = Buffer.byteLength(char);
    if (size + bytes > limit) {
      parts.push(current);
      current = "";
      size = 0;
      limit = 74;
    }
    current += char;
    size += bytes;
  }
  parts.push(current);
  return parts.join("\r\n ");
}

// `readUpload` returns an uploaded file's bytes (from MongoDB), or null.
async function embeddedPhoto(photoUrl, readUpload) {
  if (!photoUrl || !photoUrl.startsWith("/uploads/")) return null;
  try {
    const source = await readUpload(photoUrl);
    if (!source) return null;
    const buffer = await sharp(source).rotate().resize(400, 400, { fit: "cover" }).jpeg({ quality: 78 }).toBuffer();
    return buffer.toString("base64");
  } catch {
    return null;
  }
}

async function buildVCard({ card, company, cardUrl, readUpload }) {
  const nameParts = String(card.name || "").trim().split(/\s+/);
  const lastName = nameParts.length > 1 ? nameParts.pop() : "";
  const firstName = nameParts.join(" ");
  const website = card.website || company.website;
  const address = card.address || company.address;
  const lines = [
    "BEGIN:VCARD",
    "VERSION:3.0",
    `N:${escapeValue(lastName)};${escapeValue(firstName)};;;`,
    `FN:${escapeValue(card.name)}`,
    company.name && `ORG:${escapeValue(company.name)}`,
    card.designation && `TITLE:${escapeValue(card.designation)}`,
    card.phone && `TEL;TYPE=CELL,VOICE:${escapeValue(card.phone)}`,
    company.phone && company.phone !== card.phone && `TEL;TYPE=WORK,VOICE:${escapeValue(company.phone)}`,
    card.email && `EMAIL;TYPE=INTERNET,WORK:${escapeValue(card.email)}`,
    website && `URL;TYPE=WORK:${escapeValue(website)}`,
    cardUrl && `URL:${escapeValue(cardUrl)}`,
    address && `ADR;TYPE=WORK:;;${escapeValue(address)};;;;`,
    card.whatsapp && `X-SOCIALPROFILE;TYPE=whatsapp:https://wa.me/${String(card.whatsapp).replace(/\D/g, "")}`,
    card.linkedin && `X-SOCIALPROFILE;TYPE=linkedin:${escapeValue(card.linkedin)}`,
    card.instagram && `X-SOCIALPROFILE;TYPE=instagram:${escapeValue(card.instagram)}`,
    card.facebook && `X-SOCIALPROFILE;TYPE=facebook:${escapeValue(card.facebook)}`,
    card.bio && `NOTE:${escapeValue(card.bio)}`
  ].filter(Boolean);
  const photo = await embeddedPhoto(card.photoUrl, readUpload);
  if (photo) lines.push(`PHOTO;ENCODING=b;TYPE=JPEG:${photo}`);
  lines.push(`REV:${new Date().toISOString()}`, "END:VCARD");
  return lines.map(fold).join("\r\n") + "\r\n";
}

module.exports = { buildVCard };
