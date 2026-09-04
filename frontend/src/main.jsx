import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  ArrowUpRight,
  Building2,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Clock,
  Eye,
  EyeOff,
  ExternalLink,
  Facebook,
  FileText,
  FolderKanban,
  Image,
  Instagram,
  LayoutDashboard,
  Linkedin,
  LogOut,
  Mail,
  MapPin,
  Menu,
  Pencil,
  Phone,
  Play,
  Plus,
  Save,
  Settings,
  Trash2,
  Users,
  X,
} from "lucide-react";
import "./styles.css";

const API = import.meta.env.VITE_API_URL || "/api";
const api = async (path, options = {}) => {
  const token = localStorage.getItem("gp_token");
  const headers = {
    ...(options.body instanceof FormData
      ? {}
      : { "Content-Type": "application/json" }),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(options.headers || {}),
  };
  const response = await fetch(`${API}${path}`, { ...options, headers });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Something went wrong");
  return data;
};
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
    const token = localStorage.getItem("gp_token");
    xhr.open("POST", `${API}/media`);
    if (token) xhr.setRequestHeader("Authorization", `Bearer ${token}`);
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

const siteVars = (b) => ({
  "--primary": b.primary,
  "--secondary": b.secondary,
  "--accent": b.accent,
  "--surface": b.surface,
  "--ink": b.text,
  "--muted": b.muted,
  "--radius": b.radius,
});
const NAV_LINKS = [
  ["Home", "/"],
  ["About Us", "/about"],
  ["Services", "/services"],
  ["Projects", "/projects"],
  ["Blog", "/blog"],
  ["Contact Us", "/contact"],
];

function SiteHeader({ settings }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const b = settings.brand;
  const path = location.pathname;
  return (
    <header className="site-header">
      <a className="wordmark" href="/">
        {b.logoUrl ? (
          <img className="logo-image" src={b.logoUrl} alt="Gagnant Promoters" />
        ) : (
          <>
            <span className="mark">G</span>
            <span>
              GAGNANT<small>PROMOTERS</small>
            </span>
          </>
        )}
      </a>
      <nav className={menuOpen ? "open" : ""}>
        {NAV_LINKS.map(([label, href]) => (
          <a
            key={label}
            href={href}
            className={path === href ? "active" : ""}
            onClick={() => setMenuOpen(false)}
          >
            {label}
          </a>
        ))}
      </nav>
      <a className="header-cta" href="/contact">
        Start a conversation <ArrowUpRight size={16} />
      </a>
      <button
        className="mobile-menu"
        onClick={() => setMenuOpen((v) => !v)}
        aria-label={menuOpen ? "Close menu" : "Open menu"}
      >
        {menuOpen ? <X size={20} /> : <Menu size={20} />}
      </button>
    </header>
  );
}

function PageHero({ eyebrow, title, lede, image }) {
  return (
    <section
      className={`page-hero ${image ? "has-content-image" : ""}`}
      style={image ? { backgroundImage: `url(${image})` } : undefined}
    >
      <p className="eyebrow">{eyebrow}</p>
      <h1>{title}</h1>
      {lede && <p className="hero-lede">{lede}</p>}
    </section>
  );
}

function SiteFooter({ settings }) {
  const social = settings.social || {};
  const whatsapp = settings.contact?.whatsapp;
  const hasSocial =
    social.instagram || social.linkedin || social.facebook || whatsapp;
  const b = settings.brand;
  return (
    <footer>
      <div className="footer-top">
        <a className="wordmark light-wordmark" href="/">
          {b.logoUrl ? (
            <img
              className="logo-image footer-logo"
              src={b.logoUrl}
              alt="Gagnant Promoters"
            />
          ) : (
            <>
              <span className="mark">G</span>
              <span>
                GAGNANT<small>PROMOTERS</small>
              </span>
            </>
          )}
        </a>
        <p>{settings.tagline}</p>
        <div className="footer-links">
          <a href="/services">Services</a>
          <a href="/projects">Projects</a>
          <a href="/blog">Blog</a>
          <a href="/contact">Contact</a>
          <a href="/admin">Admin</a>
        </div>
      </div>
      <div className="footer-bottom">
        <span>© {new Date().getFullYear()} Gagnant Promoters</span>
        <span>{settings.contact?.address}</span>
        <span className="footer-bottom-right">
          {hasSocial && (
            <span className="footer-social">
              {whatsapp && (
                <a
                  href={`https://wa.me/${whatsapp}`}
                  target="_blank"
                  rel="noreferrer"
                  aria-label="WhatsApp"
                >
                  <WhatsappIcon size={15} />
                </a>
              )}
              {social.instagram && (
                <a
                  href={social.instagram}
                  target="_blank"
                  rel="noreferrer"
                  aria-label="Instagram"
                >
                  <Instagram size={15} />
                </a>
              )}
              {social.linkedin && (
                <a
                  href={social.linkedin}
                  target="_blank"
                  rel="noreferrer"
                  aria-label="LinkedIn"
                >
                  <Linkedin size={15} />
                </a>
              )}
              {social.facebook && (
                <a
                  href={social.facebook}
                  target="_blank"
                  rel="noreferrer"
                  aria-label="Facebook"
                >
                  <Facebook size={15} />
                </a>
              )}
            </span>
          )}
          {settings.contact?.email && (
            <a href={`mailto:${settings.contact.email}`}>
              {settings.contact.email}
            </a>
          )}
          {settings.contact?.secondaryEmail && (
            <a href={`mailto:${settings.contact.secondaryEmail}`}>
              {settings.contact.secondaryEmail}
            </a>
          )}
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
          <img src="/shellsort.jpeg" alt="ShellSort Technologies" />
        </a>
      </div>
    </footer>
  );
}

function TestimonialCarousel({ items }) {
  const [index, setIndex] = useState(0);
  useEffect(() => {
    if (items.length < 2) return;
    const timer = setInterval(
      () => setIndex((i) => (i + 1) % items.length),
      6000,
    );
    return () => clearInterval(timer);
  }, [items.length]);
  const current = items[index];
  if (!current)
    return (
      <>
        <div className="quote-mark">“</div>
        <blockquote>Clarity in the plan. Care in the execution.</blockquote>
      </>
    );
  return (
    <>
      <div className="quote-mark">“</div>
      {current.photoUrl && (
        <img
          className="quote-avatar"
          src={current.photoUrl}
          alt={current.name}
        />
      )}
      <blockquote>{current.quote}</blockquote>
      <p>
        {current.name} · {current.role}
      </p>
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

function HeroCarousel({ images }) {
  const [index, setIndex] = useState(0);
  useEffect(() => {
    if (images.length < 2) return;
    const timer = setInterval(
      () => setIndex((i) => (i + 1) % images.length),
      4500,
    );
    return () => clearInterval(timer);
  }, [images.length]);
  return images.map((url, i) => (
    <div
      key={url}
      className="hero-carousel-layer"
      style={{ backgroundImage: `url(${url})`, opacity: i === index ? 1 : 0 }}
    />
  ));
}

function SiteShell({ settings, children }) {
  const mainRef = useRef(null);
  useEffect(() => {
    const sections = mainRef.current
      ? Array.from(mainRef.current.querySelectorAll(":scope > section"))
      : [];
    if (!sections.length || typeof IntersectionObserver === "undefined") return;
    sections.forEach((el) => el.classList.add("reveal-on-scroll"));
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
      <SiteHeader settings={settings} />
      <main ref={mainRef}>{children}</main>
      <SiteFooter settings={settings} />
      <WhatsAppFloatButton whatsapp={settings.contact?.whatsapp} />
    </div>
  );
}

function ServicesGrid({ services }) {
  return (
    <div className="service-grid">
      {services.map((s, i) => (
        <a className="service-card" href={`/services/${s.slug}`} key={s.id}>
          <span className="service-number">0{i + 1}</span>
          <div
            className="service-thumb"
            style={
              s.imageUrl ? { backgroundImage: `url(${s.imageUrl})` } : undefined
            }
          />
          <div>
            <h3>{s.title}</h3>
            <p>{s.description}</p>
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
    p.imageUrl ||
    (ytId ? `https://img.youtube.com/vi/${ytId}/hqdefault.jpg` : "");
  return (
    <div className={`project-card p${i % 3}`}>
      <div
        className={`project-image ${bg ? "has-content-image" : ""}`}
        style={bg ? { backgroundImage: `url(${bg})` } : undefined}
      >
        <a
          className="project-image-link"
          href={`/projects/${p.slug}`}
          aria-label={p.title}
        />{" "}
        {!bg && <span className="project-initial">{p.title.slice(0, 1)}</span>}
        <span className="project-tag">{p.category}</span>
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
          <p>
            {p.location} · {p.year}
          </p>
        </div>
        <ArrowUpRight size={18} />
      </a>
    </div>
  );
}

// One category's projects as a horizontal row — manual < > arrows to page
// through it, plus a gentle auto-scroll that loops back to the start.
function CategoryProjectRow({ category, items, onPlay }) {
  const trackRef = useRef(null);
  const scrollByCards = (dir) => {
    const el = trackRef.current;
    if (!el) return;
    const card = el.querySelector(".project-card");
    const amount = card ? card.offsetWidth + 18 : el.clientWidth * 0.8;
    el.scrollBy({ left: dir * amount, behavior: "smooth" });
  };
  useEffect(() => {
    if (items.length < 2) return;
    const timer = setInterval(() => {
      const el = trackRef.current;
      if (!el) return;
      if (el.scrollLeft + el.clientWidth >= el.scrollWidth - 4)
        el.scrollTo({ left: 0, behavior: "smooth" });
      else scrollByCards(1);
    }, 4500);
    return () => clearInterval(timer);
  }, [items.length]);
  return (
    <div className="category-row">
      <div className="category-row-head">
        <h3>{category}</h3>
        {items.length > 1 && (
          <div className="category-row-nav">
            <button
              type="button"
              onClick={() => scrollByCards(-1)}
              aria-label={`Previous ${category} projects`}
            >
              <ChevronLeft size={17} />
            </button>
            <button
              type="button"
              onClick={() => scrollByCards(1)}
              aria-label={`Next ${category} projects`}
            >
              <ChevronRight size={17} />
            </button>
          </div>
        )}
      </div>
      <div className="category-row-track" ref={trackRef}>
        {items.map((p, i) => (
          <ProjectCard key={p.id} p={p} i={i} onPlay={onPlay} />
        ))}
      </div>
    </div>
  );
}

// Projects grouped by category — one auto-scrolling, arrow-navigable row per
// category (Commercial, Industrial, Residential, ...), in the order each
// category first appears among the projects.
function ProjectsByCategory({ projects, onPlay }) {
  const groups = [];
  projects.forEach((p) => {
    const cat = p.category || "Other";
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
          key={g.category}
          category={g.category}
          items={g.items}
          onPlay={onPlay}
        />
      ))}
    </div>
  );
}

function ClientsGrid({ clients }) {
  if (!clients.length) return null;
  return (
    <section className="section clients-section">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Trusted by</p>
          <h2>
            Brands we’ve <em>delivered for.</em>
          </h2>
        </div>
      </div>
      <div className="client-grid">
        {clients.map((c) => (
          <div className="client-logo" key={c.id} title={c.name}>
            {c.logoUrl ? (
              <img src={c.logoUrl} alt={c.name} />
            ) : (
              <span>{c.name}</span>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

function BlogGrid({ blogs }) {
  return (
    <div className="blog-grid">
      {blogs.map((post) => (
        <article key={post.id}>
          {post.coverUrl && (
            <div
              className="blog-image"
              style={{ backgroundImage: `url(${post.coverUrl})` }}
            />
          )}
          <span>
            {post.category} · {dateLabel(post.publishedAt)}
          </span>
          <h3>{post.title}</h3>
          <p>{post.excerpt}</p>
          <a className="text-link" href={`/blog/${post.slug}`}>
            Read insight <span>→</span>
          </a>
        </article>
      ))}
    </div>
  );
}

function ContactSection({
  settings,
  form,
  setForm,
  sent,
  setSent,
  error,
  onSubmit,
}) {
  return (
    <section className="contact-section" id="contact">
      <div className="contact-copy">
        <p className="eyebrow">Let’s build something</p>
        <h2>
          Have a project
          <br />
          <em>in mind?</em>
        </h2>
        <p>
          Tell us a little about it. We’ll come back with the right next step.
        </p>
        <div className="contact-details">
          {settings.contact.email && (
            <a href={`mailto:${settings.contact.email}`}>
              <Mail size={16} />
              {settings.contact.email}
            </a>
          )}
          {settings.contact.secondaryEmail && (
            <a href={`mailto:${settings.contact.secondaryEmail}`}>
              <Mail size={16} />
              {settings.contact.secondaryEmail}
            </a>
          )}
          {settings.contact.phone && (
            <a href={`tel:${settings.contact.phone}`}>
              <Phone size={16} />
              {settings.contact.phone}
            </a>
          )}
          {settings.contact.whatsapp && (
            <a
              href={`https://wa.me/${settings.contact.whatsapp}`}
              target="_blank"
              rel="noreferrer"
            >
              <WhatsappIcon size={16} />
              WhatsApp
            </a>
          )}
          {settings.contact.address && (
            <span>
              <MapPin size={16} />
              {settings.contact.address}
            </span>
          )}
          {settings.contact.hours && (
            <span>
              <Clock size={16} />
              {settings.contact.hours}
            </span>
          )}
        </div>
      </div>
      <form onSubmit={onSubmit} className="lead-form">
        {sent ? (
          <div className="success">
            <Check size={30} />
            <h3>Message received.</h3>
            <p>Thank you. Our team will be in touch shortly.</p>
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
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Jane Smith"
              />
            </label>
            <label>
              Email address
              <input
                required
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                placeholder="jane@company.com"
              />
            </label>
            <label>
              Phone number
              <input
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
                placeholder="+91"
              />
            </label>
            <label>
              Tell us about the project
              <textarea
                required
                value={form.message}
                onChange={(e) => setForm({ ...form, message: e.target.value })}
                placeholder="A few words about what you're building..."
              />
            </label>
            {error && <p className="form-error">{error}</p>}
            <button className="button light" type="submit">
              Send enquiry <ArrowUpRight size={17} />
            </button>
          </>
        )}
      </form>
    </section>
  );
}

const SITE_NAME = "Gagnant Promoters";
const absoluteUrl = (url) =>
  !url
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
// JSON-LD) in sync with the current route — this is a client-rendered SPA,
// so without this every page would share the same static index.html tags.
function useSEO(
  { title, description, image, path, type = "website" } = {},
  jsonLd,
) {
  useEffect(() => {
    const fullTitle = title
      ? `${title} | ${SITE_NAME}`
      : `${SITE_NAME} | Construction, Interiors & Project Management`;
    document.title = fullTitle;
    const desc =
      description ||
      "Pan-India construction, interiors and project delivery with disciplined execution.";
    const url = `${location.origin}${path || location.pathname}`;
    const img = absoluteUrl(image);
    upsertMeta("name", "description", desc);
    upsertLink("canonical", url);
    upsertMeta("property", "og:type", type);
    upsertMeta("property", "og:site_name", SITE_NAME);
    upsertMeta("property", "og:title", fullTitle);
    upsertMeta("property", "og:description", desc);
    upsertMeta("property", "og:url", url);
    upsertMeta("property", "og:image", img);
    upsertMeta("name", "twitter:card", img ? "summary_large_image" : "summary");
    upsertMeta("name", "twitter:title", fullTitle);
    upsertMeta("name", "twitter:description", desc);
    upsertMeta("name", "twitter:image", img);
    upsertJsonLd(jsonLd);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title, description, image, path, type, JSON.stringify(jsonLd)]);
}
function organizationJsonLd(settings) {
  const contact = settings.contact || {};
  const sameAs = [
    settings.social?.instagram,
    settings.social?.linkedin,
    settings.social?.facebook,
  ].filter(Boolean);
  return {
    "@context": "https://schema.org",
    "@type": "GeneralContractor",
    name: SITE_NAME,
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
function detailJsonLd(item, kind) {
  const image = absoluteUrl(item.imageUrl || item.coverUrl);
  const provider = {
    "@type": "Organization",
    name: SITE_NAME,
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
    areaServed: "IN",
  };
}
// Builds this render's SEO props from the current path + already-loaded
// bootstrap data, falling back through per-item SEO fields, per-page SEO
// settings (admin-editable), then sensible defaults — in that order.
function useSiteSEO(path, data) {
  const seo = useMemo(() => {
    if (!data) return {};
    const { settings, services, projects, blogs } = data;
    const seoSettings = settings.seo || {};
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
          title: detail.seoTitle || detail.title,
          description:
            detail.seoDescription ||
            detail.description ||
            detail.summary ||
            detail.excerpt,
          image: detail.imageUrl || detail.coverUrl,
          path,
          type: kind === "blog" ? "article" : "website",
        },
        jsonLd: detailJsonLd(detail, kind),
      };
    }
    const pageKey = path === "/" ? "home" : path.replace("/", "");
    const defaults = {
      home: { title: "", description: settings.tagline },
      about: { title: "About Us", description: settings.overview },
      services: {
        title: "Services",
        description: "Explore our construction and interior capabilities.",
      },
      projects: {
        title: "Projects",
        description: "Selected work delivered by Gagnant Promoters.",
      },
      blog: { title: "Blog", description: "Insights from the field." },
      contact: {
        title: "Contact Us",
        description: "Get in touch with Gagnant Promoters.",
      },
    };
    const pageSeo = seoSettings[pageKey] || {};
    const fallback = defaults[pageKey] || {};
    return {
      props: {
        title: pageSeo.title || fallback.title,
        description: pageSeo.description || fallback.description,
        image: settings.brand?.heroUrl || settings.brand?.heroImages?.[0],
        path,
        type: "website",
      },
      jsonLd: organizationJsonLd(settings),
    };
  }, [path, data]);
  useSEO(seo.props, seo.jsonLd);
}

function PublicSite() {
  const [data, setData] = useState(null);
  const [form, setForm] = useState({
    name: "",
    email: "",
    phone: "",
    message: "",
  });
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");
  const [videoModal, setVideoModal] = useState(null);
  useEffect(() => {
    api("/public/gagnant-promoters/bootstrap")
      .then(setData)
      .catch((e) => setError(e.message));
  }, []);
  const path = location.pathname;
  useSiteSEO(path, data);
  if (error)
    return (
      <div className="center-state">
        <CircleAlert />
        <h2>{error}</h2>
      </div>
    );
  if (!data)
    return (
      <div className="loading-screen">
        <div className="loader" />
        Loading your project experience
      </div>
    );
  const {
    settings,
    services,
    projects,
    testimonials,
    blogs,
    clients = [],
  } = data;
  const b = settings.brand;
  const submit = async (e) => {
    e.preventDefault();
    setError("");
    try {
      await api("/public/gagnant-promoters/leads", {
        method: "POST",
        body: JSON.stringify(form),
      });
      setSent(true);
      setForm({ name: "", email: "", phone: "", message: "" });
    } catch (err) {
      setError(err.message);
    }
  };
  const contactProps = {
    settings,
    form,
    setForm,
    sent,
    setSent,
    error,
    onSubmit: submit,
  };

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
      />
    );

  if (path === "/about")
    return (
      <SiteShell settings={settings}>
        <PageHero
          eyebrow="About Gagnant Promoters"
          title="Good work is built on good thinking."
          lede={
            settings.overview ||
            "Gagnant Promoters is a construction, interiors and project management partner for teams who value a clear plan, a steady hand and a finished space that works."
          }
          image={settings.pageBanners?.about}
        />
        <section className="stats">
          <div>
            <strong>7</strong>
            <span>
              Integrated
              <br />
              capabilities
            </span>
          </div>
          <div>
            <strong>
              Pan<span>–</span>India
            </strong>
            <span>
              Project
              <br />
              capability
            </span>
          </div>
          <div>
            <strong>01</strong>
            <span>
              Accountable
              <br />
              partner
            </span>
          </div>
          <div>
            <strong>100%</strong>
            <span>
              Ownership
              <br />
              of delivery
            </span>
          </div>
        </section>
        {(settings.vision ||
          settings.mission ||
          settings.values?.length > 0) && (
          <section className="vmv-section">
            <div className="vmv-grid">
              {settings.vision && (
                <div>
                  <p className="eyebrow">Vision</p>
                  <p>{settings.vision}</p>
                </div>
              )}
              {settings.mission && (
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
        <section className="process">
          <div className="process-intro">
            <p className="eyebrow">How we work</p>
            <h2>
              Progress you can <em>see.</em>
            </h2>
            <p>
              We turn moving parts into a shared rhythm — with a clear scope,
              visible decisions and no surprises.
            </p>
          </div>
          <div className="process-steps">
            {[
              "Scope",
              "Plan",
              "Mobilise",
              "Execute",
              "Control",
              "Handover",
            ].map((x, i) => (
              <div className="step" key={x}>
                <span>0{i + 1}</span>
                <b>{x}</b>
                <i>
                  {i === 0
                    ? "Understand the brief"
                    : i === 5
                      ? "Leave it better"
                      : "Make the next move"}
                </i>
              </div>
            ))}
          </div>
        </section>
        <ClientsGrid clients={clients} />
      </SiteShell>
    );

  if (path === "/services")
    return (
      <SiteShell settings={settings}>
        <PageHero
          eyebrow="What we do"
          title="Built around your ambition."
          lede="From structure to finish, our capabilities work together to make the project simpler for you."
          image={settings.pageBanners?.services}
        />
        <section className="section">
          <ServicesGrid services={services} />
        </section>
      </SiteShell>
    );

  if (path === "/projects")
    return (
      <SiteShell settings={settings}>
        <PageHero
          eyebrow="Selected work"
          title="Made for the real world."
          image={settings.pageBanners?.projects}
        />
        <section className="section projects">
          <ProjectsByCategory projects={projects} onPlay={setVideoModal} />
        </section>
        <VideoModal
          youtubeId={videoModal}
          onClose={() => setVideoModal(null)}
        />
        <ClientsGrid clients={clients} />
      </SiteShell>
    );

  if (path === "/blog")
    return (
      <SiteShell settings={settings}>
        <PageHero
          eyebrow="From the field"
          title="Ideas worth building on."
          image={settings.pageBanners?.blog}
        />
        <section className="section insights">
          <BlogGrid blogs={blogs} />
        </section>
      </SiteShell>
    );

  if (path === "/contact")
    return (
      <SiteShell settings={settings}>
        <PageHero
          eyebrow="Contact Us"
          title="Let’s start the conversation."
          lede="Reach out however works best for you — phone, WhatsApp, email or the form below."
          image={settings.pageBanners?.contact}
        />
        <ContactSection {...contactProps} />
      </SiteShell>
    );

  return (
    <SiteShell settings={settings}>
      <section
        className={`hero hero-banner ${b.heroVideo || b.heroImages?.length || b.heroUrl ? "has-media" : ""}`}
      >
        {b.heroVideo ? (
          <video
            className="hero-media"
            src={b.heroVideo}
            autoPlay
            muted
            loop
            playsInline
          />
        ) : b.heroImages?.length > 0 ? (
          <HeroCarousel images={b.heroImages} />
        ) : b.heroUrl ? (
          <div
            className="hero-media"
            style={{ backgroundImage: `url(${b.heroUrl})` }}
          />
        ) : (
          <div className="hero-shapes">
            <div className="sun" />
            <div className="shape shape-back" />
            <div className="shape shape-front" />
          </div>
        )}
        <div className="hero-copy">
          <p className="eyebrow">Construction · Interiors · Project Delivery</p>
          <h1>
            Building with <em>purpose.</em>
            <br />
            Delivering with discipline.
          </h1>
          <p className="hero-lede">
            We bring clarity to complex builds, from first scope to final
            handover. Thoughtful spaces. Dependable delivery.
          </p>
          <div className="hero-actions">
            <a className="button primary" href="/contact">
              Discuss your project <ArrowUpRight size={17} />
            </a>
            <a className="text-link" href="/projects">
              Explore our work <span>→</span>
            </a>
          </div>
        </div>
        <div className="hero-stamp">
          <span>01</span>
          <small>
            One accountable
            <br />
            delivery partner
          </small>
        </div>
      </section>
      <section className="trust-row">
        <span>Trusted to deliver across</span>
        <b>Corporate & MNC</b>
        <b>Industrial</b>
        <b>Commercial</b>
        <b>Residential</b>
      </section>
      <section className="intro split">
        <div>
          <p className="eyebrow">The Gagnant way</p>
          <h2>
            Good work is built on <em>good thinking.</em>
          </h2>
        </div>
        <div>
          <p className="large-copy">
            Gagnant Promoters is a construction, interiors and project
            management partner for teams who value a clear plan, a steady hand
            and a finished space that works.
          </p>
          <a className="text-link" href="/about">
            Get to know us <span>→</span>
          </a>
        </div>
      </section>
      <section className="stats">
        <div>
          <strong>7</strong>
          <span>
            Integrated
            <br />
            capabilities
          </span>
        </div>
        <div>
          <strong>
            Pan<span>–</span>India
          </strong>
          <span>
            Project
            <br />
            capability
          </span>
        </div>
        <div>
          <strong>01</strong>
          <span>
            Accountable
            <br />
            partner
          </span>
        </div>
        <div>
          <strong>100%</strong>
          <span>
            Ownership
            <br />
            of delivery
          </span>
        </div>
      </section>
      <section className="section">
        <div className="section-heading">
          <div>
            <p className="eyebrow">What we do</p>
            <h2>
              Built around your <em>ambition.</em>
            </h2>
          </div>
          <a className="text-link" href="/services">
            See all services <span>→</span>
          </a>
        </div>
        <ServicesGrid services={services} />
      </section>
      <section className="process">
        <div className="process-intro">
          <p className="eyebrow">How we work</p>
          <h2>
            Progress you can <em>see.</em>
          </h2>
          <p>
            We turn moving parts into a shared rhythm — with a clear scope,
            visible decisions and no surprises.
          </p>
        </div>
        <div className="process-steps">
          {["Scope", "Plan", "Mobilise", "Execute", "Control", "Handover"].map(
            (x, i) => (
              <div className="step" key={x}>
                <span>0{i + 1}</span>
                <b>{x}</b>
                <i>
                  {i === 0
                    ? "Understand the brief"
                    : i === 5
                      ? "Leave it better"
                      : "Make the next move"}
                </i>
              </div>
            ),
          )}
        </div>
      </section>
      <section className="section projects">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Selected work</p>
            <h2>
              Made for the <em>real world.</em>
            </h2>
          </div>
          <a className="text-link" href="/projects">
            See all projects <span>→</span>
          </a>
        </div>
        <ProjectsByCategory projects={projects} onPlay={setVideoModal} />
      </section>
      <VideoModal youtubeId={videoModal} onClose={() => setVideoModal(null)} />
      <ClientsGrid clients={clients} />
      <section className="quote-section">
        <TestimonialCarousel items={testimonials} />
      </section>
      <section className="section insights">
        <div className="section-heading">
          <div>
            <p className="eyebrow">From the field</p>
            <h2>
              Ideas worth <em>building on.</em>
            </h2>
          </div>
          <a className="text-link" href="/blog">
            See all insights <span>→</span>
          </a>
        </div>
        <BlogGrid blogs={blogs} />
      </section>
      <ContactSection {...contactProps} />
    </SiteShell>
  );
}

function DetailSite({ item, settings, onSubmit, form, setForm, sent, error }) {
  const isProject = item.client || item.location;
  const isBlog = item.body && !item.benefits;
  return (
    <SiteShell settings={settings}>
      <section className="detail-hero">
        <div>
          <a className="back-link" href="/">
            ← Back to Gagnant
          </a>
          <p className="eyebrow">
            {isBlog
              ? item.category
              : isProject
                ? `${item.category} · ${item.location}`
                : item.category}
          </p>
          <h1>{item.title}</h1>
          <p className="hero-lede">
            {item.description || item.summary || item.excerpt}
          </p>
        </div>
        <div
          className={`detail-art ${item.imageUrl || item.coverUrl ? "has-content-image" : ""}`}
          style={
            item.imageUrl || item.coverUrl
              ? { backgroundImage: `url(${item.imageUrl || item.coverUrl})` }
              : undefined
          }
        >
          {!(item.imageUrl || item.coverUrl) && (
            <span>{item.title.slice(0, 1)}</span>
          )}
        </div>
      </section>
      <section className="detail-body">
        <div>
          <p className="eyebrow">{isBlog ? "The insight" : "Our approach"}</p>
          <h2>
            {isBlog
              ? "Ideas worth building on."
              : "A clear path from brief to handover."}
          </h2>
        </div>
        <div>
          <p className="large-copy">
            {item.content || item.body || item.summary}
          </p>
          {item.benefits && (
            <ul className="benefit-list">
              {item.benefits.map((benefit) => (
                <li key={benefit}>
                  <Check size={15} />
                  {benefit}
                </li>
              ))}
            </ul>
          )}
          <a className="button primary" href="#detail-contact">
            Discuss this project <ArrowUpRight size={16} />
          </a>
        </div>
      </section>
      <section className="detail-contact" id="detail-contact">
        <div>
          <p className="eyebrow">Keep the conversation moving</p>
          <h2>
            Let’s make the
            <br />
            <em>next move.</em>
          </h2>
        </div>
        {sent ? (
          <div className="success detail-success">
            <Check size={30} />
            <h3>Message received.</h3>
            <p>Thank you. Our team will be in touch shortly.</p>
          </div>
        ) : (
          <form onSubmit={onSubmit} className="lead-form">
            <label>
              Your name
              <input
                required
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Jane Smith"
              />
            </label>
            <label>
              Email address
              <input
                required
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                placeholder="jane@company.com"
              />
            </label>
            <label>
              Project note
              <textarea
                required
                value={form.message}
                onChange={(e) => setForm({ ...form, message: e.target.value })}
                placeholder={`Tell us about ${item.title.toLowerCase()}…`}
              />
            </label>
            {error && <p className="form-error">{error}</p>}
            <button className="button light" type="submit">
              Send enquiry <ArrowUpRight size={17} />
            </button>
          </form>
        )}
      </section>
    </SiteShell>
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
  { id: "media", label: "Media library", icon: Image },
  { id: "settings", label: "Brand & settings", icon: Settings },
];
const titles = {
  services: "Services",
  projects: "Projects",
  blogs: "Insights",
  testimonials: "Testimonials",
  clients: "Clients",
};

function Login({ onLogin, notice }) {
  const [form, setForm] = useState({ email: "", password: "" });
  const [error, setError] = useState("");
  const [logoUrl, setLogoUrl] = useState("");
  useEffect(() => {
    api("/public/gagnant-promoters/bootstrap")
      .then((d) => setLogoUrl(d.settings?.brand?.logoUrl || ""))
      .catch(() => {});
  }, []);
  const submit = async (e) => {
    e.preventDefault();
    try {
      const data = await api("/auth/login", {
        method: "POST",
        body: JSON.stringify(form),
      });
      localStorage.setItem("gp_token", data.token);
      onLogin(data.user);
    } catch (err) {
      setError(err.message);
    }
  };
  return (
    <div className="admin-login">
      <div className="login-aside">
        <a className="wordmark light-wordmark" href="/">
          {logoUrl ? (
            <img
              className="logo-image login-logo"
              src={logoUrl}
              alt="Gagnant Promoters"
            />
          ) : (
            <>
              <span className="mark">G</span>
              <span>
                GAGNANT<small>PROMOTERS</small>
              </span>
            </>
          )}
        </a>
        <div>
          <p className="eyebrow">Control plane</p>
          <h1>
            Build once.
            <br />
            <em>Configure many.</em>
          </h1>
          <p>
            Manage every client website from one calm, considered workspace.
          </p>
        </div>
        <span className="login-note">Gagnant Platform · v1.0</span>
      </div>
      <form className="login-form" onSubmit={submit}>
        <div className="form-heading">
          <span className="admin-kicker">SUPER ADMIN</span>
          <h2>Welcome back.</h2>
          <p>Sign in to your workspace.</p>
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
        {error && <p className="form-error">{error}</p>}
        <button className="button dark" type="submit">
          Enter workspace <ArrowUpRight size={17} />
        </button>
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

function AccountModal({ user, onClose, onSaved, onPasswordChanged }) {
  const [name, setName] = useState(user.name || "");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    setError("");
    if (newPassword && newPassword !== confirmPassword) {
      setError("New passwords don't match");
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
      // Changing the password invalidates the point of staying signed in on
      // the old one — send the admin back to a fresh login with the new one.
      if (newPassword) onPasswordChanged();
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
            <span className="admin-kicker">YOUR ACCOUNT</span>
            <h2>{user.name || "Account"}</h2>
            <p>{user.email}</p>
          </div>
          <button onClick={onClose}>
            <X size={19} />
          </button>
        </div>
        <form className="editor-form" id="account-form" onSubmit={submit}>
          <label>
            Display name
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Your name"
            />
          </label>
          <PasswordField
            label="Current password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            placeholder="Required only to change your password"
            autoComplete="current-password"
          />
          <PasswordField
            label="New password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            placeholder="Leave blank to keep your current password"
            autoComplete="new-password"
          />
          <PasswordField
            label="Confirm new password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            autoComplete="new-password"
          />
          {error && <p className="form-error">{error}</p>}
        </form>
        <div className="modal-footer">
          <button className="button outline" type="button" onClick={onClose}>
            Cancel
          </button>
          <button
            className="button dark"
            type="submit"
            form="account-form"
            disabled={busy}
          >
            <Save size={16} /> {busy ? "Saving…" : "Save changes"}
          </button>
        </div>
      </div>
    </div>
  );
}

function AdminApp() {
  const [user, setUser] = useState(null);
  const [tab, setTab] = useState("overview");
  const [tenant, setTenant] = useState(null);
  const [data, setData] = useState({});
  const [toast, setToast] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [loginNotice, setLoginNotice] = useState("");
  const collectionKeys = [
    "services",
    "projects",
    "blogs",
    "testimonials",
    "clients",
    "leads",
    "media",
  ];
  const refresh = async () => {
    const [tenants, settings, ...collections] = await Promise.all([
      api("/tenants"),
      api("/settings"),
      ...collectionKeys.map((x) => api(`/${x}`)),
    ]);
    setTenant(tenants.items[0]);
    setData({
      settings,
      ...Object.fromEntries(
        collectionKeys.map((key, i) => [key, collections[i].items]),
      ),
    });
  };
  useEffect(() => {
    if (localStorage.getItem("gp_token"))
      api("/me")
        .then((x) => {
          setUser(x.user);
          refresh();
        })
        .catch(() => localStorage.removeItem("gp_token"));
  }, []);
  if (!user)
    return (
      <Login
        onLogin={(u) => {
          setLoginNotice("");
          setUser(u);
          refresh();
        }}
        notice={loginNotice}
      />
    );
  if (!tenant || !data.settings)
    return (
      <div className="loading-screen">
        <div className="loader" />
        Loading workspace
      </div>
    );
  const logout = () => {
    localStorage.removeItem("gp_token");
    setUser(null);
  };
  const save = async (resource, item, isNew = false) => {
    try {
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
      setToast("Saved successfully");
      setTimeout(() => setToast(""), 2500);
      return result;
    } catch (e) {
      setToast(e.message);
    }
  };
  const remove = async (resource, item) => {
    if (!confirm(`Delete ${item.title || item.name || "this item"}?`)) return;
    await api(`/${resource}/${item.id}`, { method: "DELETE" });
    setData((d) => ({
      ...d,
      [resource]: d[resource].filter((x) => x.id !== item.id),
    }));
    const media = await api("/media");
    setData((d) => ({ ...d, media: media.items }));
  };
  const updateMediaUse = async (field, url) => {
    const next = await api("/settings", {
      method: "PATCH",
      body: JSON.stringify({ brand: { ...data.settings.brand, [field]: url } }),
    });
    setData((d) => ({ ...d, settings: next }));
    setToast(
      field === "logoUrl"
        ? "Logo connected to website"
        : "Hero image connected to website",
    );
    setTimeout(() => setToast(""), 2500);
  };
  return (
    <div className="admin-shell">
      <aside className={`admin-sidebar ${menuOpen ? "open" : ""}`}>
        <div className="sidebar-brand">
          <a className="wordmark" href="/">
            {data.settings.brand.logoUrl ? (
              <img
                className="logo-image sidebar-logo"
                src={data.settings.brand.logoUrl}
                alt="Gagnant Promoters"
              />
            ) : (
              <>
                <span className="mark">G</span>
                <span>
                  GAGNANT<small>PROMOTERS</small>
                </span>
              </>
            )}
          </a>
          <button onClick={() => setMenuOpen(false)}>
            <X size={18} />
          </button>
        </div>
        <div className="workspace-switcher">
          <span className="avatar">GP</span>
          <span>
            <small>WORKSPACE</small>
            <b>{tenant.name}</b>
          </span>
          <ChevronDown size={15} />
        </div>
        <nav className="admin-nav">
          {nav.map((n) => {
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
          <a href="/" target="_blank">
            <ExternalLink size={15} />
            View live site
          </a>
          <button onClick={logout}>
            <LogOut size={15} />
            Sign out
          </button>
        </div>
      </aside>
      <div className="admin-main">
        <header className="admin-header">
          <button className="hamburger" onClick={() => setMenuOpen(true)}>
            <Menu size={20} />
          </button>
          <div>
            <span className="admin-kicker">GAGNANT PROMOTERS</span>
            <h1>
              {tab === "overview"
                ? "Good morning, Admin."
                : tab === "settings"
                  ? "Brand & settings"
                  : titles[tab] || tab}
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
        <div className="admin-content">
          {tab === "overview" ? (
            <Overview data={data} setTab={setTab} />
          ) : tab === "settings" ? (
            <SettingsPanel
              settings={data.settings}
              onSave={async (s) => {
                const next = await api("/settings", {
                  method: "PATCH",
                  body: JSON.stringify(s),
                });
                setData((d) => ({ ...d, settings: next }));
                setToast("Brand settings saved");
              }}
            />
          ) : tab === "leads" ? (
            <LeadTable
              items={data.leads}
              onUpdate={async (lead) => {
                const next = await api(`/leads/${lead.id}`, {
                  method: "PATCH",
                  body: JSON.stringify(lead),
                });
                setData((d) => ({
                  ...d,
                  leads: d.leads.map((x) => (x.id === next.id ? next : x)),
                }));
              }}
            />
          ) : tab === "media" ? (
            <MediaPanel
              items={data.media}
              onUpload={async (item) =>
                setData((d) => ({ ...d, media: [...d.media, item] }))
              }
              onUse={updateMediaUse}
              onDelete={async (item) => {
                if (!confirm(`Delete "${item.name}"? This cannot be undone.`))
                  return;
                const result = await api(`/media/${item.id}`, {
                  method: "DELETE",
                });
                setData((d) => ({
                  ...d,
                  media: d.media.filter((x) => x.id !== item.id),
                }));
                if (result.clearedReferences?.length) {
                  const affected = [
                    "services",
                    "projects",
                    "blogs",
                    "testimonials",
                    "clients",
                  ];
                  const [settings, ...refreshed] = await Promise.all([
                    api("/settings"),
                    ...affected.map((x) => api(`/${x}`)),
                  ]);
                  setData((d) => ({
                    ...d,
                    settings,
                    ...Object.fromEntries(
                      affected.map((key, i) => [key, refreshed[i].items]),
                    ),
                  }));
                  setToast(
                    "Deleted — it was also removed from where it was in use",
                  );
                  setTimeout(() => setToast(""), 3000);
                }
              }}
            />
          ) : (
            <ContentManager
              resource={tab}
              items={data[tab] || []}
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
            setToast("Account updated");
            setTimeout(() => setToast(""), 2500);
          }}
          onPasswordChanged={() => {
            setAccountOpen(false);
            setLoginNotice("Password changed — please sign in again.");
            logout();
          }}
        />
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
          <p>Your Gagnant Promoters site is live and ready to evolve.</p>
          <a className="button small light" href="/" target="_blank">
            View website <ArrowUpRight size={15} />
          </a>
        </div>
        <div className="welcome-orbit">
          <span>GP</span>
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

function ContentManager({ resource, items, onSave, onDelete }) {
  const [editing, setEditing] = useState(null);
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
              title: "",
              status: "published",
              ...(resource === "services"
                ? { description: "", category: "Residential" }
                : {}),
              ...(resource === "projects"
                ? {
                    summary: "",
                    category: "Commercial",
                    location: "",
                    year: new Date().getFullYear().toString(),
                  }
                : {}),
              ...(resource === "blogs"
                ? { excerpt: "", body: "", category: "Insights" }
                : {}),
              ...(resource === "testimonials"
                ? { name: "", role: "", quote: "", rating: 5, photoUrl: "" }
                : {}),
              ...(resource === "clients" ? { name: "", logoUrl: "" } : {}),
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
          <div className="table-row" key={item.id}>
            <div className="row-title">
              <span className="row-icon">
                {resource === "services"
                  ? "✦"
                  : resource === "projects"
                    ? "◒"
                    : "▤"}
              </span>
              <div>
                <b>{item.title || item.name}</b>
                <small>
                  {item.category || item.slug || item.role || "Content entry"}
                </small>
              </div>
            </div>
            <Status status={item.status || "published"} />
            <span className="date-cell">
              {dateLabel(item.updatedAt || item.createdAt)}
            </span>
            <div className="row-actions">
              <button onClick={() => setEditing(item)}>
                <Pencil size={15} />
              </button>
              <button onClick={() => onDelete(resource, item)}>
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
          initial={editing}
          onClose={() => setEditing(null)}
          onSave={async (item) => {
            await onSave(resource, item, !item.id);
            setEditing(null);
          }}
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
];
// Fixed category lists (rather than free text) so project/service categories
// stay consistent — the public site groups projects into a row per category,
// so a typo here (e.g. "Comercial") would silently create its own empty-looking row.
const CATEGORY_OPTIONS = {
  services: [
    "Residential",
    "Commercial",
    "Industrial",
    "Interiors",
    "Management",
  ],
  projects: [
    "Commercial",
    "Industrial",
    "Residential",
    "Institutional",
    "Retail",
  ],
};

function Editor({ resource, initial, onClose, onSave }) {
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
            : [
                ["logoUrl", "Logo"],
                ["name", "Client name"],
              ];
  const requiredKeys = REQUIRED_FIELDS[resource] || [];
  const categoryOptions = CATEGORY_OPTIONS[resource];
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
                  value={item.category || categoryOptions[0]}
                  onChange={(e) => change("category", e.target.value)}
                >
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
                    value={item[key] || ""}
                    onChange={(e) => change(key, e.target.value)}
                    placeholder={
                      key === "videoUrl"
                        ? "https://www.youtube.com/watch?v=…"
                        : undefined
                    }
                  />
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

function LeadTable({ items, onUpdate }) {
  const [selected, setSelected] = useState(null);
  return (
    <section className="content-manager">
      <div className="toolbar">
        <div>
          <span className="admin-kicker">INBOX</span>
          <h2 className="subheading">Every enquiry, one clear next step.</h2>
        </div>
        <span className="count-chip">{items.length} total</span>
      </div>
      <div className="table-card lead-table">
        <div className="table-head">
          <span>CONTACT</span>
          <span>MESSAGE</span>
          <span>STATUS</span>
          <span>RECEIVED</span>
        </div>
        {items.map((lead) => (
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
                  {lead.email} · {lead.phone || "No phone"}
                </small>
              </div>
            </div>
            <span className="message-cell">{lead.message}</span>
            <Status status={lead.status} />
            <span className="date-cell">{dateLabel(lead.createdAt)}</span>
          </div>
        ))}
        {!items.length && (
          <Empty
            title="No enquiries yet"
            text="Your contact form is ready. New messages will land here."
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
                <p>
                  {selected.email} · {selected.phone || "No phone supplied"}
                </p>
              </div>
              <button onClick={() => setSelected(null)}>
                <X size={19} />
              </button>
            </div>
            <div className="lead-message">{selected.message}</div>
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
                className="button dark"
                onClick={async () => {
                  await onUpdate(selected);
                  setSelected(null);
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

function MultiAssetUploadField({ label, hint, values, onChange, max = 8 }) {
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState("");
  const list = values || [];
  const handle = async (e) => {
    const originals = Array.from(e.target.files || []).slice(
      0,
      Math.max(0, max - list.length),
    );
    e.target.value = "";
    if (!originals.length) return;
    setBusy(true);
    setError("");
    const uploaded = [];
    for (let i = 0; i < originals.length; i += 1) {
      setProgress(2);
      try {
        const file = await compressImageFile(originals[i]);
        const result = await uploadWithProgress(file, setProgress);
        uploaded.push(result.url);
      } catch (err) {
        setError(err.message);
      }
    }
    if (uploaded.length) onChange([...list, ...uploaded]);
    setBusy(false);
    setProgress(0);
  };
  const remove = (url) => onChange(list.filter((u) => u !== url));
  return (
    <label className="asset-upload-field">
      {label}
      <div className="multi-asset-grid">
        {list.map((url) => (
          <div className="asset-preview multi" key={url}>
            <img src={url} alt="" />
            <button
              type="button"
              className="asset-remove"
              onClick={() => remove(url)}
            >
              <Trash2 size={13} />
            </button>
          </div>
        ))}
        {list.length < max && (
          <label className="asset-placeholder multi-add">
            {busy ? (
              `Uploading… ${progress}%`
            ) : (
              <>
                <Plus size={18} />
                <small>Add images</small>
              </>
            )}
            <input
              hidden
              type="file"
              accept="image/*"
              multiple
              disabled={busy}
              onChange={handle}
            />
          </label>
        )}
      </div>
      {hint && <small className="field-hint">{hint}</small>}
      {error && <p className="form-error">{error}</p>}
    </label>
  );
}

function VideoUploadField({ label, hint, value, onChange }) {
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState("");
  const handle = async (e) => {
    const file = e.target.files[0];
    e.target.value = "";
    if (!file) return;
    setBusy(true);
    setProgress(2);
    setError("");
    try {
      const result = await uploadWithProgress(file, setProgress);
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
            <video src={value} muted />
          </div>
        ) : (
          <div className="asset-placeholder">
            <Play size={20} />
          </div>
        )}
        <div className="asset-upload-actions">
          <label className="button outline small">
            {busy
              ? `Uploading… ${progress}%`
              : value
                ? "Replace video"
                : "Upload video"}
            <input
              hidden
              type="file"
              accept="video/*"
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

function SettingsPanel({ settings, onSave }) {
  const [form, setForm] = useState(settings);
  const update = (group, key, value) =>
    setForm({ ...form, [group]: { ...form[group], [key]: value } });
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
          <AssetUploadField
            label="Hero / banner image"
            hint="Shown behind the homepage headline. Used when no hero gallery images are set below."
            value={form.brand.heroUrl}
            onChange={(url) => update("brand", "heroUrl", url)}
          />
          <MultiAssetUploadField
            label="Hero gallery (scrolling carousel)"
            hint="Add 2 or more images to rotate through the homepage hero banner instead of a single image — select several files at once to upload them together."
            values={form.brand.heroImages}
            onChange={(urls) => update("brand", "heroImages", urls)}
            max={8}
          />
          <VideoUploadField
            label="Hero video (optional)"
            hint="If set, this plays as the homepage hero background instead of the image(s) above — muted, looping."
            value={form.brand.heroVideo || ""}
            onChange={(url) => update("brand", "heroVideo", url)}
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
                  placeholder={key === "home" ? SITE_NAME : label}
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
      </div>
      <div className="settings-actions">
        <span>
          <Check size={15} /> Changes are saved to this tenant only
        </span>
        <button className="button dark" onClick={() => onSave(form)}>
          <Save size={16} /> Save brand settings
        </button>
      </div>
    </section>
  );
}
function MediaPanel({ items, onUpload, onUse, onDelete }) {
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [uploadLabel, setUploadLabel] = useState("");
  const handle = async (e) => {
    const originals = Array.from(e.target.files || []);
    e.target.value = "";
    if (!originals.length) return;
    setUploading(true);
    for (let i = 0; i < originals.length; i += 1) {
      const original = originals[i];
      const countPrefix =
        originals.length > 1 ? `File ${i + 1}/${originals.length} — ` : "";
      setProgress(2);
      setUploadLabel(
        `${countPrefix}Preparing ${original.name} · ${bytesLabel(original.size)}`,
      );
      try {
        const file = await compressImageFile(original);
        setUploadLabel(
          `${countPrefix}${file.size < original.size ? `Optimized to ${bytesLabel(file.size)} · uploading…` : `Uploading ${bytesLabel(file.size)}…`}`,
        );
        const result = await uploadWithProgress(file, setProgress);
        setProgress(100);
        setUploadLabel(
          `${countPrefix}${result.compressionPercent || 0}% smaller · ready`,
        );
        onUpload(result);
      } catch (err) {
        setUploadLabel(`${countPrefix}${err.message}`);
      }
    }
    setTimeout(() => {
      setUploading(false);
      setUploadLabel("");
    }, 1800);
  };
  return (
    <section className="content-manager">
      <div className="toolbar">
        <div>
          <span className="admin-kicker">ASSET LIBRARY</span>
          <h2 className="subheading">Images that carry the story.</h2>
        </div>
        <label className="button dark small">
          <Plus size={16} /> {uploading ? "Processing…" : "Upload media"}
          <input
            hidden
            disabled={uploading}
            type="file"
            multiple
            accept="image/*,video/*,.pdf"
            onChange={handle}
          />
        </label>
      </div>
      {uploading && (
        <div className="upload-progress">
          <div>
            <span>{uploadLabel}</span>
            <b>{progress}%</b>
          </div>
          <div className="progress-track">
            <i style={{ width: `${progress}%` }} />
          </div>
          <small>
            Select multiple files to upload a batch at once. Images are
            compressed to roughly 200–500 KB. Videos are transcoded to an
            optimized MP4 (target 5–10 MB) before publishing.
          </small>
        </div>
      )}
      <div className="media-grid">
        {items.map((item) => (
          <div className="media-item" key={item.id}>
            <div className="media-preview">
              {item.type?.startsWith("image") ? (
                <img src={item.url} />
              ) : (
                <span>▶</span>
              )}
            </div>
            <b>{item.name}</b>
            <small>
              {bytesLabel(item.size)}
              {item.width && item.height
                ? ` · ${item.width}×${item.height}px`
                : ""}
              {item.compressed ? ` · ${item.compressionPercent}% smaller` : ""}{" "}
              · {item.alt}
            </small>
            {item.type?.startsWith("image") && (
              <div className="media-actions">
                <button onClick={() => onUse("logoUrl", item.url)}>
                  Use as logo
                </button>
                <button onClick={() => onUse("heroUrl", item.url)}>
                  Use as hero
                </button>
              </div>
            )}
            <button
              className="media-delete"
              title="Delete"
              onClick={() => onDelete(item)}
            >
              <Trash2 size={14} />
            </button>
          </div>
        ))}
        {!items.length && (
          <div className="media-empty">
            <Image size={30} />
            <h3>Your library is ready</h3>
            <p>
              Upload hero images, project photography and brand assets here.
            </p>
          </div>
        )}
      </div>
    </section>
  );
}

createRoot(document.getElementById("root")).render(
  location.pathname.startsWith("/admin") ? <AdminApp /> : <PublicSite />,
);
