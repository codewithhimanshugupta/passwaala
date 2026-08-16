# Contributing to NearBaz

A few hard rules keep NearBaz shippable and safe. Read these before opening a PR.

## Tests ship with every feature

Automated tests are written **alongside** every feature — not after. No feature is
"done" until its tests ship in the **same commit/PR**. This is a project-wide rule,
not a final QA phase. Data-touching logic (order state machine, PostGIS nearby
query, commission/credit-limit ledger math) is tested against a **real Postgres
test DB**, not mocks. CI runs the full suite on every push and **merges are blocked
on red**.

## Expand-then-contract migrations

Every schema change goes through **Prisma migrate** (versioned, checked-in files
applied identically to dev / CI / prod). Breaking changes are done in two deploys,
never one:

1. **Expand** — add new columns/tables as nullable (or with a default). Never add a
   `NOT NULL` column with no default to a populated table.
2. Deploy code that writes both old + new; backfill existing rows.
3. Switch reads to the new shape.
4. **Contract** — drop the old column/table in a *later* deploy.

Enums are **append-only**: add values, never rename or remove existing ones.

## Never hand-edit the database

The database is only ever changed through checked-in Prisma migrations. No manual
`psql` edits, no ad-hoc `ALTER`/`UPDATE` against dev/CI/prod — losing or corrupting
an order/ledger row means losing money and history. Soft-delete (`deletedAt`);
never hard-delete.

## Conventional commits

Use [Conventional Commits](https://www.conventionalcommits.org/) for every commit
and PR title:

```
feat: add nearby-shop PostGIS query
fix: correct paise rounding in ledger accrual
chore: bump prisma to 5.x
test: cover shop_id isolation on orders endpoint
docs: document local dev setup
```

Common types: `feat`, `fix`, `chore`, `test`, `docs`, `refactor`, `perf`, `ci`.

## Also remember

- **Money is integer paise, never floats.**
- **Secrets live in `.env` only** — never commit them (`.env` is git-ignored).
- **Shop data isolation** and **no admin/owner signup** are non-negotiable — see
  the "Security & Data Rules" section in `README.md`.
