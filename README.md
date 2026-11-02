# Gagnant Promoters — Website Platform

A configuration-driven website + admin dashboard for Gagnant Promoters: a
React/Vite public site backed by an Express API, with all content stored in
MongoDB Atlas and managed through a built-in admin dashboard — no code
changes needed to update text, images, services, projects, clients or leads.

```
Dynamic_Website/
├── backend/             Express API
│   ├── server.js        App entry point, routes, middleware
│   ├── store.js         MongoDB Atlas data layer (requires MONGO_URI)
│   ├── media.js         Image/video compression & transcoding
│   ├── mailer.js        Optional SMTP lead-notification emails
│   ├── .env.example     → copy to .env
│   └── uploads/         (auto-created) scratch space while uploads are processed
├── frontend/            React + Vite app
│   ├── src/main.jsx     Public site + admin dashboard (single app, two views)
│   ├── src/styles.css
│   ├── vite.config.js
│   └── .env.example     → copy to .env
└── package.json         Root orchestrator (installs + runs both apps)
```

## Quick start (local)

Requires Node.js **18.18+**.

```bash
npm install                # installs the small root-level "concurrently" tool
npm run install:all        # installs backend/ and frontend/ dependencies separately
cp backend/.env.example backend/.env      # fill in real values (MONGO_URI, JWT_SECRET, ...)
cp frontend/.env.example frontend/.env    # defaults are fine for local dev
npm run dev                # runs backend (:8787) and frontend (:5173) together
```

Open:

- Public site: http://localhost:5173
- Admin dashboard: http://localhost:5173/admin
- API health check: http://localhost:8787/api/health

First admin account: there is no built-in login. On a brand-new database
the first admin is created from `ADMIN_EMAIL` / `ADMIN_PASSWORD` in
`backend/.env` (password: 10+ characters, letters and numbers) — remove
`ADMIN_PASSWORD` from the file once you've signed in. An existing account
that still has a weak or default password (such as the old `admin123`) can
sign in, but must set a new password before it can do anything else.

Change your name or password, or sign out on every device, from the avatar in
the top-right corner of the admin dashboard.

## How content management works

Everything editable lives behind `/admin` and is saved straight to MongoDB
Atlas — there's no separate "publish" or redeploy step for content changes.

| Section | Controls |
|---|---|
| **Brand & settings** | Company name, logo, hero banner/video, colors, tagline, announcement bar, contact details (including a secondary email), social links, company overview/vision/mission/values, per-page banner images, SEO title/description per page |
| **Services** | The 7 service cards shown on the homepage and `/services` |
| **Projects** | Portfolio entries shown on `/projects`, with an optional YouTube video |
| **Blogs** | Articles shown on `/blog` |
| **Testimonials** | Rotating quote carousel on the homepage |
| **Clients** | Logo grid shown on the homepage, About and Projects pages |
| **Business cards** | Digital business cards for team members at `/card/<name>` — call / WhatsApp / email / directions, "Save contact" (.vcf with photo), QR code, share, and a "share your details" form that lands in Leads. The QR icon on each row gives the link, a downloadable QR PNG and view/save stats |
| **Leads** | Enquiries from the contact form and business cards — filter by status, export CSV, delete |
| **Users** (owners only) | Give other people access. **Owner** = everything incl. managing users; **Admin** = the whole website but not users. A new user gets a branded welcome email with a temporary password (expires in 7 days) and must choose their own at first sign-in. Owners can rename, change access, send a new temporary password, disable/enable or delete users. There's always at least one owner, and you can't lock yourself out |
| **Website content** | Every piece of text on the public site — menu labels, homepage hero, trust strip, intro, key figures, "how we work" steps, section headings, page headers, contact copy, detail-page copy, search defaults and the service/project category lists. Empty fields hide their block; lists can be added to, reordered and deleted |
| **Google reviews** (in Brand & settings) | Live Google rating + latest reviews on the homepage, Contact page and business cards. Paste a Places API key, use "Find your business" to fill the Place ID, then "Save & sync now" |

The homepage banner (Brand & settings → Homepage banner) takes any mix of
images and videos, in the order you set. One item is a still banner (a lone
video loops); two or more become a slider — images show for 6 seconds,
videos play to the end — with arrows, dots and swipe. With nothing uploaded
the built-in brand artwork is shown.

Google reviews come from the Places API (New) — enable it for your key in
Google Cloud Console. Google is called at most once per "refresh" interval
(30 min by default); visitors get the cached copy, and the last good result
is kept in MongoDB so an outage or quota hiccup doesn't empty the section.
The API key stays on the server — it is never sent to the browser.

The site has six fixed pages — Home, About Us, Services, Projects, Blog and
Contact Us. Nothing they display is written into the code: every word comes
from the database via the sections above. A brand-new install starts empty;
a site that existed before this change had its wording copied into the
database once on upgrade (`backend/migrations.js`), so it kept looking the
same and is now fully editable. Public pages refresh their data in the
background, so admin edits show up without visitors reloading.

Projects and Services each carry a `category` chosen from the lists under
Website content → Categories — Projects on `/` and `/projects` are grouped
into one row per category, so a fixed list keeps those rows consistent.

## Security

- **Admin sessions** are a signed JWT in an `httpOnly`, `SameSite=Strict`
  (and, over HTTPS, `Secure`) cookie — page scripts can never read it. Every
  change request must also carry a per-session CSRF token. Sessions last 8
  hours; changing your password or "Sign out all devices" revokes every
  other session immediately.
- **Logins**: bcrypt-hashed passwords, a password policy, account lockout
  after 5 failed attempts (15 minutes), rate limits per IP, and identical
  responses for unknown emails. Sign-ins, failures, lockouts and password
  changes are written to the audit log with IP and browser.
- **Input**: every request body is stripped of MongoDB operators and
  prototype-pollution keys, and each content type only accepts its own
  whitelisted, length-limited fields; links are restricted to http(s),
  site-relative, `mailto:` and `tel:` (no `javascript:`). Public forms
  have a honeypot and refuse cross-site posts.
- **Uploads** are checked by their actual contents (not the claimed type),
  SVG is refused, files get random names with an extension that matches
  what they really are, and `/uploads` is served with a sandboxing CSP.
- **Headers**: Content-Security-Policy, HSTS (production), frame,
  referrer and permissions policies, no `X-Powered-By`.
- **Secrets**: production refuses to start without a strong `JWT_SECRET`;
  the Google API key never leaves the server.

(WS-Security is the SOAP/XML web-services standard; this app's API is
REST/JSON, so the equivalent protections above are what apply here.)

## Environment variables

### `backend/.env`

| Variable | Purpose | Default |
|---|---|---|
| `PORT` | API port | `8787` |
| `NODE_ENV` | `development` or `production` | `development` |
| `APP_URL` | Public base URL, used in `sitemap.xml`/`robots.txt`. Falls back to `FRONTEND_URL` if not set — set to `https://gagnantpromoters.com` in production | `http://localhost:8787` |
| `JWT_SECRET` | Signs admin sessions — **required in production** (32+ random characters; the server won't start without it) | *(random per run in development)* |
| `CORS_ORIGIN` | Comma-separated allowed origins. Falls back to `FRONTEND_URL` (as a single origin) if not set, or `*` if neither is set — use `*` only for local dev | `*` |
| `FRONTEND_URL` | The public site's own URL — doubles as the fallback for `APP_URL` and `CORS_ORIGIN` above, and is used to build an "open the admin" link in new-lead emails | `http://localhost:5173` |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_SECURE` / `SMTP_USER` / `SMTP_PASS` / `SMTP_FROM` / `SMTP_FROM_NAME` | Enables email: new-lead alerts and the welcome / password-reset emails for new users (without it, the admin shows a new user's temporary password once, to pass on yourself). For Gmail/Google Workspace: host `smtp.gmail.com`, port `465`, `SMTP_SECURE=true`, and a 16-character [App Password](https://myaccount.google.com/apppasswords) (not your normal password) as `SMTP_PASS` | *(empty `SMTP_PASS` = disabled)* |
| `MAIL_OUTBOX_DIR` | Development only: save outgoing emails (lead alerts, welcome/reset emails) as files in this folder instead of sending them, to preview templates | *(empty)* |
| `LEAD_NOTIFY_TO` | Fallback recipient for new-lead emails if a tenant has no contact email set (the site's Contact email, `info@gagnantpromoters.com`, is used first) | *(empty)* |
| `GOOGLE_PLACES_API_KEY` | Optional fallback for Google reviews if no key is saved in the admin | *(empty)* |
| `UPLOAD_DIR` | Scratch folder for uploads while they're processed (the files themselves are stored in MongoDB). Also where older installs kept their uploads — those are copied into MongoDB automatically on start | `backend/uploads` |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` / `ADMIN_NAME` | Creates the first admin account on an empty database (ignored once any admin exists) | *(empty)* |
| `COMPANY_NAME` | Company name for a brand-new install (editable later in Brand & settings) | *(empty)* |
| `COOKIE_SECURE` | Set to `false` only to test the production build over plain HTTP on a LAN | *(auto)* |
| `MONGO_URI` | **Required.** Your MongoDB Atlas connection string (include a database name in the path). The server won't start without it | *(empty — you must set this)* |

### `frontend/.env`

| Variable | Purpose | Default |
|---|---|---|
| `VITE_API_URL` | Where the browser calls the API. Keep as `/api` when frontend and backend share a domain; set to the full backend URL when they're deployed separately | `/api` |
| `VITE_DEV_PROXY_TARGET` | Only used by `npm run dev`, tells Vite's dev proxy where the backend is | `http://localhost:8787` |
| `VITE_PORT` | Local Vite dev server port | `5173` |

## Production build

```bash
npm run build                    # builds frontend/dist
NODE_ENV=production npm start    # starts the backend, which serves frontend/dist
```

The Express server auto-detects `frontend/dist` and serves it, with a
catch-all route so client-side routes (`/admin`, `/services/:slug`, etc.)
work on refresh. Deployment/hosting is handled outside this repo.

## Image cleanup

There is no separate media library — images and videos are uploaded right
where they're used, and the files on disk are kept in sync automatically:
- Replacing or removing an image/video (a cover image, card photo, logo, banner slide, page banner…) deletes the old file.
- Deleting a service/project/blog post/card deletes its images too.
- Either way a file is only deleted when nothing else still uses it (e.g. the same photo used as a cover and a banner slide stays until both are gone).

## Media pipeline

Images are compressed in the browser before upload when possible, then
normalized again on the server with Sharp to WebP, targeting ≤200 KB.
Videos up to 100 MB are transcoded with FFmpeg to MP4 (H.264/AAC, max width
1280px, fast-start streaming); the upload ceiling is 110 MB.

The database is MongoDB Atlas (`backend/store.js`), with one collection per
resource. Uploaded media (logo, banners, page banners, photos, videos, PDFs)
is stored in the database too, using GridFS (the `uploads.files` /
`uploads.chunks` collections), so MongoDB alone holds the whole site — a
server can be replaced or moved without copying any files. Files are served
at the same `/uploads/<name>` URLs as before, with long-lived caching and
byte-range support so videos stream and seek. On start, any file a media
record points at that still only exists in `backend/uploads` (from before
this change) is copied into MongoDB once; the disk copy is left as a backup
and can be deleted afterwards.
