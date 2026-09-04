# Gagnant Promoters — Website Platform

A configuration-driven website + admin dashboard for Gagnant Promoters: a
React/Vite public site backed by an Express API, with all content stored in
MongoDB Atlas and managed through a built-in admin dashboard — no code
changes needed to update text, images, services, projects, clients or leads.

```
Dynamic_Website/
├── backend/             Express API
│   ├── index.js         App entry point, routes, middleware
│   ├── store.js         MongoDB Atlas data layer (requires MONGO_URI)
│   ├── media.js         Image/video compression & transcoding
│   ├── mailer.js        Optional SMTP lead-notification emails
│   ├── .env.example     → copy to .env
│   └── uploads/         (auto-created) uploaded media lives here
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

Admin login (first run):

```
Email: info@gagnantpromoters.com
Password: admin123
```

**Change this password before going live.** Once logged in, click the
avatar in the top-right corner of the admin dashboard → change your
password (and display name) there — no code or database access needed.
Passwords are hashed (bcrypt); a legacy plain-text password is upgraded to
a hash automatically the first time it's used to log in.

## How content management works

Everything editable lives behind `/admin` and is saved straight to MongoDB
Atlas — there's no separate "publish" or redeploy step for content changes.

| Section | Controls |
|---|---|
| **Brand & settings** | Logo, hero images/video, colors, tagline, contact details (including a secondary email), social links, company overview/vision/mission/values, per-page banner images, SEO title/description per page |
| **Services** | The 7 service cards shown on the homepage and `/services` |
| **Projects** | Portfolio entries shown on `/projects`, with an optional YouTube video |
| **Blogs** | Articles shown on `/blog` |
| **Testimonials** | Rotating quote carousel on the homepage |
| **Clients** | Logo grid shown on the homepage, About and Projects pages |
| **Leads** | Enquiries submitted through the contact form on the site |
| **Media library** | Every uploaded image/video, with a "use as logo/hero" shortcut |

The site has six fixed pages — Home, About Us, Services, Projects, Blog and
Contact Us — and their content comes entirely from the sections above
(Settings, Services, Projects, Blog, Testimonials). There is no separate
page-builder for extra standalone pages; adding one would be a code change.

Projects and Services each carry a fixed `category` (chosen from a dropdown
in the admin, not free text) — Projects on `/` and `/projects` are grouped
into one row per category, so keeping categories consistent (rather than
letting typos create new one-off categories) is what keeps those rows
sensible.

## Environment variables

### `backend/.env`

| Variable | Purpose | Default |
|---|---|---|
| `PORT` | API port | `8787` |
| `NODE_ENV` | `development` or `production` | `development` |
| `APP_URL` | Public base URL, used in `sitemap.xml`/`robots.txt`. Falls back to `FRONTEND_URL` if not set — set to `https://gagnantpromoters.com` in production | `http://localhost:8787` |
| `JWT_SECRET` | Signs admin session tokens — **must** be a long random string in production | *(pre-generated for you)* |
| `CORS_ORIGIN` | Comma-separated allowed origins. Falls back to `FRONTEND_URL` (as a single origin) if not set, or `*` if neither is set — use `*` only for local dev | `*` |
| `FRONTEND_URL` | The public site's own URL — doubles as the fallback for `APP_URL` and `CORS_ORIGIN` above, and is used to build an "open the admin" link in new-lead emails | `http://localhost:5173` |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_SECURE` / `SMTP_USER` / `SMTP_PASS` / `SMTP_FROM` / `SMTP_FROM_NAME` | Optional — enables email alerts for new leads. For Gmail/Google Workspace: host `smtp.gmail.com`, port `465`, `SMTP_SECURE=true`, and a 16-character [App Password](https://myaccount.google.com/apppasswords) (not your normal password) as `SMTP_PASS` | *(empty `SMTP_PASS` = disabled)* |
| `LEAD_NOTIFY_TO` | Fallback recipient for new-lead emails if a tenant has no contact email set (the site's Contact email, `info@gagnantpromoters.com`, is used first) | *(empty)* |
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

Uploaded images are kept in sync with where they're actually used:
- Deleting a service/project/blog post that has a cover image also deletes that image file — but only if nothing else references it (e.g. it's not also your homepage hero image).
- Deleting an image directly from the Media Library clears it from anywhere it was in use (brand logo/hero, content cover images) so the site never shows a broken image afterward.

## Media pipeline

Images are compressed in the browser before upload when possible, then
normalized again on the server with Sharp to WebP, targeting ≤200 KB.
Videos up to 100 MB are transcoded with FFmpeg to MP4 (H.264/AAC, max width
1280px, fast-start streaming); the upload ceiling is 110 MB.

The database is MongoDB Atlas (`backend/store.js`), with one collection per
resource. Uploaded media lives on local disk (`backend/uploads`); for a
larger deployment, consider moving that to S3-compatible object storage —
the content model is already tenant-scoped (`tenantId` on every record), so
the storage adapter can change without touching the public site or admin UI.
