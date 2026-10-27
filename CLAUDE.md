# CLAUDE.md

Security Deposit / FDR portal prototype (SIH PS 26265). Next.js 15 App Router + Prisma 6 + PostgreSQL.

## Commands
- `./run.sh` / `.\run.ps1` — one-command local start (thin wrappers around `scripts/launcher.mjs`); `check|test|e2e|monitor|reset-demo` subcommands
- `npm run dev` · `npm run build` · `npm run lint` (zero warnings) · `npm run typecheck`
- `npm run test` — Vitest unit + integration against `TEST_DATABASE_URL` (default `sdp_test`; wiped)
- `npm run test:e2e` — Playwright; reseeds the `.env` database
- `npx prisma migrate dev --name <x>` · `npm run db:seed` (wipes data; `-- --if-empty` never deletes) · `npm run monitor`

## Architecture rules
- All domain reads/writes go through `src/server/services/*`. Each service takes an `Actor`, calls
  `requirePermission` and applies `*Scope(actor)` from `src/server/auth/scope.ts`. Out-of-scope → `NotFoundError`.
- API routes are wrapped in `apiRoute`/`publicRoute` (`src/server/api.ts`): CSRF origin check, auth,
  error mapping. Pages call services directly via `requirePagePermission`/`orNotFound`.
- Write the audit event (`recordAudit`) in the same transaction as the change.
- Use `now()` from `src/server/clock.ts` (not `new Date()`) for business timestamps so tests/seed can fix time.
- Status changes only via the transition tables in `src/server/workflow/*`; use optimistic `version` checks.
- Shared date/maturity/overdue rules live in `src/lib/dates.ts` and `src/server/services/rules.ts` — reuse them
  for dashboards, filters, reports and the monitor so numbers agree.
- Never return `storageKey` to clients (queries use `omit: { storageKey: true }`).

## Invariants (do not weaken)
- The launcher's normal start must stay non-destructive: `migrate deploy` only, seed only via `--if-empty`,
  never `migrate reset`, never `docker compose down -v`, never kill processes it did not start.
- Submission ≠ approval; document upload ≠ verification; simulated provider results never confirm.
- Automated BLOCKING discrepancies close only via a correction that removes the condition.
- Matured/expired is derived from `maturityDate`; never stored as a status.
- Renewal creates a new linked instrument; the original's values are never modified.
- Release completion requires approval + completion reference + evidence document; no funds are moved.
- `audit_events` is append-only (DB trigger). The initial migration also holds partial unique indexes
  Prisma does not model — check generated migrations do not drop them.

## Conventions
- Money: `Decimal` / `NUMERIC(15,2)`; amounts travel as strings. Dates: `DATE` columns, IST business day.
- Client components live in `src/components/client`; they call the API through `apiCall` and only show
  success on a 2xx response.
- Demo data is fictional and flagged `isDemo`; demo login is the normal password login (DEMO_MODE only shows the picker).
