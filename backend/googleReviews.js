// Google Business reviews, fetched live from the Places API (New).
//
// Configured per tenant from the admin dashboard (Brand & settings → Google
// reviews): a Place ID plus an API key (or GOOGLE_PLACES_API_KEY in .env).
// Google is only called once per `cacheMinutes` per tenant — every visitor in
// between gets the in-memory copy — and the last good result is also kept in
// Mongo, so if Google is briefly unreachable (or the key hits its quota) the
// site keeps showing the most recent reviews instead of an empty section.
const PLACES_API = (process.env.GOOGLE_PLACES_API_BASE || "https://places.googleapis.com/v1").replace(/\/$/, "");

const DEFAULTS = {
  enabled: false,
  placeId: "",
  reviewUrl: "",
  showOnHome: true,
  showOnContact: true,
  showOnCards: true,
  minRating: 4,
  maxReviews: 6,
  cacheMinutes: 30
};

const config = (settings) => ({ ...DEFAULTS, ...(settings?.googleReviews || {}) });
const apiKeyFor = (cfg) => cfg.apiKey || process.env.GOOGLE_PLACES_API_KEY || "";
const clamp = (value, min, max, fallback) => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};
// A pasted "write a review" short link (g.page/r/…) wins; otherwise build
// Google's standard review-dialog URL from the Place ID.
const writeReviewUrl = (cfg) =>
  cfg.reviewUrl || (cfg.placeId ? `https://search.google.com/local/writereview?placeid=${encodeURIComponent(cfg.placeId)}` : "");

async function placesRequest(path, apiKey, { method = "GET", fieldMask, body } = {}) {
  const response = await fetch(`${PLACES_API}${path}`, {
    method,
    headers: {
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": fieldMask,
      ...(body ? { "Content-Type": "application/json" } : {})
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(10000)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error?.message || `Google Places API responded with status ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return data;
}

async function fetchPlace(placeId, apiKey) {
  const data = await placesRequest(`/places/${encodeURIComponent(placeId)}?languageCode=en`, apiKey, {
    fieldMask: "id,displayName,rating,userRatingCount,googleMapsUri,reviews"
  });
  return {
    placeId: data.id || placeId,
    name: data.displayName?.text || "",
    rating: data.rating ?? null,
    userRatingCount: data.userRatingCount ?? 0,
    mapsUrl: data.googleMapsUri || "",
    reviews: (data.reviews || []).map((r) => ({
      id: r.name,
      rating: r.rating || 0,
      text: r.text?.text || r.originalText?.text || "",
      relativeTime: r.relativePublishTimeDescription || "",
      publishTime: r.publishTime || null,
      author: r.authorAttribution?.displayName || "Google user",
      authorUrl: r.authorAttribution?.uri || "",
      authorPhoto: r.authorAttribution?.photoUri || "",
      reviewUrl: r.googleMapsUri || ""
    })),
    fetchedAt: new Date().toISOString()
  };
}

async function searchPlaces(query, apiKey) {
  const data = await placesRequest("/places:searchText", apiKey, {
    method: "POST",
    fieldMask: "places.id,places.displayName,places.formattedAddress,places.rating,places.userRatingCount",
    body: { textQuery: query, languageCode: "en" }
  });
  return (data.places || []).slice(0, 6).map((p) => ({
    placeId: p.id,
    name: p.displayName?.text || "",
    address: p.formattedAddress || "",
    rating: p.rating ?? null,
    userRatingCount: p.userRatingCount ?? 0
  }));
}

function createReviewService(store) {
  const memory = new Map(); // tenantId -> { placeId, snapshot, expiresAt }
  const inflight = new Map(); // tenantId -> Promise, so a burst of visitors triggers one Google call

  async function loadSnapshot(tenantId, cfg, { force }) {
    const cached = memory.get(tenantId);
    if (!force && cached && cached.placeId === cfg.placeId && cached.expiresAt > Date.now()) return { snapshot: cached.snapshot, stale: false };
    if (!inflight.has(tenantId)) {
      const ttl = clamp(cfg.cacheMinutes, 5, 1440, DEFAULTS.cacheMinutes) * 60 * 1000;
      inflight.set(tenantId, fetchPlace(cfg.placeId, apiKeyFor(cfg))
        .then(async (snapshot) => {
          memory.set(tenantId, { placeId: cfg.placeId, snapshot, expiresAt: Date.now() + ttl });
          await store.upsert("reviewCache", tenantId, { tenantId, placeId: cfg.placeId, snapshot, lastError: "" }).catch(() => {});
          return snapshot;
        })
        .finally(() => inflight.delete(tenantId)));
    }
    try {
      return { snapshot: await inflight.get(tenantId), stale: false };
    } catch (error) {
      console.warn(`[google-reviews] Could not refresh reviews for tenant ${tenantId}: ${error.message}`);
      const saved = cached?.placeId === cfg.placeId ? { snapshot: cached.snapshot } : await store.find("reviewCache", { id: tenantId }).catch(() => null);
      await store.upsert("reviewCache", tenantId, { lastError: error.message, lastErrorAt: new Date().toISOString() }).catch(() => {});
      if (saved?.snapshot && (saved.placeId === undefined || saved.placeId === cfg.placeId)) {
        // Retry Google again in a few minutes rather than on every request.
        memory.set(tenantId, { placeId: cfg.placeId, snapshot: saved.snapshot, expiresAt: Date.now() + 5 * 60 * 1000 });
        return { snapshot: saved.snapshot, stale: true, error };
      }
      return { snapshot: null, stale: true, error };
    }
  }

  // What the public site gets: never the API key, and reviews already
  // filtered/limited to what the admin chose to show.
  async function getPublic(tenantId, settings, { force = false, throwOnError = false } = {}) {
    const cfg = config(settings);
    const base = {
      enabled: Boolean(cfg.enabled),
      display: { home: cfg.showOnHome !== false, contact: cfg.showOnContact !== false, cards: cfg.showOnCards !== false },
      writeReviewUrl: writeReviewUrl(cfg),
      live: false,
      rating: null,
      userRatingCount: 0,
      reviews: []
    };
    if (!cfg.enabled) return base;
    if (!cfg.placeId || !apiKeyFor(cfg)) {
      if (throwOnError) throw new Error(!cfg.placeId ? "Add your Google Place ID first." : "Add a Google Places API key first.");
      return base;
    }
    const { snapshot, stale, error } = await loadSnapshot(tenantId, cfg, { force });
    if (error && throwOnError) throw error;
    if (!snapshot) return base;
    const minRating = clamp(cfg.minRating, 1, 5, DEFAULTS.minRating);
    const maxReviews = clamp(cfg.maxReviews, 1, 10, DEFAULTS.maxReviews);
    return {
      ...base,
      live: true,
      stale,
      name: snapshot.name,
      rating: snapshot.rating,
      userRatingCount: snapshot.userRatingCount,
      mapsUrl: snapshot.mapsUrl,
      fetchedAt: snapshot.fetchedAt,
      reviews: snapshot.reviews.filter((r) => r.rating >= minRating && r.text).slice(0, maxReviews)
    };
  }

  const invalidate = (tenantId) => memory.delete(tenantId);

  return { getPublic, invalidate, searchPlaces, apiKeyFor: (settings) => apiKeyFor(config(settings)) };
}

module.exports = { createReviewService };
