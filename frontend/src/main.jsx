import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  ArrowUp,
  ArrowDown,
  ArrowUpRight,
  Ban,
  Building2,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Clock,
  Copy,
  Crown,
  Download,
  Eye,
  EyeOff,
  ExternalLink,
  Facebook,
  FileText,
  FolderKanban,
  Globe,
  IdCard,
  KeyRound,
  Image,
  Instagram,
  LayoutDashboard,
  LayoutTemplate,
  Linkedin,
  LogOut,
  Mail,
  MailCheck,
  MapPin,
  Menu,
  Navigation,
  Pencil,
  Phone,
  Play,
  Plus,
  QrCode,
  RefreshCw,
  Save,
  Search,
  Send,
  Settings,
  ShieldCheck,
  Share2,
  Star,
  Trash2,
  UserCheck,
  UserCog,
  UserPlus,
  Users,
  UsersRound,
  X,
  Youtube,
} from "lucide-react";
import QRCode from "qrcode";
import "./styles.css";

const API = import.meta.env.VITE_API_URL || "/api";
// The oldest backend version this frontend works with (backend/package.json).
const REQUIRED_API_VERSION = "2.1.0";
const versionAtLeast = (version, required) => {
  const a = String(version || "0").split(".").map(Number);
  const b = required.split(".").map(Number);
  for (let i = 0; i < b.length; i += 1) {
    if ((a[i] || 0) !== b[i]) return (a[i] || 0) > b[i];
  }
  return true;
};
// The one tenant this site renders (see backend/store.js seed).
const TENANT = "gagnant-promoters";
// Admin sessions live in an httpOnly cookie the page can't read (so an XSS
// bug can't steal them). The page only reads the companion CSRF cookie and
// echoes it in a header, which proves the request came from this site.
const csrfToken = () =>
  decodeURIComponent(
    document.cookie.match(/(?:^|;\s*)gp_csrf=([^;]*)/)?.[1] || "",
  );
// Sessions used to be a token in localStorage — drop any leftover copy.
try {
  localStorage.removeItem("gp_token");
} catch {
  /* storage unavailable */
}
let sessionActive = false;
const api = async (path, options = {}) => {
  const headers = {
    ...(options.body instanceof FormData
      ? {}
      : { "Content-Type": "application/json" }),
    ...(csrfToken() ? { "X-CSRF-Token": csrfToken() } : {}),
    ...(options.headers || {}),
  };
  let response;
  try {
    response = await fetch(`${API}${path}`, {
      ...options,
      headers,
      credentials: "include",
    });
  } catch {
    const error = new Error(
      "Can't reach the server. Check your connection and try again.",
    );
    error.status = 0;
    throw error;
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    // An expired admin session: let AdminApp send the user back to login
    // instead of every panel failing with its own "Session expired" error.
    if (response.status === 401 && sessionActive && !path.startsWith("/auth/"))
      window.dispatchEvent(new Event("gp:session-expired"));
    if (data.code === "password_change_required")
      window.dispatchEvent(new Event("gp:password-change-required"));
    const error = new Error(data.error || "Something went wrong");
    error.status = response.status;
    error.code = data.code;
    throw error;
  }
  return data;
};
// For page loads: the API answers 503 while it's still connecting to the
// database (and the dev proxy does the same while the API is down), so retry
// those — and dropped connections — with backoff before showing an error.
async function apiWithRetry(path, { attempts = 6, onRetry } = {}) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await api(path);
    } catch (error) {
      const retryable =
        [0, 502, 504].includes(error.status) ||
        (error.status === 503 && error.code === "starting");
      if (!retryable || attempt >= attempts) throw error;
      onRetry?.(attempt);
      await new Promise((r) =>
        setTimeout(r, Math.min(8000, 1000 * 2 ** (attempt - 1))),
      );
    }
  }
}
async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Older browsers / non-HTTPS origins: fall back to a hidden textarea.
    const el = document.createElement("textarea");
    el.value = text;
    el.style.position = "fixed";
    el.style.opacity = "0";
    document.body.appendChild(el);
    el.select();
    const ok = document.execCommand("copy");
    el.remove();
    return ok;
  }
}
const dateLabel = (value) =>
  value
    ? new Date(value).toLocaleDateString("en-IN", {
        day: "numeric",
        month: "short",
        year: "numeric",
      })
    : "—";
const bytesLabel = (bytes = 0) =>
  bytes > 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;
async function compressImageFile(file) {
  if (
    !file.type.startsWith("image/") ||
    file.type === "image/svg+xml" ||
    file.size <= 200 * 1024
  )
    return file;
  const bitmap = await createImageBitmap(file);
  let scale = Math.min(1, 2400 / Math.max(bitmap.width, bitmap.height));
  let quality = 0.82;
  let blob;
  for (let attempt = 0; attempt < 7; attempt += 1) {
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    canvas
      .getContext("2d")
      .drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    blob = await new Promise((resolve) =>
      canvas.toBlob(resolve, "image/webp", quality),
    );
    if (blob.size <= 200 * 1024) break;
    if (quality > 0.48) quality -= 0.1;
    else scale *= 0.78;
  }
  bitmap.close();
  return new File([blob], `${file.name.replace(/\.[^.]+$/, "")}.webp`, {
    type: "image/webp",
    lastModified: Date.now(),
  });
}
function uploadOnce(file, alt, onProgress, trim) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${API}/media`);
    xhr.withCredentials = true;
    xhr.setRequestHeader("X-CSRF-Token", csrfToken());
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable)
        onProgress(Math.round((event.loaded / event.total) * 88));
    };
    xhr.onerror = () =>
      reject(
        new Error(
          "Could not reach the server. Check that the backend is running.",
        ),
      );
    xhr.onload = () => {
      let data = {};
      try {
        data = JSON.parse(xhr.responseText || "{}");
      } catch {
        /* non-JSON response (e.g. a proxy error page) — fall through with the status text below */
      }
      if (xhr.status >= 200 && xhr.status < 300) resolve(data);
      else
        reject(
          new Error(
            data.error ||
              `Upload failed (server responded with status ${xhr.status || "unknown"})`,
          ),
        );
    };
    const body = new FormData();
    body.append("file", file);
    body.append(
      "alt",
      alt || file.name.replace(/\.[^.]+$/, "").replace(/[-_]/g, " "),
    );
    if (trim) body.append("trim", "true");
    xhr.send(body);
  });
}
// A single dropped connection (e.g. the dev server restarting mid-request)
// shouldn't force the user to redo the whole compress-and-select flow — retry
// once, transparently, before surfacing an error.
async function uploadWithProgress(file, onProgress, alt, trim) {
  try {
    return await uploadOnce(file, alt, onProgress, trim);
  } catch (error) {
    if (!error.message.startsWith("Could not reach the server")) throw error;
    await new Promise((r) => setTimeout(r, 800));
    return uploadOnce(file, alt, onProgress, trim);
  }
}

function getYouTubeId(url) {
  if (!url) return null;
  const match = String(url).match(
    /(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/,
  );
  return match ? match[1] : null;
}

function VideoModal({ youtubeId, onClose }) {
  if (!youtubeId) return null;
  return (
    <div className="video-modal-backdrop" onClick={onClose}>
      <div className="video-modal" onClick={(e) => e.stopPropagation()}>
        <button
          type="button"
          className="video-modal-close"
          onClick={onClose}
          aria-label="Close video"
        >
          <X size={20} />
        </button>
        <iframe
          src={`https://www.youtube.com/embed/${youtubeId}?autoplay=1`}
          title="Project video"
          allow="autoplay; encrypted-media; picture-in-picture"
          allowFullScreen
        />
      </div>
    </div>
  );
}

function WhatsappIcon({ size = 20 }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.87.5 3.62 1.44 5.15L2 22l5.09-1.53a9.87 9.87 0 0 0 4.95 1.34h.01c5.46 0 9.91-4.45 9.91-9.91S17.5 2 12.04 2Zm0 18.06h-.01c-1.6 0-3.15-.43-4.5-1.24l-.32-.19-3.02.9.9-2.94-.21-.31a8.14 8.14 0 0 1-1.25-4.37c0-4.5 3.66-8.16 8.17-8.16 2.18 0 4.23.85 5.77 2.4a8.1 8.1 0 0 1 2.39 5.77c0 4.5-3.67 8.14-8.17 8.14Zm4.47-6.11c-.24-.12-1.44-.71-1.66-.79-.22-.08-.39-.12-.55.12-.16.24-.63.79-.78.95-.14.16-.29.18-.53.06-.24-.12-1.02-.38-1.94-1.2-.72-.64-1.2-1.43-1.34-1.67-.14-.24-.02-.37.11-.49.11-.11.24-.29.36-.43.12-.14.16-.24.24-.4.08-.16.04-.3-.02-.42-.06-.12-.55-1.32-.75-1.81-.2-.48-.4-.41-.55-.42h-.47c-.16 0-.42.06-.64.3-.22.24-.84.82-.84 2s.86 2.32.98 2.48c.12.16 1.7 2.6 4.13 3.64.58.25 1.03.4 1.38.51.58.18 1.11.16 1.53.1.47-.07 1.44-.59 1.64-1.16.2-.57.2-1.06.14-1.16-.06-.1-.22-.16-.46-.28Z" />
    </svg>
  );
}

function WhatsAppFloatButton({ whatsapp }) {
  if (!whatsapp) return null;
  return (
    <a
      className="whatsapp-float"
      href={`https://wa.me/${whatsapp}`}
      target="_blank"
      rel="noreferrer"
      aria-label="Chat on WhatsApp"
    >
      <WhatsappIcon size={28} />
    </a>
  );
}

// --- Content helpers -----------------------------------------------------------
// Everything the public site says comes from the database (admin → Website
// content and Brand & settings). A block whose content is empty simply isn't
// rendered — there is no built-in fallback copy in the code.
const has = (v) =>
  Array.isArray(v)
    ? v.length > 0
    : v !== undefined && v !== null && String(v).trim() !== "";
// Client-side twin of the server's URL check (backend/security.js): stored
// data only ever becomes an http(s), site-relative, mailto: or tel: link —
// never javascript: or data:.
const SAFE_URL =
  /^(https?:\/\/[^\s<>"']+|\/(?!\/)[^\s<>"']*|mailto:[^\s<>"']+|tel:[+\d\s()-]+|#[\w-]*)$/i;
const safeUrl = (value) => {
  const s = String(value ?? "").trim();
  return s && SAFE_URL.test(s) ? s : undefined;
};
const cssUrl = (value) => {
  const s = safeUrl(value);
  return s ? `url("${s.replace(/["\\\n]/g, encodeURIComponent)}")` : undefined;
};
const bgStyle = (value) =>
  cssUrl(value) ? { backgroundImage: cssUrl(value) } : undefined;
const waLink = (number, text) =>
  `https://wa.me/${String(number || "").replace(/\D/g, "")}${text ? `?text=${encodeURIComponent(text)}` : ""}`;

// Headings support two bits of markup typed in the admin: *words* render in
// the italic display face, and a new line becomes a line break.
function RichText({ text }) {
  if (!has(text)) return null;
  const lines = String(text).split("\n");
  return lines.map((line, i) => (
    <React.Fragment key={i}>
      {line
        .split(/(\*[^*]+\*)/)
        .map((part, j) =>
          /^\*[^*]+\*$/.test(part) ? <em key={j}>{part.slice(1, -1)}</em> : part,
        )}
      {i < lines.length - 1 && <br />}
    </React.Fragment>
  ));
}

// The uploaded logo, or — until one is uploaded — a monogram + the company
// name from settings.
function Wordmark({ name, logoUrl, imgClassName = "" }) {
  if (safeUrl(logoUrl))
    return (
      <img
        className={`logo-image ${imgClassName}`}
        src={safeUrl(logoUrl)}
        alt={name || ""}
      />
    );
  const [first, ...rest] = String(name || "").trim().split(/\s+/);
  if (!first) return null;
  return (
    <>
      <span className="mark">{first[0].toUpperCase()}</span>
      <span>
        {first.toUpperCase()}
        {rest.length > 0 && <small>{rest.join(" ").toUpperCase()}</small>}
      </span>
    </>
  );
}

const siteVars = (b = {}) => ({
  "--primary": b.primary,
  "--secondary": b.secondary,
  "--accent": b.accent,
  "--surface": b.surface,
  "--ink": b.text,
  "--muted": b.muted,
  "--radius": b.radius,
});
// The six pages are fixed; their menu labels come from Website content
// (a page with no label is left out of the menu).
const NAV_PAGES = [
  ["home", "/"],
  ["about", "/about"],
  ["services", "/services"],
  ["projects", "/projects"],
  ["blog", "/blog"],
  ["contact", "/contact"],
];
const navLinks = (settings) =>
  NAV_PAGES.map(([key, href]) => [settings.content?.nav?.[key], href]).filter(
    ([label]) => has(label),
  );

function useScrolled(threshold = 12) {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > threshold);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [threshold]);
  return scrolled;
}
function ScrollProgress() {
  const ref = useRef(null);
  useEffect(() => {
    let frame = null;
    const update = () => {
      frame = null;
      const el = document.documentElement;
      const max = el.scrollHeight - el.clientHeight;
      if (ref.current)
        ref.current.style.transform = `scaleX(${max > 0 ? el.scrollTop / max : 0})`;
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      cancelAnimationFrame(frame);
    };
  }, []);
  return <div className="scroll-progress" ref={ref} aria-hidden="true" />;
}
function BackToTop() {
  const shown = useScrolled(700);
  return (
    <button
      type="button"
      className={`back-to-top ${shown ? "show" : ""}`}
      onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
      aria-label="Back to top"
      tabIndex={shown ? 0 : -1}
    >
      <ArrowUp size={18} />
    </button>
  );
}

function SiteHeader({ settings }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const scrolled = useScrolled();
  const path = location.pathname.replace(/(.)\/$/, "$1");
  const links = navLinks(settings);
  const cta = settings.content?.nav?.cta;
  useEffect(() => {
    document.body.classList.toggle("menu-open", menuOpen);
    return () => document.body.classList.remove("menu-open");
  }, [menuOpen]);
  useEffect(() => {
    const onResize = () => window.innerWidth > 1024 && setMenuOpen(false);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return (
    <header className={`site-header ${scrolled ? "scrolled" : ""}`}>
      <a
        className="wordmark"
        href="/"
        aria-label={settings.companyName || "Home"}
      >
        <Wordmark
          name={settings.companyName}
          logoUrl={settings.brand?.logoUrl}
        />
      </a>
      {links.length > 0 && (
        <nav className={menuOpen ? "open" : ""}>
          {links.map(([label, href], i) => (
            <a
              key={href}
              href={href}
              style={{ "--i": i }}
              className={
                path === href || (href !== "/" && path.startsWith(`${href}/`))
                  ? "active"
                  : ""
              }
              onClick={() => setMenuOpen(false)}
            >
              {label}
            </a>
          ))}
        </nav>
      )}
      {has(cta) && (
        <a className="header-cta" href="/contact">
          {cta} <ArrowUpRight size={16} />
        </a>
      )}
      {links.length > 0 && (
        <button
          className={`mobile-menu ${menuOpen ? "is-open" : ""}`}
          onClick={() => setMenuOpen((v) => !v)}
          aria-label={menuOpen ? "Close menu" : "Open menu"}
          aria-expanded={menuOpen}
        >
          {menuOpen ? <X size={20} /> : <Menu size={20} />}
        </button>
      )}
    </header>
  );
}

function PageHero({ hero = {}, image }) {
  const bg = bgStyle(image);
  if (!has(hero.eyebrow) && !has(hero.title) && !has(hero.lede) && !bg)
    return null;
  return (
    <section
      className={`page-hero ${bg ? "has-content-image" : ""}`}
      style={bg}
    >
      {has(hero.eyebrow) && <p className="eyebrow">{hero.eyebrow}</p>}
      {has(hero.title) && (
        <h1>
          <RichText text={hero.title} />
        </h1>
      )}
      {has(hero.lede) && <p className="hero-lede">{hero.lede}</p>}
    </section>
  );
}

function SiteFooter({ settings }) {
  const social = settings.social || {};
  const contact = settings.contact || {};
  const links = navLinks(settings).filter(([, href]) => href !== "/");
  const socials = [
    ["WhatsApp", contact.whatsapp && waLink(contact.whatsapp), WhatsappIcon],
    ["Instagram", social.instagram, Instagram],
    ["LinkedIn", social.linkedin, Linkedin],
    ["Facebook", social.facebook, Facebook],
    ["YouTube", social.youtube, Youtube],
  ].filter(([, href]) => safeUrl(href));
  return (
    <footer>
      <div className="footer-top">
        <a className="wordmark light-wordmark" href="/">
          <Wordmark
            name={settings.companyName}
            logoUrl={settings.brand?.logoUrl}
            imgClassName="footer-logo"
          />
        </a>
        {has(settings.tagline) ? <p>{settings.tagline}</p> : <span />}
        <div className="footer-links">
          {links.map(([label, href]) => (
            <a key={href} href={href}>
              {label}
            </a>
          ))}
          <a href="/admin">Login</a>
        </div>
      </div>
      <div className="footer-bottom">
        <span>
          © {new Date().getFullYear()} {settings.companyName}
        </span>
        {has(contact.address) && <span>{contact.address}</span>}
        <span className="footer-bottom-right">
          {socials.length > 0 && (
            <span className="footer-social">
              {socials.map(([label, href, Icon]) => (
                <a
                  key={label}
                  href={safeUrl(href)}
                  target="_blank"
                  rel="noreferrer"
                  aria-label={label}
                >
                  <Icon size={15} />
                </a>
              ))}
            </span>
          )}
          {[contact.email, contact.secondaryEmail].filter(has).map((email) => (
            <a key={email} href={`mailto:${email}`}>
              {email}
            </a>
          ))}
        </span>
      </div>
      <div className="footer-credit">
        <span>Website provided by</span>
        <a
          href="https://shellsorttechnologies.com/"
          target="_blank"
          rel="noreferrer"
          aria-label="ShellSort Technologies"
        >
          <img src="/newLogo.png" alt="ShellSort Technologies" />
        </a>
      </div>
    </footer>
  );
}

function TestimonialCarousel({ items }) {
  const [index, setIndex] = useState(0);
  useEffect(() => {
    if (items.length < 2) return undefined;
    const timer = setInterval(
      () => setIndex((i) => (i + 1) % items.length),
      6000,
    );
    return () => clearInterval(timer);
  }, [items.length]);
  const current = items[index % items.length];
  if (!current) return null;
  return (
    <>
      <div className="quote-mark">“</div>
      <div className="quote-slide" key={current.id}>
        {safeUrl(current.photoUrl) && (
          <img
            className="quote-avatar"
            src={safeUrl(current.photoUrl)}
            alt={current.name}
          />
        )}
        <blockquote>{current.quote}</blockquote>
        <p>{[current.name, current.role].filter(has).join(" · ")}</p>
      </div>
      {items.length > 1 && (
        <div className="quote-dots">
          {items.map((t, i) => (
            <button
              type="button"
              key={t.id}
              className={i === index ? "active" : ""}
              onClick={() => setIndex(i)}
              aria-label={`Show testimonial from ${t.name}`}
            />
          ))}
        </div>
      )}
    </>
  );
}

// The homepage banner's slides: brand.heroSlides (images and/or videos, set
// in Brand & settings), or — for sites saved before slides existed — the
// old single video, single image or image carousel.
function heroSlidesOf(brand = {}) {
  const valid = (list) =>
    list.filter((x) => safeUrl(x?.url) && ["image", "video"].includes(x.type));
  if (brand.heroSlides?.length) return valid(brand.heroSlides);
  if (safeUrl(brand.heroVideo))
    return [{ type: "video", url: brand.heroVideo, poster: brand.heroUrl }];
  const images = brand.heroUrl ? [brand.heroUrl] : brand.heroImages || [];
  return valid(images.map((url) => ({ type: "image", url })));
}

const IMAGE_SLIDE_MS = 6000;
// Crossfading banner slider. An image stays up for 6 seconds; a video plays
// to its end and then moves on (a lone video just loops). Arrows, dots and
// swipe; it holds still while the tab is hidden or the pointer is on the
// controls, and doesn't auto-advance for reduced-motion users.
function HeroSlider({ slides }) {
  const [index, setIndex] = useState(0);
  const [hidden, setHidden] = useState(false);
  const [holding, setHolding] = useState(false);
  const videos = useRef([]);
  const touchX = useRef(null);
  const count = slides.length;
  const multi = count > 1;
  const reduced = Boolean(
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches,
  );
  const paused = hidden || holding || reduced;
  const current = slides[index] || slides[0];
  const go = (i) => setIndex(((i % count) + count) % count);
  useEffect(() => {
    if (index >= count) setIndex(0);
  }, [count, index]);
  useEffect(() => {
    if (!multi || paused || current?.type === "video") return undefined;
    const timer = setTimeout(() => go(index + 1), IMAGE_SLIDE_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, paused, multi, current?.type]);
  // Only the visible video plays (from its start); the rest stay paused so
  // they don't compete for bandwidth.
  useEffect(() => {
    videos.current.forEach((video, i) => {
      if (!video) return;
      if (i === index) {
        try {
          video.currentTime = 0;
        } catch {
          /* not loaded yet */
        }
        video.play().catch(() => {});
      } else video.pause();
    });
  }, [index, count]);
  useEffect(() => {
    const onVisibility = () => setHidden(document.hidden);
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);
  return (
    <>
      <div
        className="hero-slides"
        onTouchStart={(e) => (touchX.current = e.touches[0].clientX)}
        onTouchEnd={(e) => {
          if (touchX.current == null || !multi) return;
          const dx = e.changedTouches[0].clientX - touchX.current;
          if (Math.abs(dx) > 45) go(index + (dx < 0 ? 1 : -1));
          touchX.current = null;
        }}
      >
        {slides.map((slide, i) => (
          <div
            key={`${slide.url}-${i}`}
            className={`hero-slide ${i === index ? "active" : ""}`}
            aria-hidden={i !== index}
          >
            {slide.type === "video" ? (
              <video
                ref={(el) => (videos.current[i] = el)}
                className="hero-media"
                src={safeUrl(slide.url)}
                poster={safeUrl(slide.poster)}
                muted
                playsInline
                autoPlay={i === index}
                loop={!multi}
                preload={i === index ? "auto" : "metadata"}
                onEnded={() => multi && i === index && go(i + 1)}
                onError={() => multi && i === index && go(i + 1)}
              />
            ) : (
              <div
                className={`hero-media ${i === index ? "kenburns" : ""}`}
                style={bgStyle(slide.url)}
              />
            )}
          </div>
        ))}
      </div>
      {multi && (
        <div
          className="hero-controls"
          onPointerEnter={(e) => e.pointerType === "mouse" && setHolding(true)}
          onPointerLeave={() => setHolding(false)}
        >
          <button type="button" onClick={() => go(index - 1)} aria-label="Previous slide">
            <ChevronLeft size={18} />
          </button>
          <div className={`hero-dots ${paused ? "paused" : ""}`}>
            {slides.map((slide, i) => (
              <button
                type="button"
                key={i}
                className={i === index ? "active" : ""}
                onClick={() => go(i)}
                aria-label={`Show slide ${i + 1} of ${count}`}
                aria-current={i === index}
              >
                <i
                  key={i === index ? `on-${index}` : "off"}
                  className={i === index && slide.type === "image" && !reduced ? "timed" : ""}
                  style={{ "--dur": `${IMAGE_SLIDE_MS}ms` }}
                />
              </button>
            ))}
          </div>
          <button type="button" onClick={() => go(index + 1)} aria-label="Next slide">
            <ChevronRight size={18} />
          </button>
        </div>
      )}
    </>
  );
}

function LoadingState({ label, slow }) {
  return (
    <div className="loading-screen">
      <div className="loader" />
      {slow ? "Connecting to the server…" : label}
    </div>
  );
}
function ErrorState({ message, onRetry, children }) {
  return (
    <div className="center-state">
      <CircleAlert />
      <h2>{message}</h2>
      {children}
      {onRetry && (
        <button type="button" className="button dark" onClick={onRetry}>
          <RefreshCw size={15} /> Try again
        </button>
      )}
    </div>
  );
}

// Rating stars with partial fill (4.6 → four and a bit), drawn as an empty
// row with a clipped filled row on top.
function Stars({ value = 0, size = 14 }) {
  const pct = Math.max(0, Math.min(100, (Number(value) / 5) * 100));
  const row = (filled) =>
    [0, 1, 2, 3, 4].map((i) => (
      <Star
        key={i}
        size={size}
        strokeWidth={1.5}
        fill={filled ? "currentColor" : "none"}
      />
    ));
  return (
    <span
      className="stars"
      role="img"
      aria-label={`${Number(value).toFixed(1)} out of 5 stars`}
    >
      <span className="stars-base">{row(false)}</span>
      <span className="stars-fill" style={{ width: `${pct}%` }}>
        {row(true)}
      </span>
    </span>
  );
}

function GoogleMark({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true">
      <path
        fill="#FFC107"
        d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 13 4 4 13 4 24s9 20 20 20 20-9 20-20c0-1.3-.1-2.4-.4-3.5z"
      />
      <path
        fill="#FF3D00"
        d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"
      />
      <path
        fill="#4CAF50"
        d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z"
      />
      <path
        fill="#1976D2"
        d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"
      />
    </svg>
  );
}

// Live Google reviews. The server caches Google's answer (admin-configurable,
// 30 min by default), so it's cheap to re-ask: refresh every few minutes
// while the tab is visible, and as soon as the visitor comes back to it.
function useGoogleReviews(settings) {
  const enabled = Boolean(settings?.googleReviews?.enabled);
  const [data, setData] = useState(null);
  useEffect(() => {
    if (!enabled) return undefined;
    let cancelled = false;
    const load = () =>
      api(`/public/${TENANT}/google-reviews`)
        .then((d) => !cancelled && setData(d))
        .catch(() => {});
    const onVisible = () => document.visibilityState === "visible" && load();
    load();
    const timer = setInterval(onVisible, 5 * 60 * 1000);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [enabled]);
  return enabled ? data : null;
}

function ReviewCard({ review }) {
  const [expanded, setExpanded] = useState(false);
  const long = review.text.length > 260;
  const authorUrl = safeUrl(review.authorUrl);
  const Author = authorUrl ? "a" : "span";
  return (
    <article className="g-review">
      <header>
        {safeUrl(review.authorPhoto) ? (
          <img
            src={safeUrl(review.authorPhoto)}
            alt=""
            referrerPolicy="no-referrer"
            loading="lazy"
          />
        ) : (
          <span className="g-review-initial">
            {review.author.slice(0, 1)}
          </span>
        )}
        <div>
          <Author
            className="g-review-author"
            {...(authorUrl
              ? { href: authorUrl, target: "_blank", rel: "noreferrer" }
              : {})}
          >
            {review.author}
          </Author>
          <small>{review.relativeTime}</small>
        </div>
        <GoogleMark size={16} />
      </header>
      <Stars value={review.rating} size={13} />
      <p className={expanded || !long ? "" : "clamped"}>{review.text}</p>
      {long && (
        <button
          type="button"
          className="g-review-more"
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? "Show less" : "Read more"}
        </button>
      )}
    </article>
  );
}

function SectionHeading({ heading, href, children }) {
  heading = heading || {};
  if (!has(heading.eyebrow) && !has(heading.title) && !children) return null;
  return (
    <div className="section-heading">
      <div>
        {has(heading.eyebrow) && <p className="eyebrow">{heading.eyebrow}</p>}
        {has(heading.title) && (
          <h2>
            <RichText text={heading.title} />
          </h2>
        )}
      </div>
      {children}
      {href && has(heading.linkLabel) && (
        <a className="text-link" href={href}>
          {heading.linkLabel} <span>→</span>
        </a>
      )}
    </div>
  );
}

function GoogleReviewsSection({ data, heading = {} }) {
  if (!data?.enabled || (!data.live && !data.writeReviewUrl)) return null;
  const hasRating = data.live && data.rating;
  const writeUrl = safeUrl(data.writeReviewUrl);
  const mapsUrl = safeUrl(data.mapsUrl);
  return (
    <section className="section google-reviews">
      <SectionHeading heading={{ ...heading, linkLabel: "" }}>
        {hasRating && (
          <div className="g-summary">
            <strong>{Number(data.rating).toFixed(1)}</strong>
            <div>
              <Stars value={data.rating} size={16} />
              <span className="g-summary-count">
                <GoogleMark size={13} />
                {data.userRatingCount} reviews on Google
              </span>
            </div>
          </div>
        )}
      </SectionHeading>
      {data.reviews?.length > 0 && (
        <div className="g-review-track">
          {data.reviews.map((r) => (
            <ReviewCard key={r.id} review={r} />
          ))}
        </div>
      )}
      <div className="g-actions">
        {writeUrl && (
          <a
            className="button primary"
            href={writeUrl}
            target="_blank"
            rel="noreferrer"
          >
            <Star size={15} /> Write a review
          </a>
        )}
        {mapsUrl && (
          <a
            className="text-link"
            href={mapsUrl}
            target="_blank"
            rel="noreferrer"
          >
            {has(heading.linkLabel) ? heading.linkLabel : "Google Maps"}{" "}
            <span>→</span>
          </a>
        )}
      </div>
    </section>
  );
}

// QR codes are generated in the browser (no third-party QR service sees the
// card links). `dark` follows the brand; error correction "M" stays scannable
// even when printed small.
function useQrDataUrl(value, { size = 320, dark = "#14221f" } = {}) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    if (!value) return;
    QRCode.toDataURL(value, {
      width: size,
      margin: 1,
      errorCorrectionLevel: "M",
      color: { dark, light: "#ffffff" },
    })
      .then(setUrl)
      .catch(() => setUrl(""));
  }, [value, size, dark]);
  return url;
}
function QrImage({ value, size, dark, className = "qr-image" }) {
  const url = useQrDataUrl(value, { size, dark });
  return url ? (
    <img className={className} src={url} alt={`QR code for ${value}`} />
  ) : (
    <div className={`${className} qr-placeholder`} />
  );
}

function AnnouncementBar({ text }) {
  if (!has(text)) return null;
  return (
    <div className="announcement">
      <p>{text}</p>
    </div>
  );
}

// Children of these containers fade in one after another (see the
// .reveal-on-scroll rules in styles.css).
const STAGGER_SELECTOR =
  ".service-grid > *, .blog-grid > *, .client-grid > *, .g-review-track > *, .stats > *, .process-steps > *, .vmv-grid > *, .category-row-track > *, .trust-row > *";

function SiteShell({ settings, children }) {
  const mainRef = useRef(null);
  useEffect(() => {
    const sections = mainRef.current
      ? Array.from(mainRef.current.querySelectorAll(":scope > section"))
      : [];
    if (!sections.length || typeof IntersectionObserver === "undefined")
      return undefined;
    sections.forEach((el) => {
      el.classList.add("reveal-on-scroll");
      el.querySelectorAll(STAGGER_SELECTOR).forEach((child, i) =>
        child.style.setProperty("--i", String(i % 8)),
      );
    });
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("in-view");
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.12, rootMargin: "0px 0px -60px 0px" },
    );
    sections.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [children]);
  return (
    <div className="site" style={siteVars(settings.brand)}>
      <ScrollProgress />
      <AnnouncementBar text={settings.announcement} />
      <SiteHeader settings={settings} />
      <main ref={mainRef}>{children}</main>
      <SiteFooter settings={settings} />
      <WhatsAppFloatButton whatsapp={settings.contact?.whatsapp} />
      <BackToTop />
    </div>
  );
}

// Animates the number inside a stat ("100%", "01", "250+") counting up the
// first time it scrolls into view; non-numeric values ("Pan-India") and
// reduced-motion users just see the final text.
function CountUp({ value }) {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    const match = String(value ?? "").match(/^(\D*)(\d+)(.*)$/);
    if (
      !el ||
      !match ||
      typeof IntersectionObserver === "undefined" ||
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
    )
      return undefined;
    const [, prefix, digits, suffix] = match;
    const target = Number(digits);
    let frame;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        observer.disconnect();
        const start = performance.now();
        const tick = (now) => {
          const p = Math.min(1, (now - start) / 1400);
          const eased = 1 - (1 - p) ** 3;
          el.textContent = `${prefix}${String(Math.round(target * eased)).padStart(digits.length, "0")}${suffix}`;
          if (p < 1) frame = requestAnimationFrame(tick);
        };
        frame = requestAnimationFrame(tick);
      },
      { threshold: 0.6 },
    );
    observer.observe(el);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [value]);
  return <strong ref={ref}>{value}</strong>;
}

function StatsBand({ stats = [] }) {
  const items = stats.filter((s) => has(s.value) || has(s.label));
  if (!items.length) return null;
  return (
    <section
      className="stats"
      style={{ "--cols": Math.min(items.length, 4) }}
    >
      {items.map((s, i) => (
        <div key={i}>
          <CountUp value={s.value} />
          <span>
            <RichText text={s.label} />
          </span>
        </div>
      ))}
    </section>
  );
}

function ProcessSection({ process = {} }) {
  const steps = (process.steps || []).filter((s) => has(s.title));
  if (!has(process.title) && !has(process.text) && !steps.length) return null;
  return (
    <section className="process">
      <div className="process-intro">
        {has(process.eyebrow) && <p className="eyebrow">{process.eyebrow}</p>}
        {has(process.title) && (
          <h2>
            <RichText text={process.title} />
          </h2>
        )}
        {has(process.text) && <p>{process.text}</p>}
      </div>
      {steps.length > 0 && (
        <div className="process-steps">
          {steps.map((step, i) => (
            <div className="step" key={i}>
              <span>{String(i + 1).padStart(2, "0")}</span>
              <b>{step.title}</b>
              {has(step.text) && <i>{step.text}</i>}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function ServicesGrid({ services }) {
  return (
    <div className="service-grid">
      {services.map((s, i) => (
        <a className="service-card" href={`/services/${s.slug}`} key={s.id}>
          <span className="service-number">
            {String(i + 1).padStart(2, "0")}
          </span>
          <div className="service-thumb" style={bgStyle(s.imageUrl)} />
          <div>
            <h3>{s.title}</h3>
            {has(s.description) && <p>{s.description}</p>}
          </div>
          <ArrowUpRight className="card-arrow" size={20} />
        </a>
      ))}
    </div>
  );
}

function ProjectCard({ p, i = 0, onPlay }) {
  const ytId = getYouTubeId(p.videoUrl);
  const bg =
    safeUrl(p.imageUrl) ||
    (ytId ? `https://img.youtube.com/vi/${ytId}/hqdefault.jpg` : "");
  return (
    <div className={`project-card p${i % 3}`}>
      <div
        className={`project-image ${bg ? "has-content-image" : ""}`}
        style={bgStyle(bg)}
      >
        <a
          className="project-image-link"
          href={`/projects/${p.slug}`}
          aria-label={p.title}
        />{" "}
        {!bg && <span className="project-initial">{p.title.slice(0, 1)}</span>}
        {has(p.category) && <span className="project-tag">{p.category}</span>}
        {ytId && (
          <button
            type="button"
            className="project-play"
            onClick={() => onPlay(ytId)}
            aria-label={`Play video for ${p.title}`}
          >
            <Play size={22} fill="currentColor" />
          </button>
        )}
      </div>
      <a className="project-info" href={`/projects/${p.slug}`}>
        <div>
          <h3>{p.title}</h3>
          {(has(p.location) || has(p.year)) && (
            <p>{[p.location, p.year].filter(has).join(" · ")}</p>
          )}
        </div>
        <ArrowUpRight size={18} />
      </a>
    </div>
  );
}

// One category's projects as a horizontal row: < > arrows (wrapping round
// at either end), swipe/drag with snap points, and a gentle auto-scroll that
// pauses while someone is interacting with the row. Arrows only appear when
// the row actually overflows.
function CategoryProjectRow({ category, items, onPlay }) {
  const trackRef = useRef(null);
  const holdUntil = useRef(0);
  const [overflowing, setOverflowing] = useState(false);
  const hold = (ms) => (holdUntil.current = Date.now() + ms);
  const scrollByCards = (dir) => {
    const el = trackRef.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    const card = el.querySelector(".project-card");
    const amount = card ? card.offsetWidth + 18 : el.clientWidth * 0.8;
    if (dir > 0 && el.scrollLeft >= max - 4)
      el.scrollTo({ left: 0, behavior: "smooth" });
    else if (dir < 0 && el.scrollLeft <= 4)
      el.scrollTo({ left: max, behavior: "smooth" });
    else el.scrollBy({ left: dir * amount, behavior: "smooth" });
  };
  useEffect(() => {
    const el = trackRef.current;
    if (!el) return undefined;
    const measure = () => setOverflowing(el.scrollWidth > el.clientWidth + 4);
    measure();
    const observer =
      typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    observer?.observe(el);
    window.addEventListener("resize", measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [items.length]);
  useEffect(() => {
    if (
      items.length < 2 ||
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
    )
      return undefined;
    const timer = setInterval(() => {
      const el = trackRef.current;
      if (!el || document.hidden || Date.now() < holdUntil.current) return;
      if (el.scrollWidth <= el.clientWidth + 4) return;
      scrollByCards(1);
    }, 4500);
    return () => clearInterval(timer);
  }, [items.length]);
  return (
    <div className="category-row">
      <div className="category-row-head">
        {has(category) ? <h3>{category}</h3> : <span />}
        {overflowing && (
          <div className="category-row-nav">
            <button
              type="button"
              onClick={() => {
                hold(9000);
                scrollByCards(-1);
              }}
              aria-label={`Previous ${category} projects`}
            >
              <ChevronLeft size={17} />
            </button>
            <button
              type="button"
              onClick={() => {
                hold(9000);
                scrollByCards(1);
              }}
              aria-label={`Next ${category} projects`}
            >
              <ChevronRight size={17} />
            </button>
          </div>
        )}
      </div>
      <div
        className="category-row-track"
        ref={trackRef}
        // Mouse resting on the row pauses it; a touch pauses it for a few
        // seconds (touch screens never fire a "mouse left" to resume on).
        onPointerEnter={(e) => e.pointerType === "mouse" && hold(60 * 60 * 1000)}
        onPointerLeave={(e) => e.pointerType === "mouse" && hold(1500)}
        onPointerDown={() => hold(9000)}
        onWheel={() => hold(9000)}
      >
        {items.map((p, i) => (
          <ProjectCard key={p.id} p={p} i={i} onPlay={onPlay} />
        ))}
      </div>
    </div>
  );
}

// Projects grouped by category — one row per category, in the order each
// category first appears among the projects.
function ProjectsByCategory({ projects, onPlay }) {
  const groups = [];
  projects.forEach((p) => {
    const cat = p.category || "";
    let group = groups.find((g) => g.category === cat);
    if (!group) {
      group = { category: cat, items: [] };
      groups.push(group);
    }
    group.items.push(p);
  });
  return (
    <div className="category-rows">
      {groups.map((g) => (
        <CategoryProjectRow
          key={g.category || "uncategorised"}
          category={g.category}
          items={g.items}
          onPlay={onPlay}
        />
      ))}
    </div>
  );
}

function ClientsGrid({ clients, heading }) {
  if (!clients.length) return null;
  return (
    <section className="section clients-section">
      <SectionHeading heading={heading} />
      <div className="client-grid">
        {clients.map((c) => {
          const logo = safeUrl(c.logoUrl);
          const site = safeUrl(c.websiteUrl);
          const Tag = site ? "a" : "div";
          return (
            <Tag
              className="client-logo"
              key={c.id}
              title={c.name}
              {...(site ? { href: site, target: "_blank", rel: "noreferrer" } : {})}
            >
              {logo ? <img src={logo} alt={c.name} /> : <span>{c.name}</span>}
            </Tag>
          );
        })}
      </div>
    </section>
  );
}

function BlogGrid({ blogs }) {
  return (
    <div className="blog-grid">
      {blogs.map((post) => (
        <article key={post.id}>
          {cssUrl(post.coverUrl) && (
            <div className="blog-image" style={bgStyle(post.coverUrl)} />
          )}
          <span>
            {[post.category, post.publishedAt && dateLabel(post.publishedAt)]
              .filter(has)
              .join(" · ")}
          </span>
          <h3>{post.title}</h3>
          {has(post.excerpt) && <p>{post.excerpt}</p>}
          <a className="text-link" href={`/blog/${post.slug}`}>
            Read more <span>→</span>
          </a>
        </article>
      ))}
    </div>
  );
}

// Invisible to people, irresistible to bots — any submission that fills it
// is silently dropped by the API.
function Honeypot({ form, setForm }) {
  return (
    <label className="hp-field" aria-hidden="true">
      Website
      <input
        tabIndex={-1}
        autoComplete="off"
        value={form.website || ""}
        onChange={(e) => setForm({ ...form, website: e.target.value })}
      />
    </label>
  );
}

function ContactSection({
  settings,
  form,
  setForm,
  sent,
  setSent,
  error,
  busy,
  onSubmit,
}) {
  const copy = settings.content?.contact || {};
  const contact = settings.contact || {};
  return (
    <section className="contact-section" id="contact">
      <div className="contact-copy">
        {has(copy.eyebrow) && <p className="eyebrow">{copy.eyebrow}</p>}
        {has(copy.title) && (
          <h2>
            <RichText text={copy.title} />
          </h2>
        )}
        {has(copy.text) && <p>{copy.text}</p>}
        <div className="contact-details">
          {[contact.email, contact.secondaryEmail].filter(has).map((email) => (
            <a key={email} href={`mailto:${email}`}>
              <Mail size={16} />
              {email}
            </a>
          ))}
          {has(contact.phone) && (
            <a href={`tel:${contact.phone}`}>
              <Phone size={16} />
              {contact.phone}
            </a>
          )}
          {has(contact.whatsapp) && (
            <a href={waLink(contact.whatsapp)} target="_blank" rel="noreferrer">
              <WhatsappIcon size={16} />
              WhatsApp
            </a>
          )}
          {has(contact.address) && (
            <span>
              <MapPin size={16} />
              {contact.address}
            </span>
          )}
          {has(contact.hours) && (
            <span>
              <Clock size={16} />
              {contact.hours}
            </span>
          )}
        </div>
      </div>
      <form onSubmit={onSubmit} className="lead-form">
        {sent ? (
          <div className="success">
            <Check size={30} />
            {has(copy.successTitle) && <h3>{copy.successTitle}</h3>}
            {has(copy.successText) && <p>{copy.successText}</p>}
            <button
              className="button outline"
              type="button"
              onClick={() => setSent(false)}
            >
              Send another
            </button>
          </div>
        ) : (
          <>
            <label>
              Your name
              <input
                required
                autoComplete="name"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </label>
            <label>
              Email address
              <input
                required
                type="email"
                autoComplete="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
              />
            </label>
            <label>
              Phone number
              <input
                type="tel"
                autoComplete="tel"
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
              />
            </label>
            <label>
              Message
              <textarea
                required
                value={form.message}
                onChange={(e) => setForm({ ...form, message: e.target.value })}
              />
            </label>
            <Honeypot form={form} setForm={setForm} />
            {error && <p className="form-error">{error}</p>}
            <button
              className="button light"
              type="submit"
              disabled={busy}
              aria-label={copy.submitLabel || "Send"}
            >
              {busy ? "Sending…" : copy.submitLabel}{" "}
              <ArrowUpRight size={17} />
            </button>
          </>
        )}
      </form>
    </section>
  );
}

const absoluteUrl = (url) =>
  !safeUrl(url)
    ? undefined
    : /^https?:\/\//.test(url)
      ? url
      : `${location.origin}${url}`;

function upsertMeta(attr, key, content) {
  if (!content) {
    document.querySelector(`meta[${attr}="${key}"]`)?.remove();
    return;
  }
  let el = document.querySelector(`meta[${attr}="${key}"]`);
  if (!el) {
    el = document.createElement("meta");
    el.setAttribute(attr, key);
    document.head.appendChild(el);
  }
  el.setAttribute("content", content);
}
function upsertLink(rel, href) {
  if (!href) {
    document.querySelector(`link[rel="${rel}"]`)?.remove();
    return;
  }
  let el = document.querySelector(`link[rel="${rel}"]`);
  if (!el) {
    el = document.createElement("link");
    el.setAttribute("rel", rel);
    document.head.appendChild(el);
  }
  el.setAttribute("href", href);
}
function upsertJsonLd(data) {
  let el = document.getElementById("seo-jsonld");
  if (!data) {
    el?.remove();
    return;
  }
  if (!el) {
    el = document.createElement("script");
    el.type = "application/ld+json";
    el.id = "seo-jsonld";
    document.head.appendChild(el);
  }
  el.textContent = JSON.stringify(data);
}
// Keeps the document head (title, description, canonical, OG/Twitter cards,
// JSON-LD) in sync with the current route — every value comes from the
// database (SEO settings, Website content → SEO, company name).
function useSEO(
  {
    title,
    description,
    image,
    path,
    type = "website",
    siteName = "",
    siteTitle = "",
    themeColor,
  } = {},
  jsonLd,
) {
  useEffect(() => {
    const fullTitle = title
      ? siteName && title !== siteName
        ? `${title} | ${siteName}`
        : title
      : siteTitle || siteName;
    if (fullTitle) document.title = fullTitle;
    const url = `${location.origin}${path || location.pathname}`;
    const img = absoluteUrl(image);
    upsertMeta("name", "description", description);
    upsertMeta("name", "theme-color", themeColor);
    upsertLink("canonical", url);
    upsertMeta("property", "og:type", type);
    upsertMeta("property", "og:site_name", siteName);
    upsertMeta("property", "og:title", fullTitle);
    upsertMeta("property", "og:description", description);
    upsertMeta("property", "og:url", url);
    upsertMeta("property", "og:image", img);
    upsertMeta("name", "twitter:card", img ? "summary_large_image" : "summary");
    upsertMeta("name", "twitter:title", fullTitle);
    upsertMeta("name", "twitter:description", description);
    upsertMeta("name", "twitter:image", img);
    upsertJsonLd(jsonLd);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title, description, image, path, type, siteName, siteTitle, themeColor, JSON.stringify(jsonLd)]);
}
function organizationJsonLd(settings) {
  const contact = settings.contact || {};
  const sameAs = [
    settings.social?.instagram,
    settings.social?.linkedin,
    settings.social?.facebook,
    settings.social?.youtube,
  ].filter((u) => safeUrl(u));
  return {
    "@context": "https://schema.org",
    "@type": "GeneralContractor",
    name: settings.companyName || undefined,
    url: location.origin,
    description: settings.tagline || settings.overview || undefined,
    logo: absoluteUrl(settings.brand?.logoUrl),
    image: absoluteUrl(settings.brand?.logoUrl),
    telephone: contact.phone || undefined,
    email: contact.email || undefined,
    address: contact.address
      ? { "@type": "PostalAddress", streetAddress: contact.address }
      : undefined,
    ...(sameAs.length ? { sameAs } : {}),
  };
}
function detailJsonLd(item, kind, siteName) {
  const image = absoluteUrl(item.imageUrl || item.coverUrl);
  const provider = {
    "@type": "Organization",
    name: siteName || undefined,
    url: location.origin,
  };
  if (kind === "blog")
    return {
      "@context": "https://schema.org",
      "@type": "Article",
      headline: item.title,
      description: item.excerpt,
      image,
      datePublished: item.publishedAt || item.createdAt,
      dateModified: item.updatedAt || item.createdAt,
      author: provider,
      publisher: provider,
    };
  if (kind === "project")
    return {
      "@context": "https://schema.org",
      "@type": "CreativeWork",
      name: item.title,
      description: item.summary,
      image,
      about: item.category,
      creator: provider,
    };
  return {
    "@context": "https://schema.org",
    "@type": "Service",
    name: item.title,
    description: item.description,
    image,
    provider,
  };
}
// Builds this render's SEO props from the current path + loaded data:
// per-item SEO fields, then per-page SEO settings, then the page's own
// heading/intro, then the site-wide default description.
function useSiteSEO(path, data) {
  const seo = useMemo(() => {
    if (!data) return {};
    const { settings, services, projects, blogs } = data;
    const content = settings.content || {};
    const site = {
      siteName: settings.companyName,
      siteTitle: settings.seo?.home?.title || content.seo?.siteTitle,
      themeColor: settings.brand?.primary,
    };
    const detail =
      services.find((s) => path === `/services/${s.slug}`) ||
      projects.find((p) => path === `/projects/${p.slug}`) ||
      blogs.find((b) => path === `/blog/${b.slug}`);
    if (detail) {
      const kind = blogs.includes(detail)
        ? "blog"
        : projects.includes(detail)
          ? "project"
          : "service";
      return {
        props: {
          ...site,
          title: detail.seoTitle || detail.title,
          description:
            detail.seoDescription ||
            detail.description ||
            detail.summary ||
            detail.excerpt ||
            content.seo?.defaultDescription,
          image: detail.imageUrl || detail.coverUrl,
          path,
          type: kind === "blog" ? "article" : "website",
        },
        jsonLd: detailJsonLd(detail, kind, settings.companyName),
      };
    }
    const pageKey = path === "/" ? "home" : path.replace("/", "");
    const pageSeo = settings.seo?.[pageKey] || {};
    const pageHero = content.pages?.[pageKey] || {};
    return {
      props: {
        ...site,
        title:
          pageKey === "home"
            ? ""
            : pageSeo.title || content.nav?.[pageKey] || pageHero.title,
        description:
          pageSeo.description ||
          pageHero.lede ||
          (pageKey === "home" ? settings.tagline : "") ||
          content.seo?.defaultDescription,
        image:
          settings.pageBanners?.[pageKey] ||
          heroSlidesOf(settings.brand).find((x) => x.type === "image")?.url,
        path,
        type: "website",
      },
      jsonLd: organizationJsonLd(settings),
    };
  }, [path, data]);
  useSEO(seo.props, seo.jsonLd);
}

// The public site's data, kept fresh: loaded once (retrying while the API
// starts up), then quietly re-fetched every few minutes while the tab is
// open and whenever the visitor returns to it — admin edits show up without
// a reload.
function useBootstrap() {
  const [data, setData] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [slow, setSlow] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    setLoadError("");
    apiWithRetry(`/public/${TENANT}/bootstrap`, {
      onRetry: () => setSlow(true),
    })
      .then(setData)
      .catch((e) => setLoadError(e.message))
      .finally(() => setSlow(false));
  }, [attempt]);
  useEffect(() => {
    let last = Date.now();
    const refresh = () => {
      if (document.visibilityState !== "visible" || Date.now() - last < 60000)
        return;
      last = Date.now();
      api(`/public/${TENANT}/bootstrap`)
        .then(setData)
        .catch(() => {});
    };
    const timer = setInterval(refresh, 3 * 60 * 1000);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, []);
  const site = useMemo(
    () =>
      data && {
        ...data,
        settings: {
          ...data.settings,
          companyName: data.settings?.companyName || data.tenant?.name || "",
          brand: data.settings?.brand || {},
          content: data.settings?.content || {},
          contact: data.settings?.contact || {},
        },
      },
    [data],
  );
  return { data: site, loadError, slow, retry: () => setAttempt((n) => n + 1) };
}

function PublicSite() {
  const { data, loadError, slow, retry } = useBootstrap();
  const emptyForm = { name: "", email: "", phone: "", message: "", website: "" };
  const [form, setForm] = useState(emptyForm);
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  // Two separate errors on purpose: a failed contact-form submit only shows
  // under the form, not in place of the whole page.
  const [error, setError] = useState("");
  const [videoModal, setVideoModal] = useState(null);
  const path = location.pathname.replace(/(.)\/$/, "$1");
  useSiteSEO(path, data);
  const googleReviews = useGoogleReviews(data?.settings);
  if (loadError) return <ErrorState message={loadError} onRetry={retry} />;
  if (!data) return <LoadingState label="Loading…" slow={slow} />;
  const {
    settings,
    services,
    projects,
    testimonials,
    blogs,
    clients = [],
  } = data;
  const b = settings.brand;
  const c = settings.content;
  const home = c.home || {};
  const sections = c.sections || {};
  const pages = c.pages || {};
  const reviewsOn = (where) =>
    googleReviews?.display?.[where] !== false ? googleReviews : null;
  const submit = async (e) => {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      await api(`/public/${TENANT}/leads`, {
        method: "POST",
        body: JSON.stringify(form),
      });
      setSent(true);
      setForm(emptyForm);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };
  const contactProps = {
    settings,
    form,
    setForm,
    sent,
    setSent,
    error,
    busy,
    onSubmit: submit,
  };
  const servicesSection = (heading) =>
    services.length > 0 && (
      <section className="section">
        <SectionHeading heading={heading} href={heading && "/services"} />
        <ServicesGrid services={services} />
      </section>
    );
  const projectsSection = (heading) =>
    projects.length > 0 && (
      <section className="section projects">
        <SectionHeading heading={heading} href={heading && "/projects"} />
        <ProjectsByCategory projects={projects} onPlay={setVideoModal} />
      </section>
    );
  const blogSection = (heading) =>
    blogs.length > 0 && (
      <section className="section insights">
        <SectionHeading heading={heading} href={heading && "/blog"} />
        <BlogGrid blogs={blogs} />
      </section>
    );
  const testimonialsSection = testimonials.length > 0 && (
    <section className="quote-section">
      <TestimonialCarousel items={testimonials} />
    </section>
  );
  const videoModalEl = (
    <VideoModal youtubeId={videoModal} onClose={() => setVideoModal(null)} />
  );

  const detail =
    services.find((item) => path === `/services/${item.slug}`) ||
    projects.find((item) => path === `/projects/${item.slug}`) ||
    blogs.find((item) => path === `/blog/${item.slug}`);
  if (detail)
    return (
      <DetailSite
        item={detail}
        settings={settings}
        onSubmit={submit}
        form={form}
        setForm={setForm}
        sent={sent}
        error={error}
        busy={busy}
      />
    );

  if (path === "/about")
    return (
      <SiteShell settings={settings}>
        <PageHero
          hero={{ ...pages.about, lede: pages.about?.lede || settings.overview }}
          image={settings.pageBanners?.about}
        />
        <StatsBand stats={c.stats} />
        {(has(settings.vision) ||
          has(settings.mission) ||
          settings.values?.length > 0) && (
          <section className="vmv-section">
            <div className="vmv-grid">
              {has(settings.vision) && (
                <div>
                  <p className="eyebrow">Vision</p>
                  <p>{settings.vision}</p>
                </div>
              )}
              {has(settings.mission) && (
                <div>
                  <p className="eyebrow">Mission</p>
                  <p>{settings.mission}</p>
                </div>
              )}
              {settings.values?.length > 0 && (
                <div>
                  <p className="eyebrow">Values</p>
                  <p>{settings.values.join(" · ")}</p>
                </div>
              )}
            </div>
          </section>
        )}
        <ProcessSection process={c.process} />
        <ClientsGrid clients={clients} heading={sections.clients} />
      </SiteShell>
    );

  if (path === "/services")
    return (
      <SiteShell settings={settings}>
        <PageHero hero={pages.services} image={settings.pageBanners?.services} />
        {servicesSection(null)}
      </SiteShell>
    );

  if (path === "/projects")
    return (
      <SiteShell settings={settings}>
        <PageHero hero={pages.projects} image={settings.pageBanners?.projects} />
        {projectsSection(null)}
        {videoModalEl}
        <ClientsGrid clients={clients} heading={sections.clients} />
      </SiteShell>
    );

  if (path === "/blog")
    return (
      <SiteShell settings={settings}>
        <PageHero hero={pages.blog} image={settings.pageBanners?.blog} />
        {blogSection(null)}
      </SiteShell>
    );

  if (path === "/contact")
    return (
      <SiteShell settings={settings}>
        <PageHero hero={pages.contact} image={settings.pageBanners?.contact} />
        <ContactSection {...contactProps} />
        <GoogleReviewsSection
          data={reviewsOn("contact")}
          heading={sections.reviews}
        />
      </SiteShell>
    );

  if (path !== "/")
    return (
      <SiteShell settings={settings}>
        <PageHero
          hero={{
            eyebrow: "404 · Page not found",
            title: "This page has moved, or never existed.",
            lede: "The link may be out of date.",
          }}
        />
        <section className="section not-found-links">
          <a className="button primary" href="/">
            Back to the homepage <ArrowUpRight size={16} />
          </a>
        </section>
      </SiteShell>
    );

  const heroSlides = heroSlidesOf(b);
  const primaryCta = safeUrl(home.primaryCtaLink);
  const secondaryCta = safeUrl(home.secondaryCtaLink);
  const hasHeroCopy =
    has(home.heroEyebrow) ||
    has(home.heroTitle) ||
    has(home.heroLede) ||
    (has(home.primaryCtaLabel) && primaryCta) ||
    (has(home.secondaryCtaLabel) && secondaryCta);
  return (
    <SiteShell settings={settings}>
      <section
        className={`hero hero-banner ${heroSlides.length ? "has-media" : ""} ${heroSlides.length > 1 ? "has-slider" : ""}`}
      >
        {heroSlides.length ? (
          <HeroSlider slides={heroSlides} />
        ) : (
          <div className="hero-shapes">
            <div className="sun" />
            <div className="shape shape-back" />
            <div className="shape shape-front" />
          </div>
        )}
        {hasHeroCopy && (
          <div className="hero-copy">
            {has(home.heroEyebrow) && (
              <p className="eyebrow">{home.heroEyebrow}</p>
            )}
            {has(home.heroTitle) && (
              <h1>
                <RichText text={home.heroTitle} />
              </h1>
            )}
            {has(home.heroLede) && <p className="hero-lede">{home.heroLede}</p>}
            <div className="hero-actions">
              {has(home.primaryCtaLabel) && primaryCta && (
                <a className="button primary" href={primaryCta}>
                  {home.primaryCtaLabel} <ArrowUpRight size={17} />
                </a>
              )}
              {has(home.secondaryCtaLabel) && secondaryCta && (
                <a className="text-link" href={secondaryCta}>
                  {home.secondaryCtaLabel} <span>→</span>
                </a>
              )}
            </div>
          </div>
        )}
        {has(home.stampText) && (
          <div className="hero-stamp">
            {has(home.stampNumber) && <span>{home.stampNumber}</span>}
            <small>
              <RichText text={home.stampText} />
            </small>
          </div>
        )}
      </section>
      {home.trustItems?.length > 0 && (
        <section className="trust-row">
          {has(home.trustLabel) && <span>{home.trustLabel}</span>}
          {home.trustItems.map((item) => (
            <b key={item}>{item}</b>
          ))}
        </section>
      )}
      {(has(home.introTitle) || has(home.introText)) && (
        <section className="intro split">
          <div>
            {has(home.introEyebrow) && (
              <p className="eyebrow">{home.introEyebrow}</p>
            )}
            {has(home.introTitle) && (
              <h2>
                <RichText text={home.introTitle} />
              </h2>
            )}
          </div>
          <div>
            {has(home.introText) && (
              <p className="large-copy">{home.introText}</p>
            )}
            {has(home.introLinkLabel) && (
              <a className="text-link" href="/about">
                {home.introLinkLabel} <span>→</span>
              </a>
            )}
          </div>
        </section>
      )}
      <StatsBand stats={c.stats} />
      {servicesSection(sections.services || {})}
      <ProcessSection process={c.process} />
      {projectsSection(sections.projects || {})}
      {videoModalEl}
      <ClientsGrid clients={clients} heading={sections.clients} />
      {testimonialsSection}
      <GoogleReviewsSection data={reviewsOn("home")} heading={sections.reviews} />
      {blogSection(sections.blog || {})}
      <ContactSection {...contactProps} />
    </SiteShell>
  );
}

function DetailSite({ item, settings, onSubmit, form, setForm, sent, error, busy }) {
  const copy = settings.content?.detail || {};
  const nav = settings.content?.nav || {};
  const contactCopy = settings.content?.contact || {};
  const isProject = location.pathname.startsWith("/projects/");
  const isBlog = location.pathname.startsWith("/blog/");
  const [backHref, backLabel] = isBlog
    ? ["/blog", nav.blog]
    : isProject
      ? ["/projects", nav.projects]
      : ["/services", nav.services];
  const image = item.imageUrl || item.coverUrl;
  const eyebrow = isProject
    ? [item.category, item.location].filter(has).join(" · ")
    : item.category;
  const lede = item.description || item.summary || item.excerpt;
  const body = item.content || item.body || (isProject ? "" : item.summary);
  const sectionEyebrow = isBlog ? copy.insightEyebrow : copy.approachEyebrow;
  const sectionTitle = isBlog ? copy.insightTitle : copy.approachTitle;
  return (
    <SiteShell settings={settings}>
      <section className="detail-hero">
        <div>
          <a className="back-link" href={backHref}>
            ← {has(backLabel) ? backLabel : "Back"}
          </a>
          {has(eyebrow) && <p className="eyebrow">{eyebrow}</p>}
          <h1>{item.title}</h1>
          {has(lede) && <p className="hero-lede">{lede}</p>}
        </div>
        <div
          className={`detail-art ${cssUrl(image) ? "has-content-image" : ""}`}
          style={bgStyle(image)}
        >
          {!cssUrl(image) && <span>{item.title.slice(0, 1)}</span>}
        </div>
      </section>
      {(has(body) || item.benefits?.length > 0 || has(sectionTitle)) && (
        <section className="detail-body">
          <div>
            {has(sectionEyebrow) && <p className="eyebrow">{sectionEyebrow}</p>}
            {has(sectionTitle) && (
              <h2>
                <RichText text={sectionTitle} />
              </h2>
            )}
          </div>
          <div>
            {has(body) && <p className="large-copy">{body}</p>}
            {item.benefits?.filter(has).length > 0 && (
              <ul className="benefit-list">
                {item.benefits.filter(has).map((benefit) => (
                  <li key={benefit}>
                    <Check size={15} />
                    {benefit}
                  </li>
                ))}
              </ul>
            )}
            {has(copy.ctaLabel) && (
              <a className="button primary" href="#detail-contact">
                {copy.ctaLabel} <ArrowUpRight size={16} />
              </a>
            )}
          </div>
        </section>
      )}
      <section className="detail-contact" id="detail-contact">
        <div>
          {has(copy.contactEyebrow) && (
            <p className="eyebrow">{copy.contactEyebrow}</p>
          )}
          {has(copy.contactTitle) && (
            <h2>
              <RichText text={copy.contactTitle} />
            </h2>
          )}
        </div>
        {sent ? (
          <div className="success detail-success">
            <Check size={30} />
            {has(contactCopy.successTitle) && <h3>{contactCopy.successTitle}</h3>}
            {has(contactCopy.successText) && <p>{contactCopy.successText}</p>}
          </div>
        ) : (
          <form onSubmit={onSubmit} className="lead-form">
            <label>
              Your name
              <input
                required
                autoComplete="name"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </label>
            <label>
              Email address
              <input
                required
                type="email"
                autoComplete="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
              />
            </label>
            <label>
              Message
              <textarea
                required
                value={form.message}
                onChange={(e) => setForm({ ...form, message: e.target.value })}
                placeholder={item.title}
              />
            </label>
            <Honeypot form={form} setForm={setForm} />
            {error && <p className="form-error">{error}</p>}
            <button
              className="button light"
              type="submit"
              disabled={busy}
              aria-label={contactCopy.submitLabel || "Send"}
            >
              {busy ? "Sending…" : contactCopy.submitLabel}{" "}
              <ArrowUpRight size={17} />
            </button>
          </form>
        )}
      </section>
    </SiteShell>
  );
}

// --- Digital business card (/card/:slug) --------------------------------------
const cardUrlFor = (slug) => `${location.origin}/card/${slug}`;
const initialsOf = (name = "") =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join("");

function CardExchangeForm({ card }) {
  const firstName = card.name.split(" ")[0];
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    name: "",
    phone: "",
    email: "",
    message: "",
    website: "",
  });
  const [state, setState] = useState({ busy: false, sent: false, error: "" });
  const submit = async (e) => {
    e.preventDefault();
    setState({ busy: true, sent: false, error: "" });
    try {
      await api(`/public/${TENANT}/leads`, {
        method: "POST",
        body: JSON.stringify({ ...form, cardSlug: card.slug }),
      });
      setState({ busy: false, sent: true, error: "" });
    } catch (err) {
      setState({ busy: false, sent: false, error: err.message });
    }
  };
  if (state.sent)
    return (
      <div className="bcard-exchange bcard-exchange-done">
        <Check size={22} />
        <p>
          Thanks — {firstName} has your details and will be in touch.
        </p>
      </div>
    );
  if (!open)
    return (
      <button
        type="button"
        className="bcard-exchange-toggle"
        onClick={() => setOpen(true)}
      >
        <Send size={16} /> Share your details with {firstName}
      </button>
    );
  const field = (key, label, props = {}) => (
    <label>
      {label}
      <input
        value={form[key]}
        onChange={(e) => setForm({ ...form, [key]: e.target.value })}
        {...props}
      />
    </label>
  );
  return (
    <form className="bcard-exchange" onSubmit={submit}>
      <p className="eyebrow">Exchange contact</p>
      {field("name", "Your name", { required: true, autoComplete: "name" })}
      {field("phone", "Phone", { type: "tel", autoComplete: "tel" })}
      {field("email", "Email", { type: "email", autoComplete: "email" })}
      <label>
        Note (optional)
        <textarea
          rows={2}
          value={form.message}
          onChange={(e) => setForm({ ...form, message: e.target.value })}
        />
      </label>
      <Honeypot form={form} setForm={setForm} />
      {state.error && <p className="form-error">{state.error}</p>}
      <div className="bcard-exchange-actions">
        <button
          type="button"
          className="button outline small"
          onClick={() => setOpen(false)}
        >
          Cancel
        </button>
        <button className="button primary" disabled={state.busy}>
          <Send size={15} /> {state.busy ? "Sending…" : "Send"}
        </button>
      </div>
    </form>
  );
}

function BusinessCardPage({ slug }) {
  const preview = new URLSearchParams(location.search).get("preview") === "1";
  const [data, setData] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [slow, setSlow] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [qrOpen, setQrOpen] = useState(false);
  const [toast, setToast] = useState("");
  useEffect(() => {
    setLoadError("");
    apiWithRetry(
      `/public/${TENANT}/cards/${encodeURIComponent(slug)}${preview ? "?track=0" : ""}`,
      { onRetry: () => setSlow(true) },
    )
      .then(setData)
      .catch((e) => setLoadError(e.message))
      .finally(() => setSlow(false));
  }, [slug, attempt]);
  // Live card: edits made in the admin (new number, new photo, card switched
  // off) reach anyone who has the card open within a minute, without a
  // reload. Refreshes use ?track=0 so they aren't counted as new views.
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState !== "visible") return;
      api(`/public/${TENANT}/cards/${encodeURIComponent(slug)}?track=0`)
        .then(setData)
        .catch((e) => e.status === 404 && setLoadError(e.message));
    };
    const timer = setInterval(refresh, 60 * 1000);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [slug]);
  const reviews = useGoogleReviews(data?.settings);
  const card = data?.card;
  const company = data?.settings?.companyName || data?.tenant?.name || "";
  useSEO(
    card
      ? {
          title: `${card.name}${card.designation ? ` — ${card.designation}` : ""}`,
          description:
            card.bio ||
            [card.designation, company].filter(has).join(" · "),
          image: card.photoUrl || data.settings?.brand?.logoUrl,
          type: "profile",
          siteName: company,
          themeColor: data.settings?.brand?.primary,
        }
      : {},
    card
      ? {
          "@context": "https://schema.org",
          "@type": "Person",
          name: card.name,
          jobTitle: card.designation || undefined,
          email: card.email || undefined,
          telephone: card.phone || undefined,
          image: absoluteUrl(card.photoUrl),
          url: cardUrlFor(card.slug),
          worksFor: { "@type": "Organization", name: company, url: location.origin },
        }
      : undefined,
  );
  const flash = (text) => {
    setToast(text);
    setTimeout(() => setToast(""), 2200);
  };
  if (loadError)
    return (
      <ErrorState
        message={loadError}
        onRetry={
          /not found|doesn't exist/i.test(loadError)
            ? undefined
            : () => setAttempt((n) => n + 1)
        }
      >
        <a className="text-link" href="/">
          Visit the website <span>→</span>
        </a>
      </ErrorState>
    );
  if (!data) return <LoadingState label="Opening card" slow={slow} />;

  const { settings } = data;
  const b = settings.brand || {};
  const url = cardUrlFor(card.slug);
  const website = safeUrl(card.website) || location.origin;
  const address = card.address || settings.contact?.address;
  const vcardHref = `${API}/public/${TENANT}/cards/${encodeURIComponent(card.slug)}/vcard`;
  const social = [
    ["linkedin", Linkedin, card.linkedin],
    ["instagram", Instagram, card.instagram],
    ["facebook", Facebook, card.facebook],
  ].filter(([, , href]) => safeUrl(href));
  const share = async () => {
    const payload = {
      title: [card.name, company].filter(has).join(" · "),
      text: [card.name, card.designation, company].filter(has).join(", "),
      url,
    };
    if (navigator.share) {
      try {
        await navigator.share(payload);
        return;
      } catch (err) {
        if (err.name === "AbortError") return;
      }
    }
    if (await copyText(url)) flash("Card link copied");
  };
  const cardReviews =
    reviews?.display?.cards !== false &&
    reviews?.enabled &&
    (reviews.live || reviews.writeReviewUrl)
      ? reviews
      : null;
  const quick = [
    card.phone && { href: `tel:${card.phone}`, icon: <Phone size={19} />, label: "Call" },
    card.whatsapp && {
      href: waLink(card.whatsapp, `Hi ${card.name.split(" ")[0]}, `),
      icon: <WhatsappIcon size={19} />,
      label: "WhatsApp",
      external: true,
    },
    card.email && { href: `mailto:${card.email}`, icon: <Mail size={19} />, label: "Email" },
    address && {
      href: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`,
      icon: <Navigation size={19} />,
      label: "Directions",
      external: true,
    },
  ].filter(Boolean);
  const details = [
    card.phone && { icon: <Phone size={16} />, label: "Mobile", value: card.phone, href: `tel:${card.phone}` },
    card.email && { icon: <Mail size={16} />, label: "Email", value: card.email, href: `mailto:${card.email}` },
    { icon: <Globe size={16} />, label: "Website", value: website.replace(/^https?:\/\//, "").replace(/\/$/, ""), href: website, external: true },
    address && { icon: <MapPin size={16} />, label: "Office", value: address },
  ].filter(Boolean);

  return (
    <div className="bcard-page" style={siteVars(b)}>
      {preview && (
        <div className="bcard-preview-bar">
          Preview — visits from this link aren’t counted in the card’s stats.
        </div>
      )}
      <div className="bcard-layout">
        <article className="bcard">
          <header
            className={`bcard-cover ${cssUrl(card.coverUrl) ? "has-cover" : ""}`}
            style={bgStyle(card.coverUrl)}
          >
            <a className="bcard-logo" href="/" aria-label={company}>
              {safeUrl(b.logoUrl) ? (
                <img src={safeUrl(b.logoUrl)} alt={company} />
              ) : (
                <span className="wordmark">
                  <Wordmark name={company} />
                </span>
              )}
            </a>
            <button
              type="button"
              className="bcard-icon-btn"
              onClick={share}
              aria-label="Share this card"
            >
              <Share2 size={17} />
            </button>
          </header>
          <div className="bcard-identity">
            <div className="bcard-avatar">
              {safeUrl(card.photoUrl) ? (
                <img src={safeUrl(card.photoUrl)} alt={card.name} />
              ) : (
                <span>{initialsOf(card.name)}</span>
              )}
            </div>
            <h1>{card.name}</h1>
            {card.designation && (
              <p className="bcard-role">{card.designation}</p>
            )}
            {has(company) && <p className="bcard-company">{company}</p>}
            {cardReviews?.live && cardReviews.rating && (
              <a
                className="bcard-rating"
                href={safeUrl(cardReviews.mapsUrl || cardReviews.writeReviewUrl)}
                target="_blank"
                rel="noreferrer"
              >
                <GoogleMark size={14} />
                <b>{Number(cardReviews.rating).toFixed(1)}</b>
                <Stars value={cardReviews.rating} size={12} />
                <span>({cardReviews.userRatingCount})</span>
              </a>
            )}
          </div>
          {quick.length > 0 && (
            <nav
              className="bcard-quick"
              style={{ "--cols": quick.length }}
              aria-label="Contact"
            >
              {quick.map((q) => (
                <a
                  key={q.label}
                  href={q.href}
                  {...(q.external ? { target: "_blank", rel: "noreferrer" } : {})}
                >
                  <span>{q.icon}</span>
                  {q.label}
                </a>
              ))}
            </nav>
          )}
          <div className="bcard-save">
            <a className="button primary" href={vcardHref}>
              <UserPlus size={17} /> Save contact
            </a>
            <button
              type="button"
              className="button outline"
              onClick={() => setQrOpen(true)}
              aria-label="Show QR code"
            >
              <QrCode size={17} />
            </button>
          </div>
          {card.bio && <p className="bcard-bio">{card.bio}</p>}
          <ul className="bcard-details">
            {details.map((d) => {
              const Tag = d.href ? "a" : "div";
              return (
                <li key={d.label}>
                  <Tag
                    {...(d.href ? { href: d.href } : {})}
                    {...(d.external ? { target: "_blank", rel: "noreferrer" } : {})}
                  >
                    <span className="bcard-detail-icon">{d.icon}</span>
                    <span>
                      <small>{d.label}</small>
                      {d.value}
                    </span>
                  </Tag>
                </li>
              );
            })}
          </ul>
          {social.length > 0 && (
            <div className="bcard-social">
              {social.map(([key, Icon, href]) => (
                <a
                  key={key}
                  href={safeUrl(href)}
                  target="_blank"
                  rel="noreferrer"
                  aria-label={key}
                >
                  <Icon size={18} />
                </a>
              ))}
            </div>
          )}
          {safeUrl(cardReviews?.writeReviewUrl) && (
            <a
              className="bcard-review-cta"
              href={safeUrl(cardReviews.writeReviewUrl)}
              target="_blank"
              rel="noreferrer"
            >
              <GoogleMark size={18} />
              <span>
                <b>Worked with us?</b>
                <small>Leave us a review on Google</small>
              </span>
              <ArrowUpRight size={16} />
            </a>
          )}
          <CardExchangeForm card={card} />
          <footer className="bcard-foot">
            <a href="/">
              Visit {company || "the"} website <ArrowUpRight size={14} />
            </a>
          </footer>
        </article>
        <aside className="bcard-aside">
          <QrImage value={url} size={440} dark={b.secondary || "#14221f"} />
          <h2>Scan to save on your phone</h2>
          <p>Point your phone’s camera at the code to open this card.</p>
          <button
            type="button"
            className="button outline small"
            onClick={async () => (await copyText(url)) && flash("Card link copied")}
          >
            <Copy size={14} /> Copy link
          </button>
        </aside>
      </div>
      {qrOpen && (
        <div className="modal-backdrop" onClick={() => setQrOpen(false)}>
          <div className="bcard-qr-modal" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              className="video-modal-close"
              onClick={() => setQrOpen(false)}
              aria-label="Close"
            >
              <X size={18} />
            </button>
            <QrImage value={url} size={520} dark={b.secondary || "#14221f"} />
            <b>{card.name}</b>
            <small>Let someone scan this to get your card</small>
          </div>
        </div>
      )}
      {toast && (
        <div className="toast">
          <Check size={16} />
          {toast}
        </div>
      )}
    </div>
  );
}

const nav = [
  { id: "overview", label: "Overview", icon: LayoutDashboard },
  { id: "leads", label: "Leads", icon: Mail },
  { id: "services", label: "Services", icon: FolderKanban },
  { id: "projects", label: "Projects", icon: FolderKanban },
  { id: "blogs", label: "Blogs", icon: FileText },
  { id: "testimonials", label: "Testimonials", icon: Users },
  { id: "clients", label: "Clients", icon: Building2 },
  { id: "cards", label: "Business cards", icon: IdCard },
  { id: "content", label: "Website content", icon: LayoutTemplate },
  { id: "settings", label: "Brand & settings", icon: Settings },
  { id: "users", label: "Users", icon: UsersRound, ownerOnly: true },
  { id: "admin", label: "Admin settings", icon: UserCog },
];
const titles = {
  services: "Services",
  projects: "Projects",
  blogs: "Insights",
  testimonials: "Testimonials",
  clients: "Clients",
  cards: "Business cards",
  leads: "Leads",
};

function Login({ onLogin, notice }) {
  const [form, setForm] = useState({ email: "", password: "" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [brand, setBrand] = useState({ name: "", logoUrl: "" });
  // "signin" or "forgot" (request a reset link); `sent` holds the reply.
  const [mode, setMode] = useState("signin");
  const [sent, setSent] = useState("");
  useEffect(() => {
    apiWithRetry(`/public/${TENANT}/bootstrap`)
      .then((d) =>
        setBrand({
          name: d.settings?.companyName || d.tenant?.name || "",
          logoUrl: d.settings?.brand?.logoUrl || "",
        }),
      )
      .catch(() => {});
  }, []);
  const requestReset = async (e) => {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const data = await api("/auth/forgot-password", {
        method: "POST",
        body: JSON.stringify({ email: form.email }),
      });
      setSent(data.message);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };
  const switchMode = (next) => {
    setMode(next);
    setError("");
    setSent("");
  };
  const submit = async (e) => {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const data = await api("/auth/login", {
        method: "POST",
        body: JSON.stringify(form),
      });
      sessionActive = true;
      onLogin(data.user);
    } catch (err) {
      setError(err.message);
      setForm((f) => ({ ...f, password: "" }));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="admin-login">
      <div className="login-aside">
        <a className="wordmark light-wordmark" href="/">
          <Wordmark
            name={brand.name}
            logoUrl={brand.logoUrl}
            imgClassName="login-logo"
          />
        </a>
        <div>
          <p className="eyebrow">Admin workspace</p>
          <h1>
            Your website,
            <br />
            <em>in your hands.</em>
          </h1>
          <p>
            Every page, card, review and enquiry — managed from one secure
            place.
          </p>
        </div>
        <span className="login-note">
          <ShieldCheck size={13} /> Encrypted session · auto sign-out after 8
          hours
        </span>
      </div>
      {mode === "forgot" ? (
        <form className="login-form" onSubmit={requestReset}>
          <div className="form-heading">
            <span className="admin-kicker">FORGOT PASSWORD</span>
            <h2>Reset your password.</h2>
            <p>
              Enter your account email and we'll send you a link to choose a
              new password.
            </p>
          </div>
          {sent ? (
            <p className="form-notice">
              <MailCheck size={14} /> {sent}
            </p>
          ) : (
            <>
              <label>
                <span className="field-label">
                  Email address<span className="required-mark"> *</span>
                </span>
                <input
                  required
                  autoFocus
                  type="email"
                  autoComplete="username"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                />
              </label>
              {error && <p className="form-error">{error}</p>}
              <button className="button dark" type="submit" disabled={busy}>
                {busy ? "Sending…" : "Send reset link"} <Send size={16} />
              </button>
            </>
          )}
          <button
            type="button"
            className="login-switch"
            onClick={() => switchMode("signin")}
          >
            <ChevronLeft size={14} /> Back to sign in
          </button>
        </form>
      ) : (
      <form className="login-form" onSubmit={submit}>
        <div className="form-heading">
          <span className="admin-kicker">SIGN IN</span>
          <h2>Welcome back.</h2>
          <p>Sign in to manage {brand.name || "your website"}.</p>
        </div>
        {notice && <p className="form-notice">{notice}</p>}
        <label>
          <span className="field-label">
            Email address<span className="required-mark"> *</span>
          </span>
          <input
            required
            autoFocus
            type="email"
            autoComplete="username"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
          />
        </label>
        <PasswordField
          label="Password"
          required
          value={form.password}
          onChange={(e) => setForm({ ...form, password: e.target.value })}
          autoComplete="current-password"
        />
        <button
          type="button"
          className="login-switch forgot-link"
          onClick={() => switchMode("forgot")}
        >
          Forgot password?
        </button>
        {error && <p className="form-error">{error}</p>}
        <button className="button dark" type="submit" disabled={busy}>
          {busy ? "Signing in…" : "Sign in"} <ArrowUpRight size={17} />
        </button>
      </form>
      )}
    </div>
  );
}

// /admin/reset-password?token=… — opened from the "Forgot password" email.
function ResetPasswordPage() {
  // Read once: the token is removed from the address bar right after load.
  const [token] = useState(() => new URLSearchParams(location.search).get("token") || "");
  const [state, setState] = useState({ checking: true, email: "", invalid: "" });
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState("");
  useEffect(() => {
    // Keep the one-time token out of the browser history and any Referer.
    history.replaceState(null, "", "/admin/reset-password");
    api("/auth/reset-password/check", {
      method: "POST",
      body: JSON.stringify({ token }),
    })
      .then((d) => setState({ checking: false, email: d.email, invalid: "" }))
      .catch((err) => setState({ checking: false, email: "", invalid: err.message }));
  }, []);
  const hint = passwordHint(password, state.email);
  const submit = async (e) => {
    e.preventDefault();
    setError("");
    if (hint) return setError(hint);
    if (password !== confirmPassword) return setError("Passwords don't match");
    setBusy(true);
    try {
      const data = await api("/auth/reset-password", {
        method: "POST",
        body: JSON.stringify({ token, password }),
      });
      setDone(data.message);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };
  if (state.checking) return <LoadingState label="Checking your reset link" />;
  return (
    <div className="admin-login reset-page">
      <form className="login-form" onSubmit={submit}>
        <div className="form-heading">
          <span className="admin-kicker">RESET PASSWORD</span>
          <h2>{done ? "All set." : state.invalid ? "Link expired." : "Choose a new password."}</h2>
          <p>{done || state.invalid || `For ${state.email}`}</p>
        </div>
        {!done && !state.invalid && (
          <>
            <PasswordField
              label="New password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
            />
            <small className={`field-hint ${password && !hint ? "ok" : ""}`}>
              {password
                ? hint || "✓ Strong enough"
                : "At least 10 characters, with letters and numbers."}
            </small>
            <PasswordField
              label="Confirm new password"
              required
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              autoComplete="new-password"
            />
            {error && <p className="form-error">{error}</p>}
            <button className="button dark" type="submit" disabled={busy}>
              {busy ? "Saving…" : "Set new password"} <KeyRound size={16} />
            </button>
          </>
        )}
        <a className="button outline" href="/admin">
          {done ? "Sign in" : "Back to sign in"} <ArrowUpRight size={16} />
        </a>
      </form>
    </div>
  );
}

function PasswordField({
  label,
  required,
  value,
  onChange,
  placeholder,
  autoComplete,
}) {
  const [show, setShow] = useState(false);
  return (
    <label className="password-field">
      <span className="field-label">
        {label}
        {required && <span className="required-mark"> *</span>}
      </span>
      <span className="password-input-wrap">
        <input
          type={show ? "text" : "password"}
          required={required}
          value={value}
          onChange={onChange}
          placeholder={placeholder}
          autoComplete={autoComplete}
        />
        <button
          type="button"
          className="password-toggle"
          tabIndex={-1}
          onClick={() => setShow((s) => !s)}
          aria-label={show ? "Hide password" : "Show password"}
        >
          {show ? <EyeOff size={15} /> : <Eye size={15} />}
        </button>
      </span>
    </label>
  );
}

// Mirrors the server's rule (backend/security.js passwordProblem) so the
// admin sees what's wrong while typing; the server still enforces it.
function passwordHint(password, email = "") {
  if (!password) return "";
  if (password.length < 10) return `${10 - password.length} more characters needed`;
  if (!/[a-z]/i.test(password) || !/\d/.test(password))
    return "Add both letters and numbers";
  const emailName = String(email).split("@")[0].toLowerCase();
  if (emailName && password.toLowerCase().includes(emailName))
    return "Don't include your email name in the password";
  return "";
}

// `forced`: the account signed in with a weak/default password and can do
// nothing else until it sets a new one.
function AccountModal({ user, forced, onClose, onSaved, onPasswordChanged, onSignOutEverywhere }) {
  const [name, setName] = useState(user.name || "");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const hint = passwordHint(newPassword, user.email);
  const submit = async (e) => {
    e.preventDefault();
    setError("");
    if (forced && !newPassword) {
      setError("Choose a new password to continue");
      return;
    }
    if (newPassword && newPassword !== confirmPassword) {
      setError("New passwords don't match");
      return;
    }
    if (newPassword && hint) {
      setError(hint);
      return;
    }
    const body = {};
    if (name.trim() && name.trim() !== (user.name || ""))
      body.name = name.trim();
    if (newPassword) {
      body.currentPassword = currentPassword;
      body.newPassword = newPassword;
    }
    if (!Object.keys(body).length) {
      onClose();
      return;
    }
    setBusy(true);
    try {
      const result = await api("/me", {
        method: "PATCH",
        body: JSON.stringify(body),
      });
      // The server ended every other session and issued this one a fresh
      // cookie, so the admin stays signed in here.
      if (newPassword) onPasswordChanged(result.user);
      else onSaved(result.user);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };
  return (
    <div className="modal-backdrop">
      <div className="editor-modal account-modal">
        <div className="modal-header">
          <div>
            <span className="admin-kicker">
              {forced ? "SECURITY CHECK" : "YOUR ACCOUNT"}
            </span>
            <h2>{forced ? "Set a new password" : user.name || "Account"}</h2>
            <p>
              {forced
                ? "Your current password is too weak (or is a default one). Choose a new one to continue."
                : user.email}
            </p>
          </div>
          <button onClick={onClose} aria-label={forced ? "Sign out" : "Close"}>
            <X size={19} />
          </button>
        </div>
        <form className="editor-form" id="account-form" onSubmit={submit}>
          {!forced && (
            <label>
              Display name
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Your name"
              />
            </label>
          )}
          <PasswordField
            label="Current password"
            required={forced}
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            placeholder={forced ? undefined : "Required only to change your password"}
            autoComplete="current-password"
          />
          <PasswordField
            label="New password"
            required={forced}
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            placeholder={forced ? undefined : "Leave blank to keep your current password"}
            autoComplete="new-password"
          />
          <small className={`field-hint ${newPassword && !hint ? "ok" : ""}`}>
            {newPassword
              ? hint || "✓ Strong enough"
              : "At least 10 characters, with letters and numbers."}
          </small>
          <PasswordField
            label="Confirm new password"
            required={forced}
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            autoComplete="new-password"
          />
          {error && <p className="form-error">{error}</p>}
        </form>
        <div className="modal-footer">
          {!forced && (
            <button
              className="button outline danger"
              type="button"
              onClick={onSignOutEverywhere}
              title="Ends every signed-in session for this account, on every device"
            >
              <LogOut size={15} /> Sign out all devices
            </button>
          )}
          <button className="button outline" type="button" onClick={onClose}>
            {forced ? "Sign out" : "Cancel"}
          </button>
          <button
            className="button dark"
            type="submit"
            form="account-form"
            disabled={busy}
          >
            <Save size={16} /> {busy ? "Saving…" : forced ? "Set password" : "Save changes"}
          </button>
        </div>
      </div>
    </div>
  );
}

function AdminApp() {
  const [user, setUser] = useState(null);
  const [checking, setChecking] = useState(true);
  const [tab, setTab] = useState("overview");
  const [tenant, setTenant] = useState(null);
  const [data, setData] = useState({});
  const [toast, setToast] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [loginNotice, setLoginNotice] = useState("");
  const [apiOutdated, setApiOutdated] = useState(false);
  const toastTimer = useRef(null);
  const showToast = (text, tone = "ok") => {
    clearTimeout(toastTimer.current);
    setToast({ text, tone });
    toastTimer.current = setTimeout(
      () => setToast(null),
      tone === "error" ? 5000 : 2600,
    );
  };
  const collectionKeys = [
    "services",
    "projects",
    "blogs",
    "testimonials",
    "clients",
    "cards",
    "leads",
  ];
  const refresh = async () => {
    setLoadError("");
    try {
      const [tenants, settings, ...collections] = await Promise.all([
        apiWithRetry("/tenants"),
        apiWithRetry("/settings"),
        ...collectionKeys.map((x) => apiWithRetry(`/${x}`)),
      ]);
      setTenant(tenants.items[0]);
      setData({
        settings,
        ...Object.fromEntries(
          collectionKeys.map((key, i) => [key, collections[i].items]),
        ),
      });
    } catch (error) {
      if (![401, 403].includes(error.status)) setLoadError(error.message);
    }
  };
  const resetSession = (notice = "") => {
    sessionActive = false;
    setLoginNotice(notice);
    setUser(null);
    setTenant(null);
    setData({});
    setAccountOpen(false);
  };
  const logout = (notice = "") => {
    api("/auth/logout", { method: "POST" }).catch(() => {});
    resetSession(notice);
  };
  // A backend left running from before an update keeps its old code while
  // this page is already new — requests then fail in confusing ways. Say so.
  useEffect(() => {
    api("/health")
      .then((h) => setApiOutdated(!versionAtLeast(h.version, REQUIRED_API_VERSION)))
      .catch(() => {});
  }, []);
  useEffect(() => {
    // The session cookie is httpOnly, so ask the server whether we have one.
    apiWithRetry("/me")
      .then((x) => {
        sessionActive = true;
        setUser(x.user);
        if (!x.user.mustChangePassword) refresh();
      })
      .catch(() => {})
      .finally(() => setChecking(false));
    const onExpired = () =>
      resetSession("Your session ended — please sign in again.");
    const onPasswordRequired = () =>
      setUser((u) => (u ? { ...u, mustChangePassword: true } : u));
    window.addEventListener("gp:session-expired", onExpired);
    window.addEventListener("gp:password-change-required", onPasswordRequired);
    return () => {
      window.removeEventListener("gp:session-expired", onExpired);
      window.removeEventListener("gp:password-change-required", onPasswordRequired);
    };
  }, []);
  // Live dashboard: new enquiries and business-card views/saves show up
  // without a reload — refreshed every 30s while the tab is visible, and
  // straight away when you come back to it.
  useEffect(() => {
    if (!user || user.mustChangePassword) return undefined;
    const poll = () => {
      if (document.visibilityState !== "visible") return;
      Promise.all([api("/leads"), api("/cards")])
        .then(([leads, cards]) =>
          setData((d) =>
            d.settings ? { ...d, leads: leads.items, cards: cards.items } : d,
          ),
        )
        .catch(() => {});
    };
    const timer = setInterval(poll, 30 * 1000);
    document.addEventListener("visibilitychange", poll);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", poll);
    };
  }, [user]);
  if (checking) return <LoadingState label="Loading workspace" />;
  if (!user)
    return (
      <Login
        onLogin={(u) => {
          setLoginNotice("");
          setUser(u);
          if (!u.mustChangePassword) refresh();
        }}
        notice={loginNotice}
      />
    );
  if (user.mustChangePassword)
    return (
      <div className="admin-login forced-password">
        <AccountModal
          user={user}
          forced
          onClose={() => logout()}
          onPasswordChanged={(next) => {
            setUser(next);
            refresh();
            showToast("Password updated — every other session was signed out");
          }}
        />
      </div>
    );
  if (loadError)
    return (
      <ErrorState message={loadError} onRetry={refresh}>
        <button type="button" className="text-link" onClick={() => logout()}>
          Sign out
        </button>
      </ErrorState>
    );
  if (!tenant || !data.settings) return <LoadingState label="Loading workspace" />;
  const companyName = data.settings.companyName || tenant.name || "";
  // Runs an admin action and reports failure as a toast instead of an
  // unhandled promise rejection (which used to fail silently).
  const attempt = async (action, successText) => {
    try {
      const result = await action();
      if (successText) showToast(successText);
      return result;
    } catch (e) {
      showToast(e.message, "error");
      throw e;
    }
  };
  const save = (resource, item, isNew = false) =>
    attempt(async () => {
      const result = await api(
        isNew ? `/${resource}` : `/${resource}/${item.id}`,
        { method: isNew ? "POST" : "PATCH", body: JSON.stringify(item) },
      );
      setData((d) => ({
        ...d,
        [resource]: isNew
          ? [...d[resource], result]
          : d[resource].map((x) => (x.id === result.id ? result : x)),
      }));
      return result;
    }, "Saved successfully");
  const remove = async (resource, item) => {
    if (!confirm(`Delete ${item.title || item.name || "this item"}?`)) return;
    await attempt(async () => {
      await api(`/${resource}/${item.id}`, { method: "DELETE" });
      setData((d) => ({
        ...d,
        [resource]: d[resource].filter((x) => x.id !== item.id),
      }));
    }, "Deleted").catch(() => {});
  };
  const saveSettings = (patch, message = "Settings saved") =>
    attempt(async () => {
      const next = await api("/settings", {
        method: "PATCH",
        body: JSON.stringify(patch),
      });
      setData((d) => ({ ...d, settings: next }));
      return next;
    }, message);
  const initials =
    companyName
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0].toUpperCase())
      .join("") || "·";
  const hour = new Date().getHours();
  return (
    <div className="admin-shell">
      <aside className={`admin-sidebar ${menuOpen ? "open" : ""}`}>
        <div className="sidebar-brand">
          <a className="wordmark" href="/">
            <Wordmark
              name={companyName}
              logoUrl={data.settings.brand?.logoUrl}
              imgClassName="sidebar-logo"
            />
          </a>
          <button onClick={() => setMenuOpen(false)} aria-label="Close menu">
            <X size={18} />
          </button>
        </div>
        <div className="workspace-switcher">
          <span className="avatar">{initials}</span>
          <span>
            <small>WORKSPACE</small>
            <b>{companyName || "Your website"}</b>
          </span>
          <ChevronDown size={15} />
        </div>
        <nav className="admin-nav">
          {nav
            .filter((n) => !n.ownerOnly || user.role === "super_admin")
            .map((n) => {
            const Icon = n.icon;
            return (
              <button
                className={tab === n.id ? "active" : ""}
                onClick={() => {
                  setTab(n.id);
                  setMenuOpen(false);
                }}
                key={n.id}
              >
                <Icon size={17} />
                {n.label}
                {n.id === "leads" &&
                  data.leads?.filter((l) => l.status === "new").length > 0 && (
                    <i>{data.leads.filter((l) => l.status === "new").length}</i>
                  )}
              </button>
            );
          })}
        </nav>
        <div className="sidebar-bottom">
          <a href="/" target="_blank" rel="noreferrer">
            <ExternalLink size={15} />
            View live site
          </a>
          <button onClick={() => logout()}>
            <LogOut size={15} />
            Sign out
          </button>
        </div>
      </aside>
      {menuOpen && (
        <div className="sidebar-scrim" onClick={() => setMenuOpen(false)} />
      )}
      <div className="admin-main">
        {apiOutdated && (
          <p className="notice-banner api-outdated">
            <CircleAlert size={16} />
            <span>
              The API server is running an older version than this dashboard,
              so some actions will fail. Stop the backend (Ctrl+C in its
              terminal) and start it again with <code>npm start</code> in{" "}
              <code>backend/</code>.
            </span>
          </p>
        )}
        <header className="admin-header">
          <button
            className="hamburger"
            onClick={() => setMenuOpen(true)}
            aria-label="Open menu"
          >
            <Menu size={20} />
          </button>
          <div>
            <span className="admin-kicker">{companyName.toUpperCase()}</span>
            <h1>
              {tab === "overview"
                ? `${hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening"}, ${(user.name || "Admin").split(" ")[0]}.`
                : nav.find((n) => n.id === tab)?.label || titles[tab] || tab}
            </h1>
          </div>
          <div className="header-actions">
            <span className="live-pill">
              <i /> Live
            </span>
            <button
              type="button"
              className="user-avatar"
              onClick={() => setAccountOpen(true)}
              title="Your account"
            >
              {(user.name || user.email || "A").slice(0, 1).toUpperCase()}
            </button>
          </div>
        </header>
        <div className="admin-content" key={tab}>
          {tab === "overview" ? (
            <Overview data={data} setTab={setTab} />
          ) : tab === "settings" ? (
            <SettingsPanel
              settings={data.settings}
              onSave={(s) => saveSettings(s)}
              notify={showToast}
            />
          ) : tab === "users" && user.role === "super_admin" ? (
            <UsersPanel notify={showToast} />
          ) : tab === "admin" ? (
            <AdminSettingsPanel
              user={user}
              notify={showToast}
              onPasswordChanged={(next) => {
                setUser(next);
                showToast("Password changed — every other session was signed out");
              }}
            />
          ) : tab === "content" ? (
            <ContentPanel
              settings={data.settings}
              onSave={(patch) => saveSettings(patch, "Website content saved — it's live now")}
            />
          ) : tab === "leads" ? (
            <LeadTable
              items={data.leads}
              onUpdate={(lead) =>
                attempt(async () => {
                  const next = await api(`/leads/${lead.id}`, {
                    method: "PATCH",
                    body: JSON.stringify(lead),
                  });
                  setData((d) => ({
                    ...d,
                    leads: d.leads.map((x) => (x.id === next.id ? next : x)),
                  }));
                }, "Lead updated")
              }
              onDelete={(lead) =>
                attempt(async () => {
                  await api(`/leads/${lead.id}`, { method: "DELETE" });
                  setData((d) => ({
                    ...d,
                    leads: d.leads.filter((x) => x.id !== lead.id),
                  }));
                }, "Lead deleted")
              }
            />
          ) : (
            <ContentManager
              resource={tab}
              items={data[tab] || []}
              categories={data.settings.content?.categories?.[tab]}
              onSave={save}
              onDelete={remove}
            />
          )}
        </div>
      </div>
      {accountOpen && (
        <AccountModal
          user={user}
          onClose={() => setAccountOpen(false)}
          onSaved={(next) => {
            setUser(next);
            setAccountOpen(false);
            showToast("Account updated");
          }}
          onPasswordChanged={(next) => {
            setUser(next);
            setAccountOpen(false);
            showToast("Password changed — every other session was signed out");
          }}
          onSignOutEverywhere={async () => {
            if (!confirm("Sign this account out on every device, including this one?"))
              return;
            await api("/auth/logout-all", { method: "POST" }).catch(() => {});
            resetSession("Signed out on all devices.");
          }}
        />
      )}
      {toast && (
        <div className={`toast ${toast.tone === "error" ? "error" : ""}`} role="status">
          {toast.tone === "error" ? <CircleAlert size={16} /> : <Check size={16} />}
          {toast.text}
        </div>
      )}
    </div>
  );
}

// --- Users (owners only) --------------------------------------------------------
const ROLE_INFO = {
  super_admin: {
    label: "Owner",
    text: "Everything, including adding and removing users.",
  },
  admin: {
    label: "Admin",
    text: "Manages the whole website — content, cards, leads, settings — but not users.",
  },
};
const relativeDate = (iso) => (iso ? `${timeAgo(iso)}` : "Never");

function UserFormModal({ initial, onClose, onSaved }) {
  const isNew = !initial.id;
  const [form, setForm] = useState({
    name: initial.name || "",
    email: initial.email || "",
    role: initial.role || "admin",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const result = await api(isNew ? "/users" : `/users/${initial.id}`, {
        method: isNew ? "POST" : "PATCH",
        body: JSON.stringify(isNew ? form : { name: form.name, role: form.role }),
      });
      onSaved(result, isNew);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };
  return (
    <div className="modal-backdrop">
      <div className="editor-modal user-modal">
        <div className="modal-header">
          <div>
            <span className="admin-kicker">{isNew ? "ADD USER" : "EDIT USER"}</span>
            <h2>{isNew ? "Give someone access" : initial.name}</h2>
            <p>
              {isNew
                ? "They'll get a welcome email with a temporary password and set their own on first sign-in."
                : initial.email}
            </p>
          </div>
          <button onClick={onClose} aria-label="Close">
            <X size={19} />
          </button>
        </div>
        <form className="editor-form" id="user-form" onSubmit={submit}>
          <label>
            <span className="field-label">
              Full name<span className="required-mark"> *</span>
            </span>
            <input
              required
              autoFocus
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </label>
          {isNew && (
            <label>
              <span className="field-label">
                Email address<span className="required-mark"> *</span>
              </span>
              <input
                required
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
              />
            </label>
          )}
          <fieldset className="role-picker">
            <legend>Access level</legend>
            {Object.entries(ROLE_INFO).map(([role, info]) => (
              <label key={role} className={form.role === role ? "selected" : ""}>
                <input
                  type="radio"
                  name="role"
                  value={role}
                  checked={form.role === role}
                  disabled={initial.isYou}
                  onChange={() => setForm({ ...form, role })}
                />
                <span>
                  <b>
                    {role === "super_admin" ? <Crown size={14} /> : <UserCog size={14} />}{" "}
                    {info.label}
                  </b>
                  <small>{info.text}</small>
                </span>
              </label>
            ))}
          </fieldset>
          {error && <p className="form-error">{error}</p>}
        </form>
        <div className="modal-footer">
          <button className="button outline" type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="button dark" type="submit" form="user-form" disabled={busy}>
            {isNew ? <UserPlus size={16} /> : <Save size={16} />}{" "}
            {busy ? "Saving…" : isNew ? "Create & send welcome email" : "Save changes"}
          </button>
        </div>
      </div>
    </div>
  );
}

// Shown after creating a user or resetting a password. When the email went
// out, just confirms it; when it couldn't (SMTP not set up / failed), shows
// the temporary password once so the owner can pass it on themselves.
function CredentialsModal({ result, onClose }) {
  const [copied, setCopied] = useState(false);
  const { user, emailSent, tempPassword, kind } = result;
  const loginUrl = `${location.origin}/admin`;
  const details = `Sign-in page: ${loginUrl}\nEmail: ${user.email}\nTemporary password: ${tempPassword}\n\nYou'll be asked to choose your own password when you first sign in.`;
  return (
    <div className="modal-backdrop">
      <div className="editor-modal credentials-modal">
        <div className="modal-header">
          <div>
            <span className="admin-kicker">
              {kind === "reset" ? "PASSWORD RESET" : "USER CREATED"}
            </span>
            <h2>{emailSent ? "Email sent" : "Share these sign-in details"}</h2>
            <p>{user.name} · {user.email}</p>
          </div>
          <button onClick={onClose} aria-label="Close">
            <X size={19} />
          </button>
        </div>
        <div className="credentials-body">
          {emailSent ? (
            <div className="credentials-ok">
              <MailCheck size={28} />
              <p>
                {kind === "reset"
                  ? `A new temporary password is on its way to ${user.email}.`
                  : `A welcome email with sign-in details is on its way to ${user.email}.`}{" "}
                They'll choose their own password the first time they sign in;
                the temporary one expires in 7 days.
              </p>
            </div>
          ) : (
            <>
              <p className="form-error">
                The email couldn't be sent
                {result.emailError === "smtp-not-configured"
                  ? " — email isn't set up on the server yet (SMTP_PASS in backend/.env)."
                  : "."}{" "}
                Send these details to {user.name.split(" ")[0]} yourself, privately.
                This is the only time the password is shown.
              </p>
              <dl className="credentials-list">
                <dt>Sign-in page</dt>
                <dd>{loginUrl}</dd>
                <dt>Email</dt>
                <dd>{user.email}</dd>
                <dt>Temporary password</dt>
                <dd>
                  <code>{tempPassword}</code>
                </dd>
              </dl>
              <button
                type="button"
                className="button outline small"
                onClick={async () => {
                  setCopied(await copyText(details));
                  setTimeout(() => setCopied(false), 1800);
                }}
              >
                {copied ? <Check size={14} /> : <Copy size={14} />}{" "}
                {copied ? "Copied" : "Copy sign-in details"}
              </button>
            </>
          )}
        </div>
        <div className="modal-footer">
          <button className="button dark" type="button" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

function UsersPanel({ notify }) {
  const [users, setUsers] = useState(null);
  const [emailConfigured, setEmailConfigured] = useState(true);
  const [editing, setEditing] = useState(null);
  const [result, setResult] = useState(null);
  const load = () =>
    api("/users")
      .then((d) => {
        setUsers(d.items);
        setEmailConfigured(d.emailConfigured);
      })
      .catch((e) => notify(e.message, "error"));
  useEffect(() => {
    load();
  }, []);
  const replace = (user) =>
    setUsers((list) => list.map((u) => (u.id === user.id ? user : u)));
  const run = async (action, success) => {
    try {
      const value = await action();
      if (success) notify(success);
      return value;
    } catch (e) {
      notify(e.message, "error");
      return null;
    }
  };
  const resetPassword = async (user) => {
    if (!confirm(`Send ${user.name} a new temporary password? Their current password stops working and they'll be signed out.`)) return;
    const r = await run(() => api(`/users/${user.id}/reset-password`, { method: "POST" }));
    if (r) {
      replace(r.user);
      setResult({ ...r, kind: "reset" });
    }
  };
  const toggleDisabled = async (user) => {
    if (!user.disabled && !confirm(`Disable ${user.name}? They'll be signed out and can't sign in until you enable them again.`)) return;
    const r = await run(
      () => api(`/users/${user.id}`, { method: "PATCH", body: JSON.stringify({ disabled: !user.disabled }) }),
      user.disabled ? `${user.name} can sign in again` : `${user.name} has been disabled`,
    );
    if (r) replace(r.user);
  };
  const remove = async (user) => {
    if (!confirm(`Delete ${user.name}'s account? This can't be undone.`)) return;
    const r = await run(() => api(`/users/${user.id}`, { method: "DELETE" }), "User deleted");
    if (r) setUsers((list) => list.filter((u) => u.id !== user.id));
  };
  const status = (u) =>
    u.disabled
      ? ["archived", "Disabled"]
      : u.mustChangePassword
        ? ["new", "Invite pending"]
        : ["published", "Active"];
  return (
    <section className="content-manager users-panel">
      <div className="toolbar">
        <div>
          <span className="admin-kicker">TEAM</span>
          <h2 className="subheading">People who can manage your website.</h2>
        </div>
        <button className="button dark small" onClick={() => setEditing({})}>
          <UserPlus size={16} /> Add user
        </button>
      </div>
      {!emailConfigured && (
        <p className="notice-banner">
          <CircleAlert size={16} />
          <span>
            Email isn't set up on the server yet, so welcome emails can't be sent.
            You'll be shown each new user's temporary password to pass on
            yourself. To enable email, add your Gmail App Password as
            <code>SMTP_PASS</code> in <code>backend/.env</code> and restart.
          </span>
        </p>
      )}
      <div className="table-card users-table">
        <div className="table-head">
          <span>{users ? `${users.length} users` : "Loading…"}</span>
          <span>ACCESS</span>
          <span>LAST SIGN-IN</span>
          <span />
        </div>
        {(users || []).map((u) => {
          const [tone, label] = status(u);
          return (
            <div className="table-row" key={u.id} onClick={() => setEditing(u)}>
              <div className="row-title">
                <span className="row-icon row-avatar">{initialsOf(u.name || u.email)}</span>
                <div>
                  <b>
                    {u.name || u.email}
                    {u.isYou && <i className="you-tag">You</i>}
                  </b>
                  <small>{u.email}</small>
                </div>
              </div>
              <span className="role-cell">
                <span className={`role-chip ${u.role}`}>
                  {u.role === "super_admin" ? <Crown size={11} /> : <UserCog size={11} />}
                  {ROLE_INFO[u.role]?.label || u.role}
                </span>
                <span className={`status ${tone}`}>{label}</span>
              </span>
              <span className="date-cell" title={u.lastLoginAt || ""}>
                {u.disabled ? "Disabled" : u.mustChangePassword ? "Not yet" : relativeDate(u.lastLoginAt)}
              </span>
              <div className="row-actions" onClick={(e) => e.stopPropagation()}>
                {!u.isYou && (
                  <>
                    <button onClick={() => resetPassword(u)} title="Send a new temporary password" aria-label="Reset password">
                      <KeyRound size={15} />
                    </button>
                    <button
                      onClick={() => toggleDisabled(u)}
                      title={u.disabled ? "Enable" : "Disable"}
                      aria-label={u.disabled ? "Enable user" : "Disable user"}
                    >
                      {u.disabled ? <UserCheck size={15} /> : <Ban size={15} />}
                    </button>
                    <button onClick={() => remove(u)} title="Delete" aria-label="Delete user">
                      <Trash2 size={15} />
                    </button>
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>
      {editing && (
        <UserFormModal
          initial={editing}
          onClose={() => setEditing(null)}
          onSaved={(r, isNew) => {
            setEditing(null);
            if (isNew) {
              setUsers((list) => [...(list || []), r.user]);
              setResult({ ...r, kind: "welcome" });
            } else {
              replace(r.user);
              notify("User updated");
            }
          }}
        />
      )}
      {result && <CredentialsModal result={result} onClose={() => setResult(null)} />}
    </section>
  );
}

function Overview({ data, setTab }) {
  const newLeads = data.leads.filter((x) => x.status === "new").length;
  const published = [
    ...(data.services || []),
    ...(data.projects || []),
    ...(data.blogs || []),
  ].filter((x) => x.status === "published").length;
  return (
    <>
      <div className="welcome-banner">
        <div>
          <span className="admin-kicker">YOUR CONTROL PLANE</span>
          <h2>Turn every brief into a better build.</h2>
          <p>Your website is live and ready to evolve.</p>
          <a className="button small light" href="/" target="_blank">
            View website <ArrowUpRight size={15} />
          </a>
        </div>
        <div className="welcome-orbit">
          <span>{initialsOf(data.settings?.companyName)}</span>
        </div>
      </div>
      <div className="metrics">
        <Metric
          label="New enquiries"
          value={newLeads}
          note="Needs your attention"
          icon={Mail}
        />
        <Metric
          label="Published content"
          value={published}
          note="Across your website"
          icon={Check}
        />
        <Metric
          label="Services"
          value={data.services.length}
          note="Configured capabilities"
          icon={FolderKanban}
        />
        <Metric
          label="Projects"
          value={data.projects.length}
          note="In your portfolio"
          icon={FolderKanban}
        />
      </div>
      <div className="dashboard-columns">
        <section className="panel">
          <div className="panel-heading">
            <div>
              <span className="admin-kicker">RECENT ENQUIRIES</span>
              <h3>Lead pipeline</h3>
            </div>
            <button className="plain-link" onClick={() => setTab("leads")}>
              View all →
            </button>
          </div>
          {data.leads.length ? (
            data.leads.slice(0, 4).map((l) => (
              <div className="mini-lead" key={l.id}>
                <span className="lead-avatar">{l.name.slice(0, 1)}</span>
                <div>
                  <b>{l.name}</b>
                  <span>
                    {l.message.slice(0, 55)}
                    {l.message.length > 55 ? "…" : ""}
                  </span>
                </div>
                <Status status={l.status} />
              </div>
            ))
          ) : (
            <Empty
              title="Your next project starts here"
              text="Enquiries from the public website will appear in this pipeline."
            />
          )}
        </section>
        <section className="panel activity">
          <div className="panel-heading">
            <div>
              <span className="admin-kicker">QUICK START</span>
              <h3>Shape the experience</h3>
            </div>
          </div>
          {[
            [
              "Brand & settings",
              "Set your visual identity and contact details",
              "settings",
            ],
            ["Services", "Add the work you want to be known for", "services"],
            [
              "Projects",
              "Show the spaces you have brought to life",
              "projects",
            ],
            [
              "Business cards",
              "Give your team a shareable digital card with QR",
              "cards",
            ],
          ].map(([title, text, id]) => (
            <button
              className="quick-action"
              key={id}
              onClick={() => setTab(id)}
            >
              <span>{title.slice(0, 1)}</span>
              <div>
                <b>{title}</b>
                <small>{text}</small>
              </div>
              <ArrowUpRight size={17} />
            </button>
          ))}
        </section>
      </div>
    </>
  );
}
function Metric({ label, value, note, icon: Icon }) {
  return (
    <div className="metric">
      <span className="metric-icon">
        <Icon size={17} />
      </span>
      <span className="admin-kicker">{label}</span>
      <strong>{value}</strong>
      <small>{note}</small>
    </div>
  );
}
function Empty({ title, text }) {
  return (
    <div className="empty">
      <span>✦</span>
      <h4>{title}</h4>
      <p>{text}</p>
    </div>
  );
}
function Status({ status }) {
  return <span className={`status ${status}`}>{status}</span>;
}

function CardShareModal({ card, onClose }) {
  const url = cardUrlFor(card.slug);
  const [copied, setCopied] = useState(false);
  const qr = useQrDataUrl(url, { size: 1024 });
  const downloadQr = () => {
    const a = document.createElement("a");
    a.href = qr;
    a.download = `${card.slug}-qr.png`;
    a.click();
  };
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="editor-modal card-share-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <div>
            <span className="admin-kicker">SHARE BUSINESS CARD</span>
            <h2>{card.name}</h2>
            <p>{card.designation || "Digital business card"}</p>
          </div>
          <button onClick={onClose} aria-label="Close">
            <X size={19} />
          </button>
        </div>
        <div className="card-share-body">
          <div className="card-share-qr">
            {qr ? <img src={qr} alt="Card QR code" /> : <div className="qr-placeholder" />}
          </div>
          <div className="card-share-info">
            {card.status !== "published" && (
              <p className="form-error">
                This card is a {card.status || "draft"} — set its status to
                Published so the link and QR code work.
              </p>
            )}
            <label>
              Card link
              <span className="copy-field">
                <input readOnly value={url} onFocus={(e) => e.target.select()} />
                <button
                  type="button"
                  onClick={async () => {
                    setCopied(await copyText(url));
                    setTimeout(() => setCopied(false), 1800);
                  }}
                >
                  {copied ? <Check size={14} /> : <Copy size={14} />}
                </button>
              </span>
            </label>
            <div className="card-share-stats">
              <div>
                <strong>{card.views || 0}</strong>
                <small>Card views</small>
              </div>
              <div>
                <strong>{card.saves || 0}</strong>
                <small>Contacts saved</small>
              </div>
            </div>
            <div className="card-share-actions">
              <button
                type="button"
                className="button dark small"
                onClick={downloadQr}
                disabled={!qr}
              >
                <Download size={14} /> Download QR (PNG)
              </button>
              <a
                className="button outline small"
                href={waLink("", `${card.name} — ${url}`)}
                target="_blank"
                rel="noreferrer"
              >
                <WhatsappIcon size={14} /> Send on WhatsApp
              </a>
              <a
                className="button outline small"
                href={`${url}?preview=1`}
                target="_blank"
                rel="noreferrer"
              >
                <ExternalLink size={14} /> Preview card
              </a>
            </div>
            <small className="field-hint">
              Print the QR on a visiting card, add the link to an email
              signature, or send it on WhatsApp. Previews aren’t counted in
              the stats.
            </small>
          </div>
        </div>
      </div>
    </div>
  );
}

function ContentManager({ resource, items, categories = [], onSave, onDelete }) {
  const [editing, setEditing] = useState(null);
  const [sharing, setSharing] = useState(null);
  const [query, setQuery] = useState("");
  const filtered = items.filter((x) =>
    JSON.stringify(x).toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <section className="content-manager">
      <div className="toolbar">
        <div className="search">
          <span>⌕</span>
          <input
            placeholder={`Search ${titles[resource].toLowerCase()}…`}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <button
          className="button dark small"
          onClick={() =>
            setEditing({
              // Cards, testimonials and clients are named, not titled.
              ...(["cards", "testimonials", "clients"].includes(resource) ? {} : { title: "" }),
              status: "published",
              ...(resource === "services"
                ? { description: "", category: categories[0] || "" }
                : {}),
              ...(resource === "projects"
                ? {
                    summary: "",
                    category: categories[0] || "",
                    location: "",
                    year: new Date().getFullYear().toString(),
                  }
                : {}),
              ...(resource === "blogs"
                ? { excerpt: "", body: "", category: "" }
                : {}),
              ...(resource === "testimonials"
                ? { name: "", role: "", quote: "", rating: 5, photoUrl: "" }
                : {}),
              ...(resource === "clients" ? { name: "", logoUrl: "" } : {}),
              ...(resource === "cards"
                ? {
                    name: "",
                    designation: "",
                    phone: "",
                    whatsapp: "",
                    email: "",
                    photoUrl: "",
                  }
                : {}),
            })
          }
        >
          <Plus size={16} /> Add{" "}
          {resource === "blogs" ? "insight" : resource.slice(0, -1)}
        </button>
      </div>
      <div className="table-card">
        <div className="table-head">
          <span>{filtered.length} items</span>
          <span>STATUS</span>
          <span>UPDATED</span>
          <span />
        </div>
        {filtered.map((item) => (
          <div
            className="table-row"
            key={item.id}
            onClick={() => setEditing(item)}
          >
            <div className="row-title">
              {resource === "cards" ? (
                <span className="row-icon row-avatar">
                  {item.photoUrl ? (
                    <img src={item.photoUrl} alt="" />
                  ) : (
                    initialsOf(item.name)
                  )}
                </span>
              ) : (
                <span className="row-icon">
                  {resource === "services"
                    ? "✦"
                    : resource === "projects"
                      ? "◒"
                      : "▤"}
                </span>
              )}
              <div>
                <b>{item.title || item.name}</b>
                <small>
                  {resource === "cards"
                    ? `${item.designation || "/card/" + item.slug} · ${item.views || 0} views · ${item.saves || 0} saves`
                    : item.category || item.slug || item.role || "Content entry"}
                </small>
              </div>
            </div>
            <Status status={item.status || "published"} />
            <span className="date-cell">
              {dateLabel(item.updatedAt || item.createdAt)}
            </span>
            <div className="row-actions" onClick={(e) => e.stopPropagation()}>
              {resource === "cards" && (
                <button
                  onClick={() => setSharing(item)}
                  aria-label="Share card / QR code"
                  title="Share & QR code"
                >
                  <QrCode size={15} />
                </button>
              )}
              <button onClick={() => setEditing(item)} aria-label="Edit">
                <Pencil size={15} />
              </button>
              <button onClick={() => onDelete(resource, item)} aria-label="Delete">
                <Trash2 size={15} />
              </button>
            </div>
          </div>
        ))}
        {!filtered.length && (
          <Empty
            title="Nothing here yet"
            text="Add your first content item to bring this area to life."
          />
        )}
      </div>
      {editing && (
        <Editor
          resource={resource}
          categories={categories}
          initial={editing}
          onClose={() => setEditing(null)}
          onSave={async (item) => {
            try {
              const saved = await onSave(resource, item, !item.id);
              setEditing(null);
              // A brand-new card is only useful once it's shared — go
              // straight to its link + QR code.
              if (resource === "cards" && !item.id && saved) setSharing(saved);
            } catch {
              /* error already shown as a toast; keep the editor open */
            }
          }}
        />
      )}
      {sharing && (
        <CardShareModal
          card={items.find((x) => x.id === sharing.id) || sharing}
          onClose={() => setSharing(null)}
        />
      )}
    </section>
  );
}
// Fields the public website actually needs to render an item properly —
// enforced as real (native <form> + required attribute) validation below,
// not just a UI hint, so the admin can't save content the site can't show.
const REQUIRED_FIELDS = {
  services: ["title"],
  projects: ["title"],
  blogs: ["title"],
  testimonials: ["name", "quote"],
  clients: ["name"],
  cards: ["name"],
};
const TEXTAREA_KEYS = [
  "body",
  "content",
  "description",
  "summary",
  "excerpt",
  "quote",
  "benefits",
  "seoDescription",
  "bio",
];
// Per-field input type / placeholder / hint (business card fields mostly).
const FIELD_META = {
  email: { type: "email", placeholder: "name@company.com" },
  phone: { type: "tel", placeholder: "+91 98765 43210" },
  whatsapp: {
    type: "tel",
    placeholder: "919876543210",
    hint: "Country code + number, digits only.",
  },
  slug: {
    placeholder: "Created from the name",
    hint: "The card’s address: yoursite.com/card/<this>. Changing it breaks QR codes already printed.",
  },
  website: { placeholder: "Defaults to this website" },
  address: { placeholder: "Defaults to the company address" },
  linkedin: { placeholder: "https://www.linkedin.com/in/…" },
  instagram: { placeholder: "https://www.instagram.com/…" },
  facebook: { placeholder: "https://www.facebook.com/…" },
  videoUrl: { placeholder: "https://www.youtube.com/watch?v=…" },
  websiteUrl: { placeholder: "https://…" },
};
// Service/project categories come from Website content → Categories (a
// fixed list rather than free text keeps the per-category project rows on
// the site consistent). With no list set up, the field is free text.
function Editor({ resource, initial, categories = [], onClose, onSave }) {
  const [item, setItem] = useState(initial);
  const change = (key, value) => setItem({ ...item, [key]: value });
  const fieldList =
    resource === "services"
      ? [
          ["title", "Title"],
          ["category", "Category"],
          ["description", "Short description"],
          ["content", "Long description"],
          ["imageUrl", "Cover image"],
          ["benefits", "Benefits (one per line)"],
          ["seoTitle", "SEO title (optional)"],
          ["seoDescription", "SEO description (optional)"],
        ]
      : resource === "projects"
        ? [
            ["title", "Project title"],
            ["category", "Category"],
            ["client", "Client"],
            ["location", "Location"],
            ["year", "Completion year"],
            ["imageUrl", "Cover image"],
            ["videoUrl", "YouTube video link"],
            ["summary", "Summary"],
            ["seoTitle", "SEO title (optional)"],
            ["seoDescription", "SEO description (optional)"],
          ]
        : resource === "blogs"
          ? [
              ["title", "Title"],
              ["category", "Category"],
              ["coverUrl", "Cover image"],
              ["excerpt", "Excerpt"],
              ["body", "Article body"],
              ["seoTitle", "SEO title (optional)"],
              ["seoDescription", "SEO description (optional)"],
            ]
          : resource === "testimonials"
            ? [
                ["photoUrl", "Photo"],
                ["name", "Name"],
                ["role", "Role / company"],
                ["quote", "Quote"],
                ["rating", "Rating (1–5)"],
              ]
            : resource === "cards"
              ? [
                  ["photoUrl", "Profile photo"],
                  ["coverUrl", "Cover image (optional)"],
                  ["name", "Full name"],
                  ["designation", "Designation / role"],
                  ["slug", "Card link"],
                  ["phone", "Mobile number"],
                  ["whatsapp", "WhatsApp number"],
                  ["email", "Email address"],
                  ["website", "Website"],
                  ["address", "Office address"],
                  ["bio", "Short bio"],
                  ["linkedin", "LinkedIn"],
                  ["instagram", "Instagram"],
                  ["facebook", "Facebook"],
                ]
              : [
                ["logoUrl", "Logo"],
                ["name", "Client name"],
                ["websiteUrl", "Website (optional)"],
              ];
  const requiredKeys = REQUIRED_FIELDS[resource] || [];
  const categoryOptions =
    categories.length > 0
      ? [...new Set([...categories, ...(item.category ? [item.category] : [])])]
      : null;
  return (
    <div className="modal-backdrop">
      <div className="editor-modal">
        <div className="modal-header">
          <div>
            <span className="admin-kicker">
              {initial.id ? "EDIT CONTENT" : "NEW CONTENT"}
            </span>
            <h2>{initial.id ? "Refine this entry" : "Add to your website"}</h2>
          </div>
          <button onClick={onClose}>
            <X size={19} />
          </button>
        </div>
        <form
          className="editor-form"
          id="editor-form"
          onSubmit={(e) => {
            e.preventDefault();
            onSave(item);
          }}
        >
          {fieldList.map(([key, label]) =>
            key === "imageUrl" ||
            key === "coverUrl" ||
            key === "photoUrl" ||
            key === "logoUrl" ? (
              <AssetUploadField
                key={key}
                label={label}
                value={item[key] || ""}
                onChange={(url) => change(key, url)}
              />
            ) : key === "category" && categoryOptions ? (
              <label key={key}>
                {label}
                <select
                  value={item.category || ""}
                  onChange={(e) => change("category", e.target.value)}
                >
                  <option value="">— No category —</option>
                  {categoryOptions.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </label>
            ) : key === "rating" ? (
              <label key={key}>
                {label}
                <input
                  type="number"
                  min="1"
                  max="5"
                  value={item.rating ?? 5}
                  onChange={(e) =>
                    change(
                      "rating",
                      Math.min(5, Math.max(1, Number(e.target.value) || 1)),
                    )
                  }
                />
              </label>
            ) : (
              <label key={key}>
                <span className="field-label">
                  {label}
                  {requiredKeys.includes(key) && (
                    <span className="required-mark"> *</span>
                  )}
                </span>
                {TEXTAREA_KEYS.includes(key) ? (
                  <textarea
                    required={requiredKeys.includes(key)}
                    rows={key === "body" ? 7 : key === "seoDescription" ? 2 : 3}
                    value={
                      Array.isArray(item[key])
                        ? item[key].join("\n")
                        : item[key] || ""
                    }
                    onChange={(e) =>
                      change(
                        key,
                        key === "benefits"
                          ? e.target.value.split("\n")
                          : e.target.value,
                      )
                    }
                  />
                ) : (
                  <input
                    required={requiredKeys.includes(key)}
                    type={FIELD_META[key]?.type || "text"}
                    value={item[key] || ""}
                    onChange={(e) => change(key, e.target.value)}
                    placeholder={FIELD_META[key]?.placeholder}
                  />
                )}
                {FIELD_META[key]?.hint && (
                  <small className="field-hint">{FIELD_META[key].hint}</small>
                )}
              </label>
            ),
          )}
          <label>
            Status
            <select
              value={item.status || "draft"}
              onChange={(e) => change("status", e.target.value)}
            >
              <option value="draft">Draft</option>
              <option value="published">Published</option>
              <option value="archived">Archived</option>
            </select>
          </label>
        </form>
        <div className="modal-footer">
          <button className="button outline" type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="button dark" type="submit" form="editor-form">
            <Save size={16} /> Save changes
          </button>
        </div>
      </div>
    </div>
  );
}

const LEAD_STATUSES = ["new", "contacted", "qualified", "won", "lost"];
function exportLeadsCsv(leads) {
  const cols = [
    ["createdAt", "Received"],
    ["name", "Name"],
    ["email", "Email"],
    ["phone", "Phone"],
    ["message", "Message"],
    ["source", "Source"],
    ["cardName", "Business card"],
    ["status", "Status"],
    ["notes", "Notes"],
  ];
  const cell = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const csv = [
    cols.map(([, label]) => cell(label)).join(","),
    ...leads.map((l) => cols.map(([key]) => cell(l[key])).join(",")),
  ].join("\r\n");
  // BOM so Excel opens UTF-8 names (₹, accents, Kannada…) correctly.
  const blob = new Blob(["﻿", csv], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `leads-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
const leadSourceLabel = (lead) =>
  lead.source === "business-card"
    ? `Card · ${lead.cardName || "business card"}`
    : "Website";

function LeadTable({ items, onUpdate, onDelete }) {
  const [selected, setSelected] = useState(null);
  const [filter, setFilter] = useState("all");
  const shown =
    filter === "all" ? items : items.filter((l) => l.status === filter);
  return (
    <section className="content-manager">
      <div className="toolbar">
        <div>
          <span className="admin-kicker">INBOX</span>
          <h2 className="subheading">Every enquiry, one clear next step.</h2>
        </div>
        <div className="toolbar-actions">
          <select
            className="filter-select"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            aria-label="Filter by status"
          >
            <option value="all">All statuses ({items.length})</option>
            {LEAD_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s[0].toUpperCase() + s.slice(1)} (
                {items.filter((l) => l.status === s).length})
              </option>
            ))}
          </select>
          <button
            type="button"
            className="button outline small"
            onClick={() => exportLeadsCsv(shown)}
            disabled={!shown.length}
          >
            <Download size={14} /> Export CSV
          </button>
        </div>
      </div>
      <div className="table-card lead-table">
        <div className="table-head">
          <span>CONTACT</span>
          <span>MESSAGE</span>
          <span>STATUS</span>
          <span>RECEIVED</span>
        </div>
        {shown.map((lead) => (
          <div
            className="table-row"
            key={lead.id}
            onClick={() => setSelected(lead)}
          >
            <div className="row-title">
              <span className="lead-avatar">{lead.name.slice(0, 1)}</span>
              <div>
                <b>{lead.name}</b>
                <small>
                  {[lead.email, lead.phone].filter(Boolean).join(" · ") ||
                    "No contact details"}
                </small>
              </div>
            </div>
            <span className="message-cell">
              {lead.source === "business-card" && (
                <i className="source-tag">{leadSourceLabel(lead)}</i>
              )}
              {lead.message || "—"}
            </span>
            <Status status={lead.status} />
            <span className="date-cell">{dateLabel(lead.createdAt)}</span>
          </div>
        ))}
        {!shown.length && (
          <Empty
            title={items.length ? "No enquiries with this status" : "No enquiries yet"}
            text={
              items.length
                ? "Try another status filter."
                : "Your contact form is ready. New messages will land here."
            }
          />
        )}
      </div>
      {selected && (
        <div className="modal-backdrop">
          <div className="editor-modal lead-modal">
            <div className="modal-header">
              <div>
                <span className="admin-kicker">
                  ENQUIRY · {dateLabel(selected.createdAt)}
                </span>
                <h2>{selected.name}</h2>
                <p className="lead-contact-links">
                  {selected.email && (
                    <a href={`mailto:${selected.email}`}>{selected.email}</a>
                  )}
                  {selected.phone ? (
                    <a href={`tel:${selected.phone}`}>{selected.phone}</a>
                  ) : (
                    <span>No phone supplied</span>
                  )}
                  <span>{leadSourceLabel(selected)}</span>
                </p>
              </div>
              <button onClick={() => setSelected(null)}>
                <X size={19} />
              </button>
            </div>
            <div className="lead-message">
              {selected.message || "No message — contact details only."}
            </div>
            <div className="lead-edit-grid">
              {[
                ["name", "Name", "text"],
                ["email", "Email", "email"],
                ["phone", "Phone", "tel"],
              ].map(([key, label, type]) => (
                <label key={key}>
                  {label}
                  <input
                    type={type}
                    value={selected[key] || ""}
                    onChange={(e) =>
                      setSelected({ ...selected, [key]: e.target.value })
                    }
                  />
                </label>
              ))}
            </div>
            <label>
              Status
              <select
                value={selected.status}
                onChange={(e) =>
                  setSelected({ ...selected, status: e.target.value })
                }
              >
                <option value="new">New</option>
                <option value="contacted">Contacted</option>
                <option value="qualified">Qualified</option>
                <option value="won">Won</option>
                <option value="lost">Lost</option>
              </select>
            </label>
            <label>
              Internal notes
              <textarea
                value={selected.notes || ""}
                onChange={(e) =>
                  setSelected({ ...selected, notes: e.target.value })
                }
                placeholder="Add a note for your team…"
              />
            </label>
            <div className="modal-footer">
              <button
                className="button outline danger"
                onClick={async () => {
                  if (!confirm(`Delete the enquiry from ${selected.name}?`))
                    return;
                  await onDelete(selected)
                    .then(() => setSelected(null))
                    .catch(() => {});
                }}
              >
                <Trash2 size={15} /> Delete
              </button>
              <button
                className="button dark"
                onClick={async () => {
                  await onUpdate(selected)
                    .then(() => setSelected(null))
                    .catch(() => {});
                }}
              >
                Save lead
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function AssetUploadField({ label, hint, value, onChange, trim }) {
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState("");
  const handle = async (e) => {
    const original = e.target.files[0];
    e.target.value = "";
    if (!original) return;
    setBusy(true);
    setProgress(2);
    setError("");
    try {
      const file = await compressImageFile(original);
      const result = await uploadWithProgress(
        file,
        setProgress,
        undefined,
        trim,
      );
      onChange(result.url);
    } catch (err) {
      setError(err.message);
    } finally {
      setTimeout(() => {
        setBusy(false);
        setProgress(0);
      }, 400);
    }
  };
  return (
    <label className="asset-upload-field">
      {label}
      <div className="asset-upload-box">
        {value ? (
          <div className="asset-preview">
            <img src={value} alt="" />
          </div>
        ) : (
          <div className="asset-placeholder">
            <Image size={20} />
          </div>
        )}
        <div className="asset-upload-actions">
          <label className="button outline small">
            {busy
              ? `Uploading… ${progress}%`
              : value
                ? "Replace image"
                : "Upload image"}
            <input
              hidden
              type="file"
              accept="image/*"
              disabled={busy}
              onChange={handle}
            />
          </label>
          {value && !busy && (
            <button
              type="button"
              className="asset-remove"
              onClick={() => onChange("")}
            >
              <Trash2 size={13} /> Remove
            </button>
          )}
        </div>
      </div>
      {hint && <small className="field-hint">{hint}</small>}
      {error && <p className="form-error">{error}</p>}
    </label>
  );
}

// --- Website content (admin) ---------------------------------------------------
// Every piece of text on the public site, grouped the way it appears there.
// Paths are into settings.content; the server validates the same shape
// (backend/security.js CONTENT_SCHEMA). Empty fields hide their block.
const T = (path, label, type = "text", extra = {}) => ({ path, label, type, ...extra });
const headingFields = (base, label) => [
  T(`${base}.eyebrow`, `${label} — small label`),
  T(`${base}.title`, `${label} — heading`, "title"),
];
const CONTENT_SECTIONS = [
  {
    id: "nav",
    title: "Menu & header",
    text: "Menu labels for the six pages. Leave a label empty to hide that page from the menu.",
    fields: [
      T("nav.home", "Home"),
      T("nav.about", "About"),
      T("nav.services", "Services"),
      T("nav.projects", "Projects"),
      T("nav.blog", "Blog"),
      T("nav.contact", "Contact"),
      T("nav.cta", "Header button (links to Contact)"),
    ],
  },
  {
    id: "hero",
    title: "Homepage hero",
    text: "The headline area at the top of the homepage. The banner image or video is set in Brand & settings.",
    fields: [
      T("home.heroEyebrow", "Small label above the headline"),
      T("home.heroTitle", "Headline", "title"),
      T("home.heroLede", "Intro paragraph", "textarea"),
      T("home.primaryCtaLabel", "Main button label"),
      T("home.primaryCtaLink", "Main button link", "url", { placeholder: "/contact" }),
      T("home.secondaryCtaLabel", "Second link label"),
      T("home.secondaryCtaLink", "Second link", "url", { placeholder: "/projects" }),
      T("home.stampNumber", "Badge number (e.g. 01)"),
      T("home.stampText", "Badge text", "title"),
    ],
  },
  {
    id: "trust",
    title: "Trust strip",
    text: "The thin row under the hero listing who you work for.",
    fields: [
      T("home.trustLabel", "Label"),
      T("home.trustItems", "Items", "list", { addLabel: "Add item" }),
    ],
  },
  {
    id: "intro",
    title: "Homepage introduction",
    fields: [
      T("home.introEyebrow", "Small label"),
      T("home.introTitle", "Heading", "title"),
      T("home.introText", "Paragraph", "textarea"),
      T("home.introLinkLabel", "Link to About page — label"),
    ],
  },
  {
    id: "stats",
    title: "Key figures",
    text: "Shown on the homepage and About page. Numbers count up as visitors scroll to them.",
    fields: [
      T("stats", "Figures", "items", {
        addLabel: "Add figure",
        max: 8,
        itemFields: [
          T("value", "Figure (e.g. 250+, 100%)"),
          T("label", "Caption", "title"),
        ],
      }),
    ],
  },
  {
    id: "process",
    title: "How we work",
    fields: [
      T("process.eyebrow", "Small label"),
      T("process.title", "Heading", "title"),
      T("process.text", "Paragraph", "textarea"),
      T("process.steps", "Steps", "items", {
        addLabel: "Add step",
        max: 12,
        itemFields: [T("title", "Step name"), T("text", "One-line description")],
      }),
    ],
  },
  {
    id: "sections",
    title: "Homepage section headings",
    text: "Headings above each list on the homepage. The link labels point to that section's own page.",
    fields: [
      ...headingFields("sections.services", "Services"),
      T("sections.services.linkLabel", "Services — link label"),
      ...headingFields("sections.projects", "Projects"),
      T("sections.projects.linkLabel", "Projects — link label"),
      ...headingFields("sections.clients", "Clients"),
      ...headingFields("sections.reviews", "Google reviews"),
      T("sections.reviews.linkLabel", "Google reviews — 'see all' link label"),
      ...headingFields("sections.blog", "Blog"),
      T("sections.blog.linkLabel", "Blog — link label"),
    ],
  },
  {
    id: "pages",
    title: "Page headers",
    text: "The heading block at the top of each inner page. Banner photos for them are in Brand & settings.",
    fields: ["about", "services", "projects", "blog", "contact"].flatMap((page) => {
      const label = page[0].toUpperCase() + page.slice(1);
      return [
        T(`pages.${page}.eyebrow`, `${label} — small label`),
        T(`pages.${page}.title`, `${label} — heading`, "title"),
        T(`pages.${page}.lede`, `${label} — intro${page === "about" ? " (empty = company overview)" : ""}`, "textarea"),
      ];
    }),
  },
  {
    id: "contact",
    title: "Contact section & form",
    fields: [
      T("contact.eyebrow", "Small label"),
      T("contact.title", "Heading", "title"),
      T("contact.text", "Paragraph", "textarea"),
      T("contact.submitLabel", "Send button label"),
      T("contact.successTitle", "Thank-you heading"),
      T("contact.successText", "Thank-you message", "textarea"),
    ],
  },
  {
    id: "detail",
    title: "Service, project & blog pages",
    fields: [
      T("detail.approachEyebrow", "Service/project — section label"),
      T("detail.approachTitle", "Service/project — section heading", "title"),
      T("detail.insightEyebrow", "Blog post — section label"),
      T("detail.insightTitle", "Blog post — section heading", "title"),
      T("detail.ctaLabel", "Button to the enquiry form"),
      T("detail.contactEyebrow", "Enquiry block — small label"),
      T("detail.contactTitle", "Enquiry block — heading", "title"),
    ],
  },
  {
    id: "seo",
    title: "Search engines",
    text: "Used when a page has no SEO title/description of its own (those are in Brand & settings → SEO).",
    fields: [
      T("seo.siteTitle", "Homepage browser-tab title"),
      T("seo.defaultDescription", "Default description", "textarea"),
    ],
  },
  {
    id: "categories",
    title: "Categories",
    text: "The choices offered when you add a service or project. Projects are grouped by category on the site.",
    fields: [
      T("categories.services", "Service categories", "list", { addLabel: "Add category" }),
      T("categories.projects", "Project categories", "list", { addLabel: "Add category" }),
    ],
  },
];
const getPath = (obj, path) =>
  path.split(".").reduce((o, k) => (o == null ? undefined : o[k]), obj);
const setPath = (obj, path, value) => {
  const [key, ...rest] = path.split(".");
  return {
    ...(obj || {}),
    [key]: rest.length ? setPath(obj?.[key], rest.join("."), value) : value,
  };
};
const move = (list, from, to) => {
  if (to < 0 || to >= list.length) return list;
  const next = [...list];
  next.splice(to, 0, next.splice(from, 1)[0]);
  return next;
};

function RowTools({ index, count, onMove, onRemove }) {
  return (
    <span className="row-tools">
      <button type="button" onClick={() => onMove(index - 1)} disabled={index === 0} aria-label="Move up">
        <ArrowUp size={13} />
      </button>
      <button type="button" onClick={() => onMove(index + 1)} disabled={index === count - 1} aria-label="Move down">
        <ArrowDown size={13} />
      </button>
      <button type="button" className="danger" onClick={onRemove} aria-label="Delete">
        <Trash2 size={13} />
      </button>
    </span>
  );
}

function ContentField({ field, value, onChange }) {
  if (field.type === "list") {
    const list = Array.isArray(value) ? value : [];
    return (
      <div className="content-field">
        <span className="field-label-static">{field.label}</span>
        {list.map((item, i) => (
          <div className="list-row" key={i}>
            <input
              value={item}
              onChange={(e) => onChange(list.map((x, j) => (j === i ? e.target.value : x)))}
            />
            <RowTools
              index={i}
              count={list.length}
              onMove={(to) => onChange(move(list, i, to))}
              onRemove={() => onChange(list.filter((_, j) => j !== i))}
            />
          </div>
        ))}
        <button type="button" className="add-row" onClick={() => onChange([...list, ""])}>
          <Plus size={14} /> {field.addLabel || "Add"}
        </button>
      </div>
    );
  }
  if (field.type === "items") {
    const list = Array.isArray(value) ? value : [];
    return (
      <div className="content-field">
        <span className="field-label-static">{field.label}</span>
        {list.map((item, i) => (
          <div className="item-row" key={i}>
            <span className="item-index">{String(i + 1).padStart(2, "0")}</span>
            <div className="item-fields">
              {field.itemFields.map((sub) => (
                <ContentField
                  key={sub.path}
                  field={sub}
                  value={item?.[sub.path]}
                  onChange={(v) => onChange(list.map((x, j) => (j === i ? { ...x, [sub.path]: v } : x)))}
                />
              ))}
            </div>
            <RowTools
              index={i}
              count={list.length}
              onMove={(to) => onChange(move(list, i, to))}
              onRemove={() => onChange(list.filter((_, j) => j !== i))}
            />
          </div>
        ))}
        {list.length < (field.max || 20) && (
          <button type="button" className="add-row" onClick={() => onChange([...list, {}])}>
            <Plus size={14} /> {field.addLabel || "Add"}
          </button>
        )}
      </div>
    );
  }
  const multiline = field.type === "title" || field.type === "textarea";
  return (
    <label className="content-field">
      {field.label}
      {multiline ? (
        <textarea
          rows={field.type === "title" ? 2 : 3}
          value={value || ""}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : (
        <input
          type="text"
          value={value || ""}
          placeholder={field.placeholder}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
      {field.type === "title" && (
        <small className="field-hint">
          Wrap words in *asterisks* for the italic accent; press Enter for a line break.
        </small>
      )}
      {field.type === "url" && (
        <small className="field-hint">A page on this site (e.g. /contact) or a full https:// link.</small>
      )}
    </label>
  );
}

function ContentPanel({ settings, onSave }) {
  const [form, setForm] = useState(() => settings.content || {});
  const [open, setOpen] = useState(CONTENT_SECTIONS[0].id);
  const [saving, setSaving] = useState(false);
  const dirty = JSON.stringify(form) !== JSON.stringify(settings.content || {});
  useEffect(() => {
    const warn = (e) => {
      if (!dirty) return;
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  const save = async () => {
    setSaving(true);
    try {
      const next = await onSave({ content: form });
      setForm(next.content || {});
    } catch {
      /* toast already shown */
    } finally {
      setSaving(false);
    }
  };
  const filled = (section) =>
    section.fields.filter((f) => has(getPath(form, f.path))).length;
  return (
    <section className="settings-panel content-panel">
      <div className="settings-intro">
        <span className="admin-kicker">WEBSITE CONTENT</span>
        <h2>Every word on your website, in one place.</h2>
        <p>
          Edit, reorder or clear anything below — a block with no content is
          hidden on the site. Changes go live as soon as you save.
        </p>
      </div>
      <div className="content-sections">
        {CONTENT_SECTIONS.map((section) => {
          const isOpen = open === section.id;
          return (
            <div className={`settings-card content-section ${isOpen ? "open" : ""}`} key={section.id}>
              <button
                type="button"
                className="content-section-toggle"
                onClick={() => setOpen(isOpen ? null : section.id)}
                aria-expanded={isOpen}
              >
                <span>
                  <b>{section.title}</b>
                  <small>
                    {filled(section)} of {section.fields.length} filled
                  </small>
                </span>
                <ChevronDown size={17} />
              </button>
              {isOpen && (
                <div className="content-section-body">
                  {section.text && <p className="field-hint">{section.text}</p>}
                  {section.fields.map((field) => (
                    <ContentField
                      key={field.path}
                      field={field}
                      value={getPath(form, field.path)}
                      onChange={(value) => setForm((f) => setPath(f, field.path, value))}
                    />
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div className="settings-actions sticky-actions">
        <span>
          {dirty ? (
            <>
              <CircleAlert size={15} /> Unsaved changes
            </>
          ) : (
            <>
              <Check size={15} /> All changes saved
            </>
          )}
        </span>
        <div className="toolbar-actions">
          <a className="button outline small" href="/" target="_blank" rel="noreferrer">
            <ExternalLink size={14} /> View site
          </a>
          <button className="button dark" onClick={save} disabled={saving || !dirty}>
            <Save size={16} /> {saving ? "Saving…" : "Save website content"}
          </button>
        </div>
      </div>
    </section>
  );
}

const REVIEW_DEFAULTS = {
  enabled: false,
  placeId: "",
  apiKey: "",
  reviewUrl: "",
  showOnHome: true,
  showOnContact: true,
  showOnCards: true,
  minRating: 4,
  maxReviews: 6,
  cacheMinutes: 30,
};
const timeAgo = (iso) => {
  if (!iso) return "";
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  return hours < 24 ? `${hours} h ago` : dateLabel(iso);
};

function GoogleReviewsSettings({ value, onChange, onSaveAndSync, notify }) {
  const g = { ...REVIEW_DEFAULTS, ...value };
  const set = (key, v) => onChange({ ...g, [key]: v });
  const [query, setQuery] = useState("");
  const [results, setResults] = useState(null);
  const [busy, setBusy] = useState("");
  const [status, setStatus] = useState(null);
  const hasKey = g.apiKey || g.apiKeySet || g.apiKeyFromEnv;
  const search = async () => {
    setBusy("search");
    try {
      const res = await api("/integrations/google-reviews/search", {
        method: "POST",
        body: JSON.stringify({ query, apiKey: g.apiKey }),
      });
      setResults(res.items);
    } catch (e) {
      notify(e.message, "error");
    } finally {
      setBusy("");
    }
  };
  const sync = async () => {
    setBusy("sync");
    try {
      await onSaveAndSync();
      const res = await api("/integrations/google-reviews/sync", {
        method: "POST",
      });
      setStatus({ ok: true, data: res });
      notify(`Synced ${res.reviews.length} reviews from Google`);
    } catch (e) {
      setStatus({ ok: false, error: e.message });
    } finally {
      setBusy("");
    }
  };
  return (
    <div className="settings-card settings-card-wide google-settings">
      <div className="panel-heading">
        <div>
          <span className="admin-kicker">GOOGLE REVIEWS</span>
          <h3>Show your live Google rating & reviews</h3>
        </div>
        <GoogleMark size={20} />
      </div>
      <label className="toggle-row">
        <input
          type="checkbox"
          checked={g.enabled}
          onChange={(e) => set("enabled", e.target.checked)}
        />
        <span>
          <b>Show Google reviews on the website</b>
          <small>
            Rating, review count and your latest reviews, refreshed
            automatically from Google.
          </small>
        </span>
      </label>
      <div className={`google-settings-grid ${g.enabled ? "" : "is-off"}`}>
        <div>
          <PasswordField
            label="Google Places API key"
            value={g.apiKey}
            onChange={(e) => set("apiKey", e.target.value)}
            placeholder={
              g.apiKeySet
                ? "•••••••• saved — leave blank to keep it"
                : g.apiKeyFromEnv
                  ? "Using GOOGLE_PLACES_API_KEY from the server .env"
                  : "AIza…"
            }
            autoComplete="off"
          />
          <small className="field-hint">
            Kept on the server only — never sent to visitors. Create one in
            Google Cloud Console with “Places API (New)” enabled.
            {g.apiKeySet && (
              <>
                {" "}
                <button
                  type="button"
                  className="inline-link"
                  onClick={() =>
                    onChange({ ...g, apiKey: "", apiKeySet: false, clearApiKey: true })
                  }
                >
                  Remove saved key
                </button>
              </>
            )}
          </small>
          <label>
            Find your business on Google
            <span className="search-inline">
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    if (hasKey && query.trim().length >= 3) search();
                  }
                }}
                placeholder="Business name and city"
              />
              <button
                type="button"
                className="button outline small"
                onClick={search}
                disabled={!hasKey || query.trim().length < 3 || busy === "search"}
              >
                <Search size={14} /> {busy === "search" ? "Searching…" : "Find"}
              </button>
            </span>
          </label>
          {results && (
            <div className="place-results">
              {results.length ? (
                results.map((p) => (
                  <button
                    type="button"
                    key={p.placeId}
                    className={p.placeId === g.placeId ? "selected" : ""}
                    onClick={() => set("placeId", p.placeId)}
                  >
                    <span>
                      <b>{p.name}</b>
                      <small>{p.address}</small>
                    </span>
                    {p.rating && (
                      <em>
                        {p.rating.toFixed(1)} ★ · {p.userRatingCount}
                      </em>
                    )}
                    {p.placeId === g.placeId && <Check size={15} />}
                  </button>
                ))
              ) : (
                <small className="field-hint">
                  No matches — try adding your city.
                </small>
              )}
            </div>
          )}
          <label>
            Place ID
            <input
              value={g.placeId}
              onChange={(e) => set("placeId", e.target.value.trim())}
              placeholder="ChIJ…  (filled in when you pick a result above)"
            />
          </label>
          <label>
            “Write a review” link (optional)
            <input
              value={g.reviewUrl}
              onChange={(e) => set("reviewUrl", e.target.value.trim())}
              placeholder="https://g.page/r/…/review — built from the Place ID if empty"
            />
          </label>
        </div>
        <div>
          <span className="field-label-static">Show reviews on</span>
          {[
            ["showOnHome", "Homepage"],
            ["showOnContact", "Contact Us page"],
            ["showOnCards", "Digital business cards"],
          ].map(([key, label]) => (
            <label className="toggle-row compact" key={key}>
              <input
                type="checkbox"
                checked={g[key] !== false}
                onChange={(e) => set(key, e.target.checked)}
              />
              <span>{label}</span>
            </label>
          ))}
          <div className="google-settings-selects">
            <label>
              Minimum rating shown
              <select
                value={g.minRating}
                onChange={(e) => set("minRating", Number(e.target.value))}
              >
                {[1, 2, 3, 4, 5].map((n) => (
                  <option key={n} value={n}>
                    {n === 1 ? "All reviews" : `${n}★ and up`}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Reviews shown
              <select
                value={g.maxReviews}
                onChange={(e) => set("maxReviews", Number(e.target.value))}
              >
                {[3, 4, 5, 6, 8, 10].map((n) => (
                  <option key={n} value={n}>
                    Up to {n}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Refresh from Google every
              <select
                value={g.cacheMinutes}
                onChange={(e) => set("cacheMinutes", Number(e.target.value))}
              >
                {[
                  [15, "15 minutes"],
                  [30, "30 minutes"],
                  [60, "hour"],
                  [180, "3 hours"],
                  [720, "12 hours"],
                ].map(([n, label]) => (
                  <option key={n} value={n}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <small className="field-hint">
            Google returns up to 5 of its “most relevant” reviews per place.
            Each refresh is one Places API call, so a longer interval keeps
            costs down — visitors always get the cached copy instantly.
          </small>
          <div className="google-sync">
            <button
              type="button"
              className="button dark small"
              onClick={sync}
              disabled={!g.enabled || busy === "sync"}
            >
              <RefreshCw size={14} className={busy === "sync" ? "spin" : ""} />
              {busy === "sync" ? "Syncing…" : "Save & sync now"}
            </button>
            {status?.ok && (
              <p className="sync-status ok">
                <Check size={14} /> Live · {status.data.rating?.toFixed(1)}★
                from {status.data.userRatingCount} reviews ·{" "}
                {status.data.reviews.length} shown · synced{" "}
                {timeAgo(status.data.fetchedAt)}
              </p>
            )}
            {status && !status.ok && (
              <p className="sync-status error">
                <CircleAlert size={14} /> {status.error}
              </p>
            )}
            {!g.enabled && (
              <small className="field-hint">
                Turn on “Show Google reviews” above to sync.
              </small>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// Homepage banner slides: upload several images and/or videos at once,
// reorder them, remove them. One item = a still banner (or looping video);
// two or more = the slider.
function HeroSlidesField({ slides, onChange }) {
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const add = async (e) => {
    const files = Array.from(e.target.files || []).slice(0, 12 - slides.length);
    e.target.value = "";
    if (!files.length) return;
    setBusy(true);
    setError("");
    let next = [...slides];
    for (let i = 0; i < files.length; i += 1) {
      const original = files[i];
      setStatus(`${files.length > 1 ? `${i + 1} of ${files.length} · ` : ""}${original.name}`);
      setProgress(2);
      try {
        const isVideo = original.type.startsWith("video/");
        const file = isVideo ? original : await compressImageFile(original);
        const result = await uploadWithProgress(file, setProgress);
        next = [
          ...next,
          { type: result.type?.startsWith("video") ? "video" : "image", url: result.url },
        ];
        onChange(next);
      } catch (err) {
        setError(`${original.name}: ${err.message}`);
      }
    }
    setBusy(false);
    setStatus("");
    setProgress(0);
  };
  return (
    <div className="asset-upload-field hero-slides-field">
      <span>Homepage banner — images & videos (optional)</span>
      <div className="slide-grid">
        {slides.map((slide, i) => (
          <div className="slide-thumb" key={`${slide.url}-${i}`}>
            {slide.type === "video" ? (
              <video src={slide.url} muted preload="metadata" />
            ) : (
              <img src={slide.url} alt="" />
            )}
            <span className="slide-badge">
              {i + 1} · {slide.type === "video" ? "Video" : "Image"}
            </span>
            <RowTools
              index={i}
              count={slides.length}
              onMove={(to) => onChange(move(slides, i, to))}
              onRemove={() => onChange(slides.filter((_, j) => j !== i))}
            />
          </div>
        ))}
        {slides.length < 12 && (
          <label className="slide-add">
            {busy ? (
              <small>Uploading… {progress}%</small>
            ) : (
              <>
                <Plus size={18} />
                <small>Add images or videos</small>
              </>
            )}
            <input
              hidden
              type="file"
              multiple
              accept="image/*,video/*"
              disabled={busy}
              onChange={add}
            />
          </label>
        )}
      </div>
      {busy && status && <small className="field-hint">{status}</small>}
      <small className="field-hint">
        One item shows as a still banner (a video loops). Two or more become a
        slider — images stay up for 6 seconds, videos play to the end. Use the
        arrows to change the order. Wide landscape media (about 1920×900)
        works best. Leave empty for the brand-colour artwork.
      </small>
      {error && <p className="form-error">{error}</p>}
    </div>
  );
}

function SettingsPanel({ settings, onSave, notify }) {
  // The banner is edited as a list of slides; older single-image / video /
  // carousel settings are shown as slides so they stay editable.
  const [form, setForm] = useState(() => ({
    ...settings,
    brand: {
      ...settings.brand,
      heroSlides: heroSlidesOf(settings.brand).map(({ type, url }) => ({ type, url })),
    },
  }));
  const [saving, setSaving] = useState(false);
  const update = (group, key, value) =>
    setForm({ ...form, [group]: { ...form[group], [key]: value } });
  const save = async () => {
    setSaving(true);
    try {
      const next = await onSave(form);
      setForm(next);
      return next;
    } finally {
      setSaving(false);
    }
  };
  const updateSeo = (page, key, value) =>
    setForm({
      ...form,
      seo: {
        ...form.seo,
        [page]: { ...(form.seo?.[page] || {}), [key]: value },
      },
    });
  return (
    <section className="settings-panel">
      <div className="settings-intro">
        <span className="admin-kicker">BRAND KIT</span>
        <h2>Make the experience unmistakably yours.</h2>
        <p>
          These settings flow through your public website. Keep the palette high
          contrast and the message clear.
        </p>
      </div>
      <div className="settings-grid">
        <div className="settings-card">
          <div className="panel-heading">
            <div>
              <span className="admin-kicker">IDENTITY</span>
              <h3>Brand voice & assets</h3>
            </div>
            <span
              className="color-swatch"
              style={{ background: form.brand.primary }}
            />
          </div>
          <label>
            Company name
            <input
              required
              value={form.companyName || ""}
              onChange={(e) => setForm({ ...form, companyName: e.target.value })}
            />
          </label>
          <label>
            Tagline
            <input
              value={form.tagline || ""}
              onChange={(e) => setForm({ ...form, tagline: e.target.value })}
            />
          </label>
          <label>
            Announcement bar
            <input
              value={form.announcement || ""}
              onChange={(e) =>
                setForm({ ...form, announcement: e.target.value })
              }
            />
          </label>
          <AssetUploadField
            label="Logo"
            hint="Shown in the header and (on a light card) anywhere the background is dark. Extra blank space around your logo is trimmed automatically so it always displays at full size."
            value={form.brand.logoUrl}
            onChange={(url) => update("brand", "logoUrl", url)}
            trim
          />
          <HeroSlidesField
            slides={form.brand.heroSlides || []}
            onChange={(heroSlides) =>
              // Slides replace the older single-banner fields entirely, so
              // nothing hidden can reappear behind them.
              setForm((f) => ({
                ...f,
                brand: { ...f.brand, heroSlides, heroUrl: "", heroVideo: "", heroImages: [] },
              }))
            }
          />
          <div className="color-grid">
            {[
              ["primary", "Primary"],
              ["secondary", "Dark"],
              ["accent", "Accent"],
              ["surface", "Surface"],
            ].map(([key, label]) => (
              <label key={key}>
                {label}
                <span className="color-input">
                  <input
                    type="color"
                    value={form.brand[key]}
                    onChange={(e) => update("brand", key, e.target.value)}
                  />
                  <code>{form.brand[key]}</code>
                </span>
              </label>
            ))}
          </div>
        </div>
        <div className="settings-card">
          <div className="panel-heading">
            <div>
              <span className="admin-kicker">CONTACT</span>
              <h3>Make it easy to reach you</h3>
            </div>
            <Mail size={18} />
          </div>
          {[
            ["email", "Email address"],
            ["secondaryEmail", "Secondary email address"],
            ["phone", "Phone number"],
            ["whatsapp", "WhatsApp number"],
            ["address", "Address"],
            ["hours", "Business hours"],
          ].map(([key, label]) => (
            <label key={key}>
              {label}
              <input
                value={form.contact?.[key] || ""}
                onChange={(e) => update("contact", key, e.target.value)}
              />
            </label>
          ))}
          <span className="field-label-static">Social links</span>
          {[
            ["instagram", "Instagram"],
            ["linkedin", "LinkedIn"],
            ["facebook", "Facebook"],
            ["youtube", "YouTube"],
          ].map(([key, label]) => (
            <label key={key}>
              {label}
              <input
                type="url"
                placeholder="https://…"
                value={form.social?.[key] || ""}
                onChange={(e) => update("social", key, e.target.value)}
              />
            </label>
          ))}
        </div>
        <div className="settings-card">
          <div className="panel-heading">
            <div>
              <span className="admin-kicker">ABOUT</span>
              <h3>Tell your story</h3>
            </div>
            <Building2 size={18} />
          </div>
          <label>
            Company overview
            <textarea
              rows={4}
              value={form.overview || ""}
              onChange={(e) => setForm({ ...form, overview: e.target.value })}
            />
          </label>
          <label>
            Vision
            <textarea
              rows={2}
              value={form.vision || ""}
              onChange={(e) => setForm({ ...form, vision: e.target.value })}
            />
          </label>
          <label>
            Mission
            <textarea
              rows={2}
              value={form.mission || ""}
              onChange={(e) => setForm({ ...form, mission: e.target.value })}
            />
          </label>
          <label>
            Values (comma-separated)
            <input
              value={(form.values || []).join(", ")}
              onChange={(e) =>
                setForm({
                  ...form,
                  values: e.target.value
                    .split(",")
                    .map((v) => v.trim())
                    .filter(Boolean),
                })
              }
            />
          </label>
        </div>
        <div className="settings-card">
          <div className="panel-heading">
            <div>
              <span className="admin-kicker">PAGE BANNERS</span>
              <h3>Header images for each page</h3>
            </div>
            <Image size={18} />
          </div>
          <p className="field-hint">
            The homepage banner is set above under Hero image / gallery. These
            are the banner photos shown at the top of the other pages — leave
            any of them empty to show a plain text header instead.
          </p>
          {[
            ["about", "About Us page"],
            ["services", "Services page"],
            ["projects", "Projects page"],
            ["blog", "Blog page"],
            ["contact", "Contact Us page"],
          ].map(([key, label]) => (
            <AssetUploadField
              key={key}
              label={label}
              value={form.pageBanners?.[key] || ""}
              onChange={(url) => update("pageBanners", key, url)}
            />
          ))}
        </div>
        <div className="settings-card">
          <div className="panel-heading">
            <div>
              <span className="admin-kicker">SEO</span>
              <h3>How each page appears in search & social</h3>
            </div>
            <Settings size={18} />
          </div>
          <p className="field-hint">
            Sets the page title and description search engines and social
            previews use. Leave a page blank to fall back to a sensible default.
          </p>
          {[
            ["home", "Homepage"],
            ["about", "About Us page"],
            ["services", "Services page"],
            ["projects", "Projects page"],
            ["blog", "Blog page"],
            ["contact", "Contact Us page"],
          ].map(([key, label]) => (
            <div className="seo-page-fields" key={key}>
              <label>
                {label} — SEO title
                <input
                  value={form.seo?.[key]?.title || ""}
                  onChange={(e) => updateSeo(key, "title", e.target.value)}
                  placeholder={key === "home" ? form.companyName : label}
                />
              </label>
              <label>
                {label} — SEO description
                <textarea
                  rows={2}
                  value={form.seo?.[key]?.description || ""}
                  onChange={(e) =>
                    updateSeo(key, "description", e.target.value)
                  }
                />
              </label>
            </div>
          ))}
        </div>
        <GoogleReviewsSettings
          value={form.googleReviews}
          onChange={(googleReviews) => setForm({ ...form, googleReviews })}
          onSaveAndSync={save}
          notify={notify}
        />
      </div>
      <div className="settings-actions">
        <span>
          <Check size={15} /> Changes go live on the website as soon as you
          save
        </span>
        <button
          className="button dark"
          onClick={() => save().catch(() => {})}
          disabled={saving}
        >
          <Save size={16} /> {saving ? "Saving…" : "Save brand settings"}
        </button>
      </div>
    </section>
  );
}
// --- Admin settings: password, email (SMTP), email templates, audit log --------
// Everyone gets "Change password"; email and the audit log decide where the
// site's mail goes and show who did what, so only owners see those tabs.
const dateTimeLabel = (value) =>
  value
    ? new Date(value).toLocaleString("en-IN", {
        day: "numeric",
        month: "short",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })
    : "—";
const ADMIN_TABS = [
  { id: "password", label: "Change password", icon: KeyRound },
  { id: "smtp", label: "Email (SMTP)", icon: Mail, ownerOnly: true },
  { id: "templates", label: "Email templates", icon: FileText, ownerOnly: true },
  { id: "audit", label: "Audit log", icon: ShieldCheck, ownerOnly: true },
];
function AdminSettingsPanel({ user, notify, onPasswordChanged }) {
  const isOwner = user.role === "super_admin";
  const tabs = ADMIN_TABS.filter((t) => !t.ownerOnly || isOwner);
  const [active, setActive] = useState(() => {
    try {
      const saved = sessionStorage.getItem("gp_admin_tab");
      return tabs.some((t) => t.id === saved) ? saved : "password";
    } catch {
      return "password";
    }
  });
  const choose = (id) => {
    setActive(id);
    try {
      sessionStorage.setItem("gp_admin_tab", id);
    } catch {
      /* storage unavailable */
    }
  };
  const [mailData, setMailData] = useState(null);
  const [loadError, setLoadError] = useState("");
  const load = () => {
    setLoadError("");
    api("/admin/mail")
      .then(setMailData)
      .catch((err) =>
        setLoadError(
          err.status === 404
            ? "The API server is running an older version that doesn't have email settings yet. Restart the backend (Ctrl+C, then npm run dev in backend/) and try again."
            : err.message,
        ),
      );
  };
  useEffect(() => {
    if (isOwner) load();
  }, [isOwner]);
  const needsMail = active === "smtp" || active === "templates";
  return (
    <section className="settings-panel admin-settings">
      <div className="settings-intro">
        <span className="admin-kicker">ADMIN SETTINGS</span>
        <h2>Security, email & activity.</h2>
        <p>
          Your password, the email server the site sends from, every email it
          sends, and a trail of who changed what.
        </p>
      </div>
      <div className="admin-tabs" role="tablist" aria-label="Admin settings">
        {tabs.map((t) => {
          const Icon = t.icon;
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={active === t.id}
              className={active === t.id ? "active" : ""}
              onClick={(e) => {
                choose(t.id);
                // On phones the tab strip scrolls — keep the chosen tab in view.
                e.currentTarget.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
              }}
            >
              <Icon size={15} /> {t.label}
            </button>
          );
        })}
      </div>
      {active === "password" ? (
        <ChangePasswordTab user={user} onPasswordChanged={onPasswordChanged} />
      ) : active === "audit" ? (
        <AuditLogTab />
      ) : needsMail && loadError ? (
        <ErrorState message={loadError} onRetry={load} />
      ) : needsMail && !mailData ? (
        <LoadingState label="Loading email settings" />
      ) : active === "smtp" ? (
        <SmtpTab
          mail={mailData.mail}
          user={user}
          notify={notify}
          onSaved={(mail) => setMailData((d) => ({ ...d, mail }))}
        />
      ) : (
        <EmailTemplatesTab
          templates={mailData.templates}
          mailActive={mailData.mail.activeSource !== "none"}
          user={user}
          notify={notify}
          onSaved={(template) =>
            setMailData((d) => ({
              ...d,
              templates: d.templates.map((t) => (t.kind === template.kind ? template : t)),
            }))
          }
          onSetUpMail={() => choose("smtp")}
        />
      )}
    </section>
  );
}

function ChangePasswordTab({ user, onPasswordChanged }) {
  const empty = { currentPassword: "", newPassword: "", confirmPassword: "" };
  const [form, setForm] = useState(empty);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const hint = passwordHint(form.newPassword, user.email);
  const set = (key) => (e) => {
    setDone(false);
    setForm({ ...form, [key]: e.target.value });
  };
  const submit = async (e) => {
    e.preventDefault();
    setError("");
    if (hint) return setError(hint);
    if (form.newPassword !== form.confirmPassword)
      return setError("New passwords don't match");
    if (form.newPassword === form.currentPassword)
      return setError("Choose a password different from your current one");
    setBusy(true);
    try {
      const result = await api("/me", {
        method: "PATCH",
        body: JSON.stringify({
          currentPassword: form.currentPassword,
          newPassword: form.newPassword,
        }),
      });
      setForm(empty);
      setDone(true);
      onPasswordChanged(result.user);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="settings-card admin-tab-card narrow" onSubmit={submit}>
      <div className="panel-heading">
        <div>
          <span className="admin-kicker">YOUR ACCOUNT</span>
          <h3>Change your password</h3>
        </div>
        <KeyRound size={18} />
      </div>
      <p className="field-hint">
        Signed in as <b>{user.email}</b>. Changing your password signs you out
        on every other device, and a confirmation email is sent to you.
        Forgot your current one? Sign out and use “Forgot password?”.
      </p>
      <PasswordField
        label="Current password"
        required
        value={form.currentPassword}
        onChange={set("currentPassword")}
        autoComplete="current-password"
      />
      <PasswordField
        label="New password"
        required
        value={form.newPassword}
        onChange={set("newPassword")}
        autoComplete="new-password"
      />
      <small className={`field-hint ${form.newPassword && !hint ? "ok" : ""}`}>
        {form.newPassword
          ? hint || "✓ Strong enough"
          : "At least 10 characters, with letters and numbers."}
      </small>
      <PasswordField
        label="Confirm new password"
        required
        value={form.confirmPassword}
        onChange={set("confirmPassword")}
        autoComplete="new-password"
      />
      {error && <p className="form-error">{error}</p>}
      {done && (
        <p className="form-notice">
          <Check size={14} /> Password changed. Other devices were signed out.
        </p>
      )}
      <div className="admin-tab-actions">
        <button className="button dark" type="submit" disabled={busy}>
          <Save size={16} /> {busy ? "Saving…" : "Change password"}
        </button>
      </div>
    </form>
  );
}

const SMTP_PRESETS = [["Gmail", "smtp.gmail.com", 465, true]];
function SmtpTab({ mail, user, notify, onSaved }) {
  const fromMail = (m) => ({ ...m, pass: "", clearPass: false });
  const [form, setForm] = useState(() => fromMail(mail));
  const [testTo, setTestTo] = useState(user.email);
  const [busy, setBusy] = useState("");
  const [result, setResult] = useState(null);
  const [errors, setErrors] = useState({});
  const set = (key, value) => {
    setResult(null);
    setErrors((e) => ({ ...e, [key]: "" }));
    setForm((f) => ({ ...f, [key]: value }));
  };
  const dirty =
    form.pass ||
    form.clearPass ||
    ["host", "port", "secure", "user", "fromEmail", "fromName", "notifyTo"].some(
      (k) => String(form[k] ?? "") !== String(mail[k] ?? ""),
    );
  const validate = () => {
    const next = {};
    const email = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (form.host) {
      if (!/^[a-z0-9.-]+$/i.test(form.host)) next.host = "Looks like smtp.example.com";
      if (!form.user) next.user = "Required with a host";
      if (!form.pass && !mail.passSet) next.pass = "Required with a host";
    }
    if (!(Number(form.port) > 0 && Number(form.port) < 65536)) next.port = "1 – 65535";
    if (form.fromEmail && !email.test(form.fromEmail)) next.fromEmail = "Not a valid email";
    if (form.notifyTo && !form.notifyTo.split(",").every((x) => email.test(x.trim())))
      next.notifyTo = "Valid emails, separated by commas";
    setErrors(next);
    return !Object.keys(next).length;
  };
  const save = async (e) => {
    e?.preventDefault();
    if (!validate()) return;
    setBusy("save");
    setResult(null);
    try {
      const data = await api("/admin/mail", { method: "PUT", body: JSON.stringify(form) });
      onSaved(data.mail);
      setForm(fromMail(data.mail));
      notify("Email settings saved");
    } catch (err) {
      setResult({ ok: false, text: err.message });
    } finally {
      setBusy("");
    }
  };
  const test = async () => {
    if (!validate()) return;
    setBusy("test");
    setResult(null);
    try {
      const data = await api("/admin/mail/test", {
        method: "POST",
        body: JSON.stringify({ ...form, to: testTo }),
      });
      setResult({ ok: true, text: data.message });
    } catch (err) {
      setResult({ ok: false, text: err.message });
    } finally {
      setBusy("");
    }
  };
  const status = {
    admin: ["ok", `Sending through ${mail.host} as ${mail.user}.`],
    env: ["muted", `Using the server's .env settings (${mail.env?.host}, ${mail.env?.user}). Save settings here to manage email from the admin instead.`],
    outbox: ["muted", "Development mode — emails are saved to MAIL_OUTBOX_DIR instead of being sent."],
    none: ["warn", "Email isn't set up — password reset, welcome and enquiry emails can't be sent yet."],
  }[mail.activeSource];
  const field = (key, label, props = {}) => (
    <label className={errors[key] ? "has-error" : ""}>
      {label}
      <input
        value={form[key] ?? ""}
        onChange={(e) => set(key, e.target.value)}
        aria-invalid={Boolean(errors[key])}
        {...props}
      />
      {errors[key] && <small className="field-error">{errors[key]}</small>}
    </label>
  );
  return (
    <form className="settings-card admin-tab-card" onSubmit={save} noValidate>
      <div className="panel-heading">
        <div>
          <span className="admin-kicker">OUTGOING EMAIL</span>
          <h3>Email (SMTP)</h3>
          <p className="panel-sub">Used for password reset emails and website enquiry notifications.</p>
        </div>
        <Mail size={18} />
      </div>
      <p className={`smtp-status is-${status[0]}`}>
        {status[0] === "warn" ? <CircleAlert size={14} /> : <MailCheck size={14} />}
        {status[1]}
      </p>
      <div className="smtp-presets" aria-label="Quick setup">
        <span>Quick setup:</span>
        {SMTP_PRESETS.map(([label, host, port, secure]) => (
          <button
            key={host}
            type="button"
            className={form.host === host ? "active" : ""}
            onClick={() => {
              setForm((f) => ({ ...f, host, port, secure }));
              setErrors({});
            }}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="admin-form-grid">
        {field("host", "SMTP host", { placeholder: "smtp.gmail.com", autoCapitalize: "off", spellCheck: false })}
        <label className={errors.port ? "has-error" : ""}>
          Port
          <input
            type="number"
            inputMode="numeric"
            min="1"
            max="65535"
            value={form.port}
            onChange={(e) => {
              const port = e.target.value === "" ? "" : Number(e.target.value);
              // 465 is SSL from the start; 587/25 upgrade with STARTTLS.
              set("port", port);
              if (port === 465) set("secure", true);
              if (port === 587 || port === 25) set("secure", false);
            }}
          />
          {errors.port && <small className="field-error">{errors.port}</small>}
        </label>
        {field("user", "SMTP username", { placeholder: "you@gmail.com", autoComplete: "off", autoCapitalize: "off", spellCheck: false })}
        <div className={errors.pass ? "has-error" : ""}>
          <PasswordField
            label={mail.passSet && !form.clearPass ? "SMTP password (saved — leave blank to keep)" : "SMTP password"}
            value={form.pass}
            onChange={(e) => set("pass", e.target.value)}
            autoComplete="new-password"
            placeholder={mail.passSet && !form.clearPass ? "•••••••••" : "App password"}
          />
          {errors.pass && <small className="field-error">{errors.pass}</small>}
        </div>
        {field("fromName", "From name", { placeholder: "Gagnant Promoters" })}
        {field("fromEmail", "From email", { type: "email", placeholder: form.user || "no-reply@yourdomain.com" })}
        <label className="toggle-row admin-form-wide">
          <input
            type="checkbox"
            checked={Boolean(form.secure)}
            onChange={(e) => set("secure", e.target.checked)}
          />
          <span>
            <b>Use TLS/SSL</b>
            <small>Secure connection from the start — typically on for port 465, off for 587 (which upgrades with STARTTLS).</small>
          </span>
        </label>
        {field("notifyTo", "Send enquiry notifications to", {
          placeholder: mail.contactEmail || "team@yourdomain.com",
          className: "admin-form-wide",
        })}
      </div>
      <p className="field-hint">
        <b>Gmail:</b> turn on 2-Step Verification, then create an App password
        (Google Account → Security → App passwords) and paste it above — your
        normal Gmail password won't work. Leave the host empty and save to use
        the server's .env settings.
      </p>
      {result && (
        <p className={result.ok ? "form-notice" : "form-error"} role="status">
          {result.ok ? <Check size={14} /> : <CircleAlert size={14} />} {result.text}
        </p>
      )}
      <div className="admin-tab-actions split">
        <div className="test-send">
          <input
            type="email"
            value={testTo}
            onChange={(e) => setTestTo(e.target.value)}
            aria-label="Send the test email to"
            placeholder="Send a test to…"
          />
          <button type="button" className="button outline" disabled={Boolean(busy)} onClick={test}>
            <Send size={15} /> {busy === "test" ? "Testing…" : "Send test"}
          </button>
        </div>
        <div className="action-group">
          {mail.passSet && (
            <button
              type="button"
              className="button outline danger"
              onClick={() => {
                if (!confirm("Remove the saved SMTP settings? The site will fall back to the server's .env settings (if any)."))
                  return;
                setForm({ ...form, host: "", user: "", pass: "", clearPass: true });
              }}
            >
              <Trash2 size={15} /> Clear
            </button>
          )}
          <button type="submit" className="button dark" disabled={Boolean(busy) || !dirty}>
            <Save size={16} /> {busy === "save" ? "Saving…" : "Save email settings"}
          </button>
        </div>
      </div>
    </form>
  );
}

const TEMPLATE_TEXT_FIELDS = ["subject", "eyebrow", "body", "buttonLabel"];
function EmailTemplatesTab({ templates, mailActive, user, notify, onSaved, onSetUpMail }) {
  const [view, setView] = useState("templates");
  return (
    <div className="settings-card admin-tab-card">
      <div className="panel-heading">
        <div>
          <span className="admin-kicker">EVERY EMAIL THE SITE SENDS</span>
          <h3>Email templates</h3>
          <p className="panel-sub">Edit the wording, switch emails off, preview and test them, and see what was sent.</p>
        </div>
        <FileText size={18} />
      </div>
      {!mailActive && (
        <p className="smtp-status is-warn">
          <CircleAlert size={14} />
          <span>
            Email isn't set up yet, so none of these can be sent.{" "}
            <button type="button" className="inline-link" onClick={onSetUpMail}>
              Set up email (SMTP)
            </button>
          </span>
        </p>
      )}
      <div className="sub-tabs" role="tablist">
        {[
          ["templates", "Templates"],
          ["log", "Email log"],
        ].map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={view === id}
            className={view === id ? "active" : ""}
            onClick={() => setView(id)}
          >
            {label}
          </button>
        ))}
      </div>
      {view === "templates" ? (
        <TemplateEditor
          templates={templates}
          mailActive={mailActive}
          user={user}
          notify={notify}
          onSaved={onSaved}
        />
      ) : (
        <EmailLog />
      )}
    </div>
  );
}

function TemplateEditor({ templates, mailActive, user, notify, onSaved }) {
  const [kind, setKind] = useState(templates[0].kind);
  const template = templates.find((t) => t.kind === kind);
  const [draft, setDraft] = useState(template.current);
  const [preview, setPreview] = useState(null);
  const [previewError, setPreviewError] = useState("");
  const [testTo, setTestTo] = useState(user.email);
  const [busy, setBusy] = useState("");
  const bodyRef = useRef(null);
  const lastFocused = useRef("body");
  const fieldRefs = useRef({});
  const dirty = ["enabled", ...TEMPLATE_TEXT_FIELDS].some(
    (f) => String(draft[f] ?? "") !== String(template.current[f] ?? ""),
  );
  const pick = (next) => {
    if (next === kind) return;
    if (dirty && !confirm("You have unsaved changes to this email. Discard them?")) return;
    setKind(next);
    setDraft(templates.find((t) => t.kind === next).current);
    setPreview(null);
  };
  const set = (field, value) => setDraft((d) => ({ ...d, [field]: value }));
  // Live preview, debounced so typing doesn't fire a request per key.
  useEffect(() => {
    const timer = setTimeout(() => {
      api(`/admin/email-templates/${kind}/preview`, {
        method: "POST",
        body: JSON.stringify({ template: draft }),
      })
        .then((p) => {
          setPreview(p);
          setPreviewError("");
        })
        .catch((err) => setPreviewError(err.message));
    }, 300);
    return () => clearTimeout(timer);
  }, [kind, draft.subject, draft.eyebrow, draft.body, draft.buttonLabel]);
  // Inserts at the cursor of whichever text field was used last.
  const insertPlaceholder = (name) => {
    const field = lastFocused.current;
    const el = fieldRefs.current[field];
    const token = `{{${name}}}`;
    const value = String(draft[field] || "");
    const start = el?.selectionStart ?? value.length;
    const end = el?.selectionEnd ?? value.length;
    set(field, value.slice(0, start) + token + value.slice(end));
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(start + token.length, start + token.length);
    });
  };
  const bind = (field) => ({
    ref: (el) => {
      fieldRefs.current[field] = el;
      if (field === "body") bodyRef.current = el;
    },
    value: draft[field] || "",
    onChange: (e) => set(field, e.target.value),
    onFocus: () => {
      lastFocused.current = field;
    },
  });
  // The On/Off switch saves only on/off (with the saved wording), leaving any
  // unsaved text edits in the form untouched.
  const save = async (patch = {}) => {
    const toggling = "enabled" in patch;
    const next = toggling ? { ...template.current, ...patch } : draft;
    if (!next.subject.trim()) return notify("The subject can't be empty", "error");
    if (!next.body.trim()) return notify("The message can't be empty", "error");
    setBusy("save");
    try {
      const data = await api(`/admin/email-templates/${kind}`, {
        method: "PUT",
        body: JSON.stringify(next),
      });
      onSaved(data.template);
      setDraft(toggling ? (d) => ({ ...d, enabled: data.template.current.enabled }) : data.template.current);
      notify(
        "enabled" in patch
          ? `“${template.label}” is now ${patch.enabled ? "on" : "off"}`
          : `“${template.label}” saved`,
      );
    } catch (err) {
      notify(err.message, "error");
    } finally {
      setBusy("");
    }
  };
  const restore = async () => {
    if (!confirm(`Restore the default wording for “${template.label}”? Your edits to it will be lost.`)) return;
    setBusy("restore");
    try {
      const data = await api(`/admin/email-templates/${kind}`, { method: "DELETE" });
      onSaved(data.template);
      setDraft(data.template.current);
      notify("Default wording restored");
    } catch (err) {
      notify(err.message, "error");
    } finally {
      setBusy("");
    }
  };
  const sendTest = async () => {
    setBusy("test");
    try {
      const data = await api(`/admin/email-templates/${kind}/preview`, {
        method: "POST",
        body: JSON.stringify({ template: draft, send: true, to: testTo }),
      });
      notify(data.message);
    } catch (err) {
      notify(err.message, "error");
    } finally {
      setBusy("");
    }
  };
  const groups = templates.reduce((acc, t) => {
    (acc[t.group] ||= []).push(t);
    return acc;
  }, {});
  return (
    <div className="template-layout">
      <nav className="template-list" aria-label="Email templates">
        {Object.entries(groups).map(([group, items]) => (
          <div key={group} className="template-group">
            <span className="template-group-label">{group}</span>
            {items.map((t) => (
              <button
                key={t.kind}
                type="button"
                className={t.kind === kind ? "active" : ""}
                onClick={() => pick(t.kind)}
              >
                <span>{t.label}</span>
                <i className={t.current.enabled ? "on" : "off"}>
                  {t.current.enabled ? "On" : "Off"}
                </i>
              </button>
            ))}
          </div>
        ))}
      </nav>
      <div className="template-main">
        <div className="template-head">
          <div>
            <h4>{template.label}</h4>
            <p>{template.description}</p>
            <p className="template-recipient">
              <b>Sent to:</b> {template.recipient}
            </p>
          </div>
          <label className="switch" title={draft.enabled ? "This email is sent" : "This email is not sent"}>
            <input
              type="checkbox"
              checked={Boolean(draft.enabled)}
              disabled={busy === "save"}
              onChange={(e) => save({ enabled: e.target.checked })}
            />
            <span className="switch-track" aria-hidden="true" />
            <b>{draft.enabled ? "On" : "Off"}</b>
          </label>
        </div>
        {!draft.enabled && (
          <p className="smtp-status is-muted">
            <Ban size={14} />
            {kind === "forgotPassword"
              ? "Off — “Forgot password?” will tell people to ask an owner instead."
              : ["welcome", "passwordReset"].includes(kind)
                ? "Off — the temporary password is shown to the owner on screen instead."
                : "Off — this email isn't sent."}
          </p>
        )}
        <div className="template-editor">
          <div className="template-fields">
            <label>
              Subject
              <input {...bind("subject")} />
            </label>
            <label>
              Small heading <span className="optional">(optional)</span>
              <input {...bind("eyebrow")} />
            </label>
            <label>
              Message
              <textarea rows={10} {...bind("body")} />
            </label>
            <small className="field-hint">
              A blank line starts a new paragraph; a line starting with “- ”
              becomes a bullet.
              {template.extras === "credentials" &&
                " The email and temporary password are added below the message."}
              {template.extras === "details" &&
                " The enquiry details (name, email, phone, message) are added below the message."}
            </small>
            {template.hasButton && (
              <label>
                Button text
                <input {...bind("buttonLabel")} />
              </label>
            )}
            <span className="field-label-static">Placeholders — click to insert</span>
            <div className="placeholder-chips">
              {template.placeholders.map((p) => (
                <button key={p} type="button" onClick={() => insertPlaceholder(p)}>
                  {`{{${p}}}`}
                </button>
              ))}
            </div>
            <div className="template-actions">
              <button
                type="button"
                className="button dark"
                disabled={Boolean(busy) || !dirty}
                onClick={() => save()}
              >
                <Save size={16} /> {busy === "save" ? "Saving…" : dirty ? "Save" : "Saved"}
              </button>
              {template.customised && (
                <button type="button" className="button outline" disabled={Boolean(busy)} onClick={restore}>
                  <RefreshCw size={15} /> Restore default
                </button>
              )}
            </div>
            <div className="test-send">
              <input
                type="email"
                value={testTo}
                onChange={(e) => setTestTo(e.target.value)}
                placeholder="Send a test to…"
                aria-label="Send a test to"
              />
              <button
                type="button"
                className="button outline"
                disabled={Boolean(busy) || !mailActive}
                onClick={sendTest}
                title={mailActive ? "" : "Set up email (SMTP) first"}
              >
                <Send size={15} /> {busy === "test" ? "Sending…" : "Send test"}
              </button>
            </div>
            <small className="field-hint">Uses sample data and the text above, saved or not.</small>
          </div>
          <div className="template-preview">
            <span className="field-label-static">Preview with sample data</span>
            {preview && (
              <p className="preview-subject">
                <b>Subject:</b> {preview.subject}
              </p>
            )}
            {previewError ? (
              <p className="form-error">{previewError}</p>
            ) : preview ? (
              <iframe title="Email preview" sandbox="" srcDoc={preview.html} />
            ) : (
              <LoadingState label="Rendering preview" />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// Shared by the email log and audit log: debounced search + paging.
function usePagedLog(path, filters) {
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const key = JSON.stringify(filters);
  useEffect(() => setPage(1), [key]);
  const load = () => {
    setLoading(true);
    const params = new URLSearchParams(
      Object.entries({ ...filters, page }).filter(([, v]) => v !== "" && v != null),
    );
    api(`${path}?${params}`)
      .then((d) => {
        setData(d);
        setError("");
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  };
  useEffect(() => {
    const timer = setTimeout(load, filters.q ? 300 : 0);
    return () => clearTimeout(timer);
  }, [key, page]);
  return { data, error, loading, page, setPage, reload: load };
}
function Pager({ page, pages, total, onPage, noun }) {
  return (
    <div className="log-pager">
      <span>
        {total} {total === 1 ? noun[0] : noun[1]}
      </span>
      <div>
        <button type="button" disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Previous page">
          <ChevronLeft size={15} />
        </button>
        <span>
          Page {page} of {pages}
        </span>
        <button type="button" disabled={page >= pages} onClick={() => onPage(page + 1)} aria-label="Next page">
          <ChevronRight size={15} />
        </button>
      </div>
    </div>
  );
}
const EMAIL_REASONS = {
  "turned-off": "Template switched off",
  "smtp-not-configured": "Email (SMTP) not set up",
  "no-recipient": "No recipient address",
  "send-failed": "Mail server refused it",
};
function EmailLog() {
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const { data, error, loading, page, setPage, reload } = usePagedLog("/admin/email-log", { q, status, limit: 20 });
  return (
    <div className="log-panel">
      <div className="log-filters">
        <span className="search-input">
          <Search size={14} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search recipient, subject…" />
        </span>
        <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
          <option value="">All statuses</option>
          <option value="sent">Sent</option>
          <option value="failed">Failed</option>
          <option value="skipped">Not sent</option>
        </select>
        <button type="button" className="icon-button" onClick={reload} aria-label="Refresh" title="Refresh">
          <RefreshCw size={15} className={loading ? "spin" : ""} />
        </button>
      </div>
      {error ? (
        <ErrorState message={error} onRetry={reload} />
      ) : !data ? (
        <LoadingState label="Loading email log" />
      ) : !data.items.length ? (
        <Empty title="No emails yet" text={q || status ? "Nothing matches these filters." : "Emails the site sends will be listed here."} />
      ) : (
        <>
          <div className="log-table">
            <div className="log-row log-head">
              <span>When</span>
              <span>Email</span>
              <span>To</span>
              <span>Status</span>
            </div>
            {data.items.map((e) => (
              <div className="log-row" key={e.id}>
                <span className="log-when" title={dateTimeLabel(e.at)}>
                  {timeAgo(e.at)}
                </span>
                <span className="log-main">
                  <b>{e.subject || e.templateLabel}</b>
                  <small>
                    {e.templateLabel}
                    {e.test && " · test"}
                  </small>
                </span>
                <span className="log-to">{e.to || "—"}</span>
                <span>
                  <i className={`log-status is-${e.status}`}>
                    {e.status === "skipped" ? "Not sent" : e.status === "sent" ? "Sent" : "Failed"}
                  </i>
                  {(e.error || e.reason) && e.status !== "sent" && (
                    <small className="log-reason">{e.error || EMAIL_REASONS[e.reason] || e.reason}</small>
                  )}
                </span>
              </div>
            ))}
          </div>
          <Pager page={page} pages={data.pages} total={data.total} onPage={setPage} noun={["email", "emails"]} />
        </>
      )}
    </div>
  );
}

const AUDIT_FILTERS = [
  ["", "All"],
  ["security", "Sign-ins & security"],
  ["users", "Users"],
  ["content", "Content"],
  ["settings", "Settings"],
  ["leads", "Leads"],
  ["email", "Emails"],
];
const AUDIT_ACTIONS = {
  login: "Signed in",
  login_failed: "Failed sign-in",
  login_blocked: "Sign-in blocked",
  account_locked: "Account locked",
  logout_all: "Signed out everywhere",
  password_changed: "Changed password",
  password_change_failed: "Wrong current password",
  password_reset_requested: "Requested a password reset",
  password_reset_completed: "Reset password via email link",
  smtp_settings_changed: "Changed email (SMTP) settings",
  user_created: "Added a user",
  user_updated: "Updated a user",
  user_disabled: "Disabled a user",
  user_enabled: "Re-enabled a user",
  user_deleted: "Deleted a user",
  user_password_reset: "Reset a user's password",
  lead_received: "New enquiry received",
  email_sent: "Email sent",
  email_failed: "Email failed",
  email_skipped: "Email not sent",
  email_template_enabled: "Switched an email on",
  email_template_disabled: "Switched an email off",
  email_template_reset: "Restored an email's default wording",
  create: "Created",
  update: "Updated",
  delete: "Deleted",
  upload: "Uploaded",
};
const RESOURCE_LABELS = {
  services: "service",
  projects: "project",
  blogs: "blog post",
  testimonials: "testimonial",
  clients: "client",
  cards: "business card",
  media: "file",
  leads: "lead",
  settings: "brand & settings",
  "email-templates": "email template",
  profile: "profile",
  tenant: "workspace",
};
const auditTone = (action) =>
  /failed|blocked|locked|deleted|delete|disabled/.test(action) ? "bad" : /login$|created|create|enabled|sent|completed|received/.test(action) ? "good" : "neutral";
function auditTitle(e) {
  const base = AUDIT_ACTIONS[e.action] || e.action.replace(/_/g, " ");
  if (["create", "update", "delete", "upload"].includes(e.action)) {
    return `${base} ${RESOURCE_LABELS[e.resource] || e.resource}${e.subject ? ` “${e.subject}”` : ""}`;
  }
  if (e.resource === "email-templates" && e.subject) return `${base} — ${e.subject}`;
  return base;
}
function browserOf(ua = "") {
  if (!ua) return "";
  const browser = /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "Browser";
  const os = /Windows/.test(ua) ? "Windows" : /Android/.test(ua) ? "Android" : /iPhone|iPad/.test(ua) ? "iOS" : /Mac OS/.test(ua) ? "macOS" : /Linux/.test(ua) ? "Linux" : "";
  return os ? `${browser} on ${os}` : browser;
}
function AuditLogTab() {
  const [filters, setFilters] = useState({ category: "", q: "", userId: "", from: "", to: "" });
  const [open, setOpen] = useState(null);
  const [exporting, setExporting] = useState(false);
  const { data, error, loading, page, setPage, reload } = usePagedLog("/audit", { ...filters, limit: 25 });
  const set = (key, value) => setFilters((f) => ({ ...f, [key]: value }));
  const exportCsv = async () => {
    setExporting(true);
    try {
      const params = new URLSearchParams(Object.entries({ ...filters, limit: 1000 }).filter(([, v]) => v !== ""));
      const { items } = await api(`/audit?${params}`);
      const cell = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
      const rows = [
        ["When", "Who", "Action", "Details", "Changes", "IP", "Browser"],
        ...items.map((e) => [
          new Date(e.at).toISOString(),
          e.user ? `${e.user.name} <${e.user.email}>` : "System / visitor",
          auditTitle(e),
          e.detail,
          e.changes.map((c) => `${c.field}: ${c.from ?? "…"} → ${c.to ?? "…"}`).join("; "),
          e.ip,
          browserOf(e.userAgent),
        ]),
      ];
      const blob = new Blob([`﻿${rows.map((r) => r.map(cell).join(",")).join("\r\n")}`], { type: "text/csv;charset=utf-8" });
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = `audit-log-${new Date().toISOString().slice(0, 10)}.csv`;
      link.click();
      URL.revokeObjectURL(link.href);
    } catch {
      /* the table shows load errors */
    } finally {
      setExporting(false);
    }
  };
  return (
    <div className="settings-card admin-tab-card">
      <div className="panel-heading">
        <div>
          <span className="admin-kicker">ACTIVITY</span>
          <h3>Audit log</h3>
          <p className="panel-sub">A trail of security- and business-sensitive actions across the app.</p>
        </div>
        <button type="button" className="button outline small" onClick={exportCsv} disabled={exporting || !data?.total}>
          <Download size={15} /> {exporting ? "Exporting…" : "Export CSV"}
        </button>
      </div>
      <div className="audit-chips" role="tablist">
        {AUDIT_FILTERS.map(([id, label]) => (
          <button
            key={id || "all"}
            type="button"
            className={filters.category === id ? "active" : ""}
            onClick={() => set("category", id)}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="log-filters">
        <span className="search-input">
          <Search size={14} />
          <input value={filters.q} onChange={(e) => set("q", e.target.value)} placeholder="Search action, item, IP…" />
        </span>
        <select value={filters.userId} onChange={(e) => set("userId", e.target.value)} aria-label="User">
          <option value="">Everyone</option>
          {(data?.users || []).map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </select>
        <label className="date-filter">
          From
          <input type="date" value={filters.from} max={filters.to || undefined} onChange={(e) => set("from", e.target.value)} />
        </label>
        <label className="date-filter">
          To
          <input type="date" value={filters.to} min={filters.from || undefined} onChange={(e) => set("to", e.target.value)} />
        </label>
        <button type="button" className="icon-button" onClick={reload} aria-label="Refresh" title="Refresh">
          <RefreshCw size={15} className={loading ? "spin" : ""} />
        </button>
      </div>
      {error ? (
        <ErrorState message={error} onRetry={reload} />
      ) : !data ? (
        <LoadingState label="Loading audit log" />
      ) : !data.items.length ? (
        <Empty title="Nothing here yet" text="No activity matches these filters." />
      ) : (
        <>
          <ul className="audit-list">
            {data.items.map((e) => {
              const expandable = e.changes.length || e.ip || e.userAgent;
              return (
                <li key={e.id} className={`audit-item tone-${auditTone(e.action)} ${open === e.id ? "open" : ""}`}>
                  <button
                    type="button"
                    className="audit-summary"
                    onClick={() => expandable && setOpen(open === e.id ? null : e.id)}
                    aria-expanded={open === e.id}
                  >
                    <i className="audit-dot" />
                    <span className="audit-text">
                      <b>{auditTitle(e)}</b>
                      <small>
                        {e.user ? e.user.name || e.user.email : e.resource === "email" || e.action === "lead_received" ? "Website" : "Visitor"}
                        {e.detail && ` · ${e.detail}`}
                      </small>
                    </span>
                    <span className="audit-when" title={dateTimeLabel(e.at)}>
                      {timeAgo(e.at)}
                    </span>
                    {expandable ? <ChevronDown size={15} className="audit-caret" /> : <span />}
                  </button>
                  {open === e.id && (
                    <div className="audit-details">
                      <dl>
                        <dt>When</dt>
                        <dd>{dateTimeLabel(e.at)}</dd>
                        {e.user && (
                          <>
                            <dt>Who</dt>
                            <dd>
                              {e.user.name} {e.user.email && `(${e.user.email})`}
                            </dd>
                          </>
                        )}
                        {e.ip && (
                          <>
                            <dt>IP address</dt>
                            <dd>{e.ip}</dd>
                          </>
                        )}
                        {e.userAgent && (
                          <>
                            <dt>Browser</dt>
                            <dd title={e.userAgent}>{browserOf(e.userAgent)}</dd>
                          </>
                        )}
                      </dl>
                      {e.changes.length > 0 && (
                        <table className="audit-changes">
                          <thead>
                            <tr>
                              <th>Field</th>
                              <th>Before</th>
                              <th>After</th>
                            </tr>
                          </thead>
                          <tbody>
                            {e.changes.map((c) => (
                              <tr key={c.field}>
                                <td>{c.field}</td>
                                <td>{c.from ?? <em>changed</em>}</td>
                                <td>{c.to ?? <em>changed</em>}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
          <Pager page={page} pages={data.pages} total={data.total} onPage={setPage} noun={["entry", "entries"]} />
        </>
      )}
    </div>
  );
}

const cardRoute = location.pathname.match(/^\/card\/([^/]+)\/?$/);
createRoot(document.getElementById("root")).render(
  /^\/admin\/reset-password\/?$/.test(location.pathname) ? (
    <ResetPasswordPage />
  ) : location.pathname.startsWith("/admin") ? (
    <AdminApp />
  ) : cardRoute ? (
    <BusinessCardPage slug={decodeURIComponent(cardRoute[1])} />
  ) : (
    <PublicSite />
  ),
);
