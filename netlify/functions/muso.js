/*
  Muso.AI proxy for subeloneo.com
  ---------------------------------
  Muso runs two separate APIs. This function speaks both and prefers the better one.

    WORKSPACE  /v4a   header: workspace-api-key   — needs a Pro/Business plan.
               Scoped to profiles in your workspace roster, and the only one with
               ANALYTICS: real stream, Shazam and view totals.

    PUBLIC     /v4    header: x-api-key           — sales-gated (aaron@muso.ai).
               Full catalog search, but no stream data of any kind.

  Env vars (Netlify → Site settings → Environment variables):
    MUSO_WORKSPACE_KEY  workspace key — preferred, unlocks the live stream count
    MUSO_API_KEY        public/full-catalog key — fallback, no streams
    MUSO_PROFILE_ID     optional — Súbelo NEO's Muso UUID (skips roster lookup)
    MUSO_PROFILE_NAME   optional — name to match in the roster, default "Súbelo NEO"
    MUSO_STREAMS        optional — manual stream total, used only when the API
                        gives none (i.e. on the public key). Shown with a "+".

  Never returns a non-200: if no key is set or Muso is down, the page keeps its
  static numbers instead of showing an error.
*/

const HOST = "https://api.developer.muso.ai";
const CACHE_SECONDS = 60 * 60 * 6; // 6h — these numbers move slowly
const DEFAULT_NAME = "Súbelo NEO";

// Warm-invocation cache. Netlify reuses containers, so this spares the API most
// of the traffic even before the CDN cache kicks in.
let warm = { at: 0, payload: null };

function ok(payload, seconds) {
  return {
    statusCode: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": `public, max-age=0, s-maxage=${seconds}, stale-while-revalidate=86400`,
      "access-control-allow-origin": "*"
    },
    body: JSON.stringify(payload)
  };
}

/* One client per API flavour, so the rest of the file never repeats itself. */
function client() {
  const ws = process.env.MUSO_WORKSPACE_KEY;
  const pub = process.env.MUSO_API_KEY;
  if (!ws && !pub) return null;
  const workspace = Boolean(ws);
  const base = HOST + (workspace ? "/v4a" : "/v4");
  const header = workspace ? "workspace-api-key" : "x-api-key";

  return {
    workspace,
    async get(path, init) {
      const res = await fetch(base + path, {
        ...init,
        headers: { [header]: ws || pub, "content-type": "application/json", ...(init && init.headers) }
      });
      if (!res.ok) throw new Error(`muso ${path} → ${res.status}`);
      const json = await res.json();
      return json.data !== undefined ? json.data : json;
    }
  };
}

const norm = (s) =>
  (s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");

async function resolveProfileId(api) {
  if (process.env.MUSO_PROFILE_ID) return process.env.MUSO_PROFILE_ID;
  const name = process.env.MUSO_PROFILE_NAME || DEFAULT_NAME;

  // The workspace API has no /search — profiles come from your own roster.
  const items = api.workspace
    ? await api.get("/workspace/roster")
    : ((await api.get("/search", {
        method: "POST",
        body: JSON.stringify({ keyword: name, type: ["profile"], limit: 5 })
      })).profiles || {}).items;

  const list = Array.isArray(items) ? items : [];
  const hit = list.find((p) => norm(p.name) === norm(name)) || list[0];
  if (!hit) throw new Error(`no Muso profile matching "${name}"`);
  return hit.id;
}

const num = (v) => (Number.isFinite(+v) && +v > 0 ? +v : null);

exports.handler = async function () {
  const api = client();
  if (!api) return ok({ ok: false, reason: "no-key" }, 60);

  if (warm.payload && Date.now() - warm.at < CACHE_SECONDS * 1000) {
    return ok(warm.payload, CACHE_SECONDS);
  }

  try {
    const id = await resolveProfileId(api);

    const [profile, analytics, tracks] = await Promise.all([
      api.get(`/profile/${id}`),
      // Analytics is workspace-only; on the public key we simply skip it.
      api.workspace ? api.get(`/analytics/profile/${id}`).catch(() => null) : null,
      api.workspace
        ? api.get(`/analytics/profile/${id}/tracks?sortKey=streams&sortDirection=DESC&limit=8`).catch(() => null)
        : api.get(`/profile/${id}/credits?limit=8&sortKey=popularity&sortDirection=DESC`).catch(() => null)
    ]);

    const sum = (analytics && analytics.summary) || {};
    const configured = num(process.env.MUSO_STREAMS);
    const credits = num(profile.creditCount) || num(analytics && analytics.creditCount);

    /* The function decides which four tiles make sense for the key in play, so
       the page never has to know which API answered. */
    const tiles = [
      { label: "Credits on Muso.AI", value: credits },
      { label: "Verified collaborators", value: num(profile.collaboratorsCount) },
      api.workspace
        ? { label: "Shazams", value: num(sum.shazams) }
        : { label: "Muso popularity index", value: num(profile.popularity) },
      api.workspace
        ? { label: "Views · YouTube & TikTok", value: num(sum.views) }
        : { label: "Chart placements", value: null }
    ].filter((t) => t.value !== null);

    const items = (tracks && (tracks.items || tracks)) || [];
    const top = (Array.isArray(items) ? items : []).slice(0, 8).map((t) => ({
      title: t.title || t.name || "",
      artist:
        (Array.isArray(t.artists) ? t.artists.map((a) => a.name).filter(Boolean).join(", ") : t.artist) || "",
      art: t.albumArt || t.image || (t.album && t.album.albumArt) || "",
      streams: num(t.streams)
    })).filter((t) => t.title);

    const streams = num(sum.streams);
    const payload = {
      ok: true,
      syncedAt: new Date().toISOString(),
      source: api.workspace ? "workspace" : "public",
      profile: {
        id,
        name: profile.name || DEFAULT_NAME,
        url: `https://credits.muso.ai/profile/${id}`
      },
      // live:true means Muso itself reported the number — only ever from analytics.
      streams: streams
        ? { value: streams, live: true }
        : configured
          ? { value: configured, live: false }
          : null,
      tiles,
      top
    };

    warm = { at: Date.now(), payload };
    return ok(payload, CACHE_SECONDS);
  } catch (err) {
    // Serve the last good payload if we have one; otherwise let the page stay static.
    if (warm.payload) return ok({ ...warm.payload, stale: true }, 300);
    return ok({ ok: false, reason: String(err.message || err) }, 60);
  }
};
