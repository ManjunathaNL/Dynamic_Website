# ---- Stage 1: build the frontend --------------------------------------
FROM node:20-alpine AS frontend-build
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm install
COPY frontend/ ./
RUN npm run build

# ---- Stage 2: production image -----------------------------------------
FROM node:20-alpine AS production
WORKDIR /app

# ffmpeg-static and sharp need these for native builds/runtime on alpine
RUN apk add --no-cache libc6-compat vips-dev

WORKDIR /app/backend
COPY backend/package*.json ./
RUN npm install --omit=dev
COPY backend/ ./

# Bring in the built frontend so the backend can serve it as static files
COPY --from=frontend-build /app/frontend/dist /app/frontend/dist

ENV NODE_ENV=production
EXPOSE 8787

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "require('http').get('http://localhost:' + (process.env.PORT || 8787) + '/api/v1/health', r => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"

CMD ["node", "index.js"]
