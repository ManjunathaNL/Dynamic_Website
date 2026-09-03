# Gagnant Promoters — Dynamic Website Platform

A runnable, configuration-driven multi-tenant CMS: a React/Vite public
website + admin dashboard, backed by an Express REST API.

```
gagnant-promoters-platform/
├── backend/            Express API (was "server/")
│   ├── index.js        App entry point, routes, middleware
│   ├── store.js        MongoDB Atlas data layer (requires MONGO_URI)
│   ├── media.js        Image/video compression & transcoding
│   ├── mailer.js        Optional SMTP lead-notification emails
│   ├── package.json
│   ├── .env.example      → copy to .env
│   └── uploads/          (auto-created) uploaded media lives here
├── frontend/           React + Vite app (was "client/")
│   ├── src/main.jsx     Public site + admin dashboard (single app, two views)
│   ├── src/styles.css
│   ├── index.html        Fixed — now a valid HTML5 document with SEO meta tags
│   ├── public/favicon.svg
│   ├── vite.config.js
│   ├── package.json
│   └── .env.example      → copy to .env
├── scripts/setup-env.js  Generates .env files with a random JWT secret
├── package.json          Root orchestrator (installs + runs both apps)
├── Dockerfile             Multi-stage build (frontend build → backend runtime)
├── docker-compose.yml
└── .gitignore
```

## What changed from the zip you sent

- **Renamed** `server/` → `backend/` and `client/` → `frontend/` throughout
  (code, configs, Dockerfile, docker-compose, .gitignore).
- **Fixed a real bug**: `frontend/index.html` was missing `<!DOCTYPE html>`,
  `<head>`, `<body>` and any meta tags — just a bare `<div id="root">` and a
  script tag. It's now a proper HTML5 document with viewport, title,
  description and Open Graph tags (also added a favicon so the icon request
  doesn't 404).
- **Dropped npm workspaces** in favor of two independent apps. With
  workspaces, `npm install` at the root hoists dependencies into a single
  top-level `node_modules`, so `backend/` and `frontend/` never actually got
  their own `node_modules` folders — which is what you ran into. Now
  `npm run install:all` runs `npm install` inside each folder separately, so
  `backend/node_modules` and `frontend/node_modules` are real, and each app
  can also be deployed on its own (e.g. frontend on Vercel, backend on
  Render) without dragging the other along.
- **Added real `.env` files** (not just `.env.example`) in both `backend/`
  and `frontend/`, pre-filled with working local-dev defaults — including a
  randomly generated `JWT_SECRET` — so it runs immediately after install.
- **Added missing production hardening** that the master plan calls for but
  the zip didn't yet have:
  - Rate limiting on login, the public contact form, and media uploads
    (`express-rate-limit`)
  - Configurable CORS via `CORS_ORIGIN` instead of allowing every origin
  - Response compression (`compression`)
  - Request logging (`morgan`)
  - Optional SMTP email notification on every new lead (`mailer.js`,
    `nodemailer`) — safely disabled until you set SMTP credentials, so
    nothing breaks if you skip it
  - A startup warning if `JWT_SECRET` is still the default value in
    production
  - A Docker `HEALTHCHECK`
- Everything else — the data model, API routes, admin dashboard and media
  compression pipeline — is unchanged and was already working; it's copied
  over as-is.
- **Migrated the database off the local JSON file to MongoDB Atlas.**
  `backend/store.js` now reads/writes real MongoDB collections instead of
  `backend/data/db.json`. The server seeds only the bare minimum needed to
  log in on a brand-new cluster (one super-admin account, one tenant, blank
  settings) — no placeholder services/projects/blogs/testimonials; that
  content is entered for real through the admin dashboard.

## Quick start (local)

Requires Node.js **18.18+**.

```bash
npm install                # installs the small root-level "concurrently" tool
npm run install:all        # installs backend/ and frontend/ dependencies separately
npm run setup:env          # creates backend/.env and frontend/.env (skips if already there)
npm run dev                # runs backend (:8787) and frontend (:5173) together
```

(`npm run setup:env` isn't needed for this download — working `.env` files
are already included — but it's there for future teammates/fresh clones.)

Open:

- Public site: http://localhost:5173
- Admin dashboard: http://localhost:5173/admin
- API health check: http://localhost:8787/api/health

Demo admin credentials:

```
Email: admin@gagnantpromoters.com
Password: admin123
```

**Change the demo password and `JWT_SECRET` before production.**

## Environment variables

### `backend/.env`

| Variable | Purpose | Default |
|---|---|---|
| `PORT` | API port | `8787` |
| `NODE_ENV` | `development` or `production` | `development` |
| `APP_URL` | Public base URL, used in `sitemap.xml` | `http://localhost:8787` |
| `JWT_SECRET` | Signs admin session tokens — **must** be a long random string in production | *(pre-generated for you)* |
| `CORS_ORIGIN` | Comma-separated allowed origins, or `*` for local dev | `*` |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` / `SMTP_FROM` | Optional — enables email alerts for new leads. For Gmail: host `smtp.gmail.com`, port `465`, and a 16-character [App Password](https://myaccount.google.com/apppasswords) (not your normal password) | *(empty = disabled)* |
| `LEAD_NOTIFY_TO` | Fallback recipient if a tenant has no contact email set | *(empty)* |
| `MONGO_URI` | **Required.** Your MongoDB Atlas connection string (include a database name in the path). The server won't start without it | *(empty — you must set this)* |

## Image cleanup

Uploaded images are kept in sync with where they're actually used:
- Deleting a service/project/blog post that has a cover image also deletes that image file — but only if nothing else references it (e.g. it's not also your homepage hero image).
- Deleting an image directly from the Media Library clears it from anywhere it was in use (brand logo/hero, content cover images) so the site never shows a broken image afterward.

### `frontend/.env`

| Variable | Purpose | Default |
|---|---|---|
| `VITE_API_URL` | Where the browser calls the API. Keep as `/api` when frontend and backend share a domain (e.g. Docker/VPS); set to the full backend URL when they're deployed separately | `/api` |
| `VITE_DEV_PROXY_TARGET` | Only used by `npm run dev`, tells Vite's dev proxy where the backend is | `http://localhost:8787` |
| `VITE_PORT` | Local Vite dev server port | `5173` |

## Production build

```bash
npm run build               # builds frontend/dist
NODE_ENV=production npm start   # starts the backend, which serves frontend/dist
```

The Express server auto-detects `frontend/dist` and serves it, with a
catch-all route so client-side routes (`/admin`, `/services/:slug`, etc.)
work on refresh.

## Docker

```bash
cp backend/.env.example backend/.env   # edit JWT_SECRET, APP_URL, etc.
docker compose up --build
```

This builds the frontend in one stage, copies it into the backend's runtime
image, and persists `backend/uploads` (media) in a named volume so it
survives container restarts. Content itself lives in MongoDB Atlas
(`MONGO_URI` in `backend/.env`), not in the container.

See `DEPLOYMENT.md` for platform-specific notes (Render/Railway/VPS/Vercel).

## Production hardening path (unchanged from the original plan)

Images are compressed in the browser before upload when possible, then
normalized again on the server with Sharp to WebP, targeting ≤200 KB.
Videos up to 100 MB are transcoded with FFmpeg to MP4 (H.264/AAC, max width
1280px, fast-start streaming); the upload ceiling is 110 MB.

The database is MongoDB Atlas (`backend/store.js`), with one collection per
resource. Uploaded media still lives on local disk (`backend/uploads`); for
a larger production deployment, move that to S3-compatible object storage —
the content model is already tenant-scoped (`tenantId` on every record), so
the storage adapter can change without touching the public site or admin UI.
