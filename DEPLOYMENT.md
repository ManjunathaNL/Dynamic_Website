# Deployment guide

Pick whichever matches your hosting setup. In every case, set real values
in `backend/.env` first (especially `JWT_SECRET`, `APP_URL` and
`MONGO_URI` — your MongoDB Atlas connection string), and change the demo
admin password (`backend/store.js` seed data, `users[0].password`, or add
a proper "change password" flow before going live).

## Option A — Single server / VPS with Docker (simplest)

```bash
cp backend/.env.example backend/.env   # fill in JWT_SECRET, APP_URL, CORS_ORIGIN, SMTP if wanted
docker compose up --build -d
```

Put this behind a reverse proxy (Nginx or Caddy) for TLS. Example Caddy
snippet:

```
gagnantpromoters.com {
  reverse_proxy localhost:8787
}
```

Uploaded media persists in the `platform-uploads` Docker volume. Content
itself lives in MongoDB Atlas via `MONGO_URI`, not in a local volume.

## Option B — Single server / VPS without Docker

```bash
npm run install:all
npm run build
NODE_ENV=production PORT=8787 JWT_SECRET=... APP_URL=https://yourdomain.com npm start
```

Run it under a process manager (pm2, systemd) so it restarts on crash/reboot,
e.g.:

```bash
npm install -g pm2
pm2 start backend/index.js --name gagnant-api --cwd backend
pm2 save
```

## Option C — Split hosting (backend on Render/Railway/Fly, frontend on Vercel/Netlify)

1. **Backend**: deploy the `backend/` folder as a Node web service.
   - Build command: `npm install`
   - Start command: `npm start`
   - Set env vars from `backend/.env.example` in the platform's dashboard
     (`JWT_SECRET`, `APP_URL` = your backend's public URL,
     `CORS_ORIGIN` = your frontend's public URL, `MONGO_URI` = your Atlas
     connection string, optional SMTP vars).
   - Attach persistent disk storage for `backend/uploads` if the platform
     supports it (Render disks, Railway volumes) — otherwise uploaded media
     will be lost on redeploy. Content itself is safe across redeploys
     since it lives in MongoDB Atlas, not on local disk. For a fully
     stateless deploy, move uploads to S3/Cloudinary as noted in the README.

2. **Frontend**: deploy the `frontend/` folder as a static site.
   - Build command: `npm install && npm run build`
   - Output directory: `dist`
   - Set `VITE_API_URL` to your backend's full API URL, e.g.
     `https://gagnant-api.onrender.com/api`.

3. Point your domain's DNS at the frontend host, and use a subdomain (e.g.
   `api.yourdomain.com`) for the backend host.

## Pre-launch checklist

- [ ] `JWT_SECRET` changed to a long random value
- [ ] Demo admin password changed
- [ ] `MONGO_URI` points at your production Atlas cluster (with its IP
      access list / network config allowing your host to connect)
- [ ] `APP_URL` set to the real production domain (affects `sitemap.xml`)
- [ ] `CORS_ORIGIN` restricted to your real frontend domain(s), not `*`
- [ ] SMTP configured if you want email alerts for new leads (optional)
- [ ] TLS/HTTPS enabled in front of the backend
- [ ] Persistent storage attached for `backend/uploads`, or migrated to
      S3-compatible object storage for a fully stateless deploy
- [ ] `npm run build` succeeds locally with no errors before deploying
