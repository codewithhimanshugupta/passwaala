# NearBaz — Your Local Business Network

NearBaz is a hyperlocal, **multi-shop** marketplace connecting a locality's
product businesses (kirana, dairy, medical, fruits & veg, electronics, clothing,
hardware…) with nearby customers. A customer near a shop can browse that shop's
catalogue, place an order, and the shopkeeper receives and fulfills it — with
WhatsApp/FCM as the notification backbone and self-delivery to start. Money flows
**directly from customer to shopkeeper** (UPI or Cash on Delivery); NearBaz never
holds, splits, or settles money.

Positioning: Customer — *"Jo chahiye, paas mein mil jayega."* · Shop owner —
*"Meri dukaan ab online hai."*

---

## Phased Roadmap

- **Phase 0 — Foundation (Week 1)** — Monorepo (apps + api + shared), local Docker
  Postgres+PostGIS with a persistent volume, Prisma schema + first migration
  (following the 8 migration-safe rules), OTP auth, security baseline (RBAC guards,
  `shop_id` auto-scoping, input validation, OTP rate-limiting, secret hygiene,
  audit logging), test harness + CI (Jest, supertest, Postgres test container,
  GitHub Actions merge-blocking on red), local `./uploads` media behind a swappable
  interface, structured logging/metrics, base design system. In parallel
  (paperwork): kick off WhatsApp/Meta business verification + template submission.
- **Phase 1 — Shopkeeper side (Weeks 2–4)** — Shop registration + profile, KYC +
  real storefront-photo submission and the `verificationStatus` flow (shop hidden
  until admin-approved), product CRUD with image upload, stock/availability,
  open/closed toggle + scheduled working hours, incoming order feed with status
  transitions, accept/reject with reason + no-response auto-cancel, live in-app
  new-order alert (WebSocket + FCM), admin KYC review + approval, WhatsApp
  "new order" notification.
- **Phase 2 — Customer side (Weeks 4–7)** — OTP login, GPS + nearby-shop discovery
  (PostGIS radius query) with sort + filters, shop storefront, product
  browse/search, single-shop cart with min order value + delivery-fee + ₹10
  platform-fee bill breakdown, address, order placement.
- **Phase 3 — Order loop + direct payment + exceptions (Weeks 7–9)** — Live order
  tracking, accept-before-pay flow (item substitution → customer approves adjusted
  order → direct UPI deep-link/QR + COD → shopkeeper confirms receipt),
  rejection / no-response / `REFUND_PENDING` handling, order history + one-tap
  reorder, cancel/refund-request, invoice PDF.
- **Phase 4 — Polish + pilot launch (Weeks 9–12)** — Shop ratings, push
  notifications, error/crash monitoring, analytics events, owner/platform
  dashboard, commission-ledger reporting + credit-limit enforcement (auto-pause at
  ₹500), app-store gates (Privacy Policy + Terms + consent, in-app account
  deletion, empty/error/loading states), onboard 5–20 real shops in one locality.

---

## Local Dev Setup

### Prerequisites

- **Node 20+** and npm.
- **Docker** (Docker Desktop or engine + `docker compose`) — **required** for the
  local Postgres+PostGIS database. Without Docker you cannot run the DB, migrations,
  or the API's integration tests. The same `postgis/postgis:16-3.4` image also
  powers CI.

### Steps

```bash
# 1. Install all workspace dependencies (root, api, apps, packages)
npm install

# 2. Start the local Postgres+PostGIS (and Redis) containers
npm run db:up

# 3. Configure and prepare the API
cd api
cp .env.example .env
npm run prisma:generate
npm run prisma:migrate

# 4. Run the API in dev/watch mode (from the repo root or api/)
npm run api:dev
```

> Note: Docker must be installed and running before `npm run db:up`, the Prisma
> migrate step, and the API integration tests — all of them talk to the local
> Postgres+PostGIS container. This is the same image CI uses, so local and CI
> behaviour match.

Useful root scripts: `npm run db:up` / `npm run db:down` / `npm run db:logs`
(manage containers), `npm run shared:build` (build shared types), `npm run api:dev`
(API watch mode), `npm run api:test` (API tests).

---

## Monorepo Layout

npm-workspaces monorepo (`packages/*`, `api`, `apps/*`):

```
nearbaz/
├── api/                    # NestJS service — modules: auth, shops, products,
│                           #   orders, notifications, realtime, dispatch (stub);
│                           #   api/prisma/schema.prisma holds the Postgres schema
├── apps/
│   ├── customer-app/       # React Native (Expo) — Android, iOS, + web (RN Web/PWA)
│   ├── shopkeeper-app/     # React Native (Expo) — same triple target
│   └── admin/              # Retool-hosted or thin React admin
├── packages/
│   └── shared/             # @nearbaz/shared — shared TS types & DTOs (order
│                           #   status enum, etc.) used across apps + api
├── docker-compose.yml      # Postgres+PostGIS + Redis for local dev
├── .github/workflows/ci.yml
└── package.json            # workspaces root
```

---

## Security & Data Rules

> These are hard rules, enforced from Phase 0 — not a later hardening pass.

- **Money as integer paise, never floats.** ₹10 = `1000`. Float rupees eventually
  corrupt commission/ledger totals.
- **Shop data isolation.** A shopkeeper can only ever see and touch their **own**
  shop's data. Ownership is auto-scoped by `shop_id` at the data-access layer
  (derived from the authenticated JWT), not per-endpoint — and it is CI-tested.
- **No admin/owner signup — ever.** Public signup flows can only create
  customer/shopkeeper/rider/provider roles; the `role` field is never accepted from
  client input. The single OWNER is seeded out-of-band; ADMINs exist only via owner
  invitation (`PENDING_OWNER_APPROVAL → ACTIVE`). This closes the privilege-
  escalation hole.
- **Secrets in `.env` only.** All keys/tokens (DB, JWT, WhatsApp, FCM) live in env
  / a secret manager, never committed. `.env` is git-ignored; only `.env.example`
  is tracked.
- **Schema safety:** UUID primary keys, `createdAt`/`updatedAt` + soft-delete
  (`deletedAt`) on every entity, append-only enums, snapshot values onto orders,
  expand-then-contract migrations. Never hand-edit the database.
- **KYC docs & PII are the crown jewels** — private storage, admin-only signed URLs,
  never returned on customer/shopkeeper reads, access audit-logged.

See `CONTRIBUTING.md` for the development workflow rules.
