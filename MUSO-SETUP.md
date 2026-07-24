# Muso.AI hookup — `#numbers` section

## What's wired

`index.html` has a dedicated **Los Números / En Vivo** section (replaces the old
4-tile stats strip). It calls one endpoint — `/.netlify/functions/muso` — and
fills in:

| Element | Source |
|---|---|
| Big stream counter | `streams.value` from the function (see caveat below) |
| Credits on Muso.AI | `profile.creditCount` |
| Verified collaborators | `profile.collaboratorsCount` |
| Chart placements | `GET /profile/{id}/charts` length |
| Muso popularity index | `profile.popularity` |
| Top-credit chips | `GET /profile/{id}/credits?sortKey=popularity` |
| "Live · Muso.AI · 12 min ago" badge | `syncedAt` |

If the key is missing or Muso is unreachable, the function returns
`{"ok":false}`, the live layer stays hidden, the badge never appears, and the
page shows only its static, already-true numbers. **The site cannot break
because of this integration.**

## There are two Muso APIs — use the workspace one

| | Workspace `/v4a` | Public `/v4` |
|---|---|---|
| Header | `workspace-api-key` | `x-api-key` |
| How to get it | Pro/Business plan → Settings → API Key (self-serve) | Sales-gated, aaron@muso.ai |
| Scope | profiles in your workspace roster | full Muso catalog + search |
| **Stream counts** | **yes** — `/analytics/profile/{id}` → `summary.streams` | **no** |

`summary.streams` is documented as *"the total number of streams in spotify,
youtube and soundcloud for that profile"*, alongside `shazams` and `views`
(YouTube + TikTok). That is the live headline number, and it needs the
workspace key. The public API has no stream data at all, so it is the weaker
option here despite covering more catalog.

The function speaks both and prefers the workspace key when present. Tiles
change to match: with a workspace key it shows credits / collaborators /
Shazams / views; with a public key, credits / collaborators / popularity.

## Setup

1. Upgrade the Muso workspace to Pro (or Business) at <https://credits.muso.ai>.
2. Confirm Súbelo NEO is in Settings → Profiles (the roster). The workspace API
   only returns profiles listed there. "Unclaimed" status is fine for reading.
3. Settings → API Key → generate, then:

```bash
netlify env:set MUSO_WORKSPACE_KEY "your-workspace-key"
```

4. Optional — skips the roster lookup on cold starts. Get the id from
   `GET /v4a/workspace/roster`:

```bash
netlify env:set MUSO_PROFILE_ID "the-subelo-neo-uuid"
```

5. Only needed on a public key (workspace keys supply the real number):

```bash
netlify env:set MUSO_STREAMS "20000000000"
```

Redeploy after setting variables — Netlify only injects them at build/run time.

## Caching

The function caches 6h in-process and sets `s-maxage=21600` so Netlify's CDN
serves it from the edge. Real API traffic is roughly 4 requests/day regardless
of site traffic. On error it serves the last good payload with `"stale":true`.

## Local dev

`python3 -m http.server` will 404 the function path — that's the graceful
fallback path, and the page renders its static numbers. To exercise the live
path locally, run `netlify dev` (with the env vars set), or drop a JSON file at
`.netlify/functions/muso` in whatever directory you're serving.
