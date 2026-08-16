# NearBaz — Performance & Scale Plan

Current stack: Vercel (4 web apps) + Render free (API) + Supabase (Postgres+PostGIS).
This doc covers what's done for speed, and what to do as traffic grows.

## ✅ Done (free, code-side)

- **In-memory API cache** (`src/common/memory-cache.ts`) — serviceable cities (60s) + per-shop categories (60s), invalidated on writes. Cuts repeated DB round-trips.
- **Composite DB indexes** — `Product(shopId, available)` for catalog, `Order(shopId, status)` for the shopkeeper feed. (Base single-column indexes on shopId/status/customerId/riderId already existed.)
- **Keyset pagination** — all list endpoints + apps already lazy-load (first page, load-more on scroll).
- **Background work** — order placement responds before notifications/dispatch fire (fire-and-forget).
- **Dispatch sweep** slowed 3s → 15s; **poll intervals** raised across apps (alerts 4→15s, feeds 8→20s) to stop request pileup.
- **CORS preflight cached** 24h (fewer OPTIONS round-trips).
- **Keep-alive**: a session cron pings `/health` every 11 min (only while a Claude session is up — see permanent fix below).

## ⏳ #1 real fix (costs money, biggest impact)

- **Render Starter ($7/mo)** — 0.1→0.5 CPU, and NO sleep. Free tier sleeps after 15 min → 30-60s cold start, and every response is slower. This single upgrade takes responses from ~20s to <500ms. Everything above is squeezing the free tier; this removes the ceiling.

## Permanent keep-alive (free, do this)

The session cron dies when Claude exits. For always-on, use an external uptime pinger:
- **cron-job.org** or **UptimeRobot** (free) → ping `https://api.nearbaz.in/health` every 10 min.
- Note: this keeps it warm but does NOT add CPU — cold starts shrink, but heavy-load slowness still needs the $7 tier.

## When you scale (later, in order of impact)

1. **Redis cache** (Upstash free tier) — replace the in-memory cache when you run >1 API instance (in-memory doesn't share across instances). Cache: shop list, product catalogs, categories.
2. **CDN for images** — move uploads off Render's ephemeral disk (they're lost on redeploy!) to **Supabase Storage** or **Cloudflare R2**, served via CDN. Compress to WebP, ~100KB max.
3. **Supabase connection pooling** — already using the transaction pooler (6543) for the app; keep it.
4. **Split heavy endpoints** — only if profiling shows a specific slow query; add targeted indexes rather than premature microservices. (You do NOT need Zomato's 100 microservices at pilot/city scale — that's for millions of req/sec.)

## Frontend polish (perceived speed)

- Skeleton loaders instead of spinners on Discovery/Storefront/Orders.
- Optimistic UI on cart add/remove (already server-authoritative; could show instant local state).

## Honest priority

1. External keep-alive pinger (free, 5 min setup)
2. Render $7 Starter (the real fix)
3. Images → R2/Supabase Storage + WebP
4. Redis only when >1 instance
