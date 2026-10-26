# Security Deposit / FDR Management Portal

Prototype for **Smart India Hackathon problem statement 26265: Streamline of Security Deposit/FDR Portal**
(organisation named in the problem statement: AICTE, Regulation Bureau · theme: Smart Automation).

> **Disclaimer.** This is an independent hackathon prototype. It is **not** affiliated with,
> endorsed by, or an official system of AICTE. Workflow rules, deadlines and reminder windows are
> configurable **demonstration defaults** that require confirmation against actual procedures. No
> bank, payment or messaging system is connected: bank verification and email delivery are
> **simulated and labelled as such**. All seeded institutions, banks, people and instruments are
> **fictional**.

---

## 1. What it does

A centralised portal that manages the full lifecycle of security deposits and Fixed Deposit
Receipts (FDRs) lodged by institutions:

| Capability | Summary |
|---|---|
| Institution registration | Public self-registration → *pending* → approved / rejected by the Bureau or an administrator. Institution-wise records and profile pages. |
| Instrument registration | Drafts (private to the institution) → submission with required-field validation. Money stored as `NUMERIC(15,2)`; dates as `DATE` in IST. |
| Documents | Protected upload/download (PDF/PNG/JPEG), content-sniffed type, SHA-256, versioning, officer review, audit of every upload and download. |
| Scrutiny & verification | Regional verification queue, document review, verification records that distinguish *institution-submitted*, *automated check*, *manual scrutiny* and *independent confirmation*. |
| Discrepancy detection | Automated consistency checks (missing fields, date order, amounts, missing documents, duplicate references, unknown banks, renewal linkage) plus officer-raised discrepancies with traceable resolution. |
| Maturity monitoring | Date-driven reminders (90/60/30/7/0 days by default), maturity-reached notices, post-maturity escalation, SLA-overdue detection, idempotent scheduling. |
| Renewal / replacement | New linked instrument + renewal case; the original is never overwritten and is marked *replaced* only when the new one is accepted. |
| Release / refund | Officer scrutiny → approving authority decision → completion recorded with reference **and** evidence. No funds are moved. |
| Notifications | In-app (authoritative) + email channel with a **simulated** provider, retry/backoff, delivery tracking, de-duplication. |
| Dashboards & reports | Role-specific dashboards computed from the database; searchable/filterable/paginated registers; CSV exports with totals; all scoped to the user's authority. |
| RBAC & audit | Server-enforced permissions + record scoping for five roles; append-only audit trail (DB trigger blocks UPDATE/DELETE). |

## 2. Technology

| Layer | Choice |
|---|---|
| Web app | **Next.js 15** (App Router, React 19, TypeScript) — server components for pages, route handlers for the JSON/multipart API |
| Styling | Tailwind CSS 3 with CSS-variable design tokens; `lucide-react` icons; dependency-free charts |
| Persistence | **PostgreSQL 16** via **Prisma 6** (migrations, typed queries; raw SQL only for atomic counters and duplicate detection) |
| Validation | Zod 4 schemas shared by API and forms |
| Auth | Server-side sessions (opaque token in HttpOnly cookie, SHA-256 stored), Node `scrypt` password hashing |
| Tests | Vitest (unit + integration against a real database), Playwright (browser end-to-end) |

## 3. Architecture

```
src/
  app/                    Next.js routes
    (app)/…               authenticated pages (dashboard, instruments, verification, renewals,
                          releases, notifications, reports, audit, institutions, admin)
    api/…                 route handlers — every one wrapped by apiRoute()/publicRoute()
    login/, register/     public pages
  components/             UI building blocks; components/client/* are client components
  lib/                    isomorphic helpers: dates (IST business rules), formatting, labels, Zod schemas
  server/
    api.ts                CSRF origin check, auth, rate limit, correlation id, error mapping
    auth/                 sessions, password hashing, permission matrix, record scoping
    services/             business logic (the ONLY place that reads/writes domain data)
    workflow/             explicit state-transition tables (instrument, release)
    checks/consistency.ts automated consistency rules (pure functions)
    jobs/monitor.ts       maturity / escalation / SLA monitor
    notifications/        in-app notifications, delivery processing, email provider interface
    verification/         external-verification provider interface + DEMO adapter
    storage/files.ts      protected file storage
    audit.ts              append-only audit writer (same transaction as the change)
prisma/                   schema, migrations, deterministic seed
scripts/run-monitor.ts    CLI / cron entry point for the monitor
tests/                    unit, integration, e2e
```

Pages and API handlers both call the same service functions, which take the authenticated
`Actor`, check the permission, apply the actor's data scope and write audit events inside the same
database transaction. Hidden UI is never the control.

### Data model (key decisions)

* **Institutions** belong to a **Region**; officers are assigned regions (`officer_regions`).
* **Instruments** keep institution-submitted values *as submitted* (nullable for drafts/legacy imports);
  `status` (workflow) and `verificationStatus` are separate. `version` provides optimistic concurrency.
* **Maturity is derived, not stored**: *matured* = maturity date ≤ today (IST); *expiring* = held and
  maturing within the configured window. An instrument therefore cannot "become valid again".
* **Renewals** create a new `Instrument` with `replacesInstrumentId` plus a `RenewalCase`
  (previous/proposed maturity, status). The original row's values and documents are never changed.
* **Documents** are versioned (`version`, `isCurrent`, `supersedesId`) and store `sha256`, detected
  `mimeType`, size and an opaque `storageKey` that never leaves the server.
* **VerificationRecord** captures method, source, `isSimulated`, `independentlyConfirmed`, evidence.
* **Discrepancy** captures source (automated/officer), severity, status and resolution note/actor.
* **ReleaseRequest** keeps scrutiny, decision (actor/time/reason), and completion (reference,
  evidence document, actor/time) as separate, permanent fields.
* **Notification** + **NotificationDelivery** (per channel: status, attempts, last error, next attempt).
* **AuditEvent** (bigserial, actor, action, resource, before/after JSON, reason, correlation id, IP).
* Hand-written SQL in the initial migration adds: the append-only trigger on `audit_events`; partial
  unique indexes for *one open release request per instrument*, *one in-progress renewal per
  original*, *one open automated discrepancy per check*; positive-amount CHECK constraints.
  ⚠ Prisma does not model these; review future generated migrations so they are not dropped.

### Workflow

```
Instrument:  DRAFT ─submit→ PENDING_SCRUTINY ─start review→ UNDER_REVIEW ─await verification→ VERIFICATION_PENDING
                     ↑            (officer)                    │                               │
                     └──resubmit── CORRECTION_REQUIRED ←─request correction─┘   confirmed verification
                                                                                               ↓
             ACCEPTED ←─accept (officer; confirmed + no open discrepancies + not matured)── VERIFIED
             ACCEPTED → REPLACED (when a renewal is accepted) · ACCEPTED/REPLACED → RELEASED (release completed)
             REJECTED / WITHDRAWN keep their reason. Every transition is validated server-side and audited.

Release:     SUBMITTED → UNDER_SCRUTINY (officer) ⇄ INFO_REQUESTED (institution responds)
             UNDER_SCRUTINY → PENDING_APPROVAL (officer forwards with observations)
             PENDING_APPROVAL → APPROVED | REJECTED | INFO_REQUESTED (approving authority; reason required;
                                 the scrutinising officer can never decide)
             APPROVED → COMPLETED only with a completion reference AND an uploaded evidence document
```

Transitions live in `src/server/workflow/*.ts` as data tables — the single place to adapt the
procedure once real requirements are confirmed.

## 4. Roles and permissions

| Role | Can | Cannot |
|---|---|---|
| Institution User | Own institution only: drafts, documents, submit/correct, renew/replace, release requests, own reports | See other institutions (404), review, decide |
| Regulation Bureau Officer | Assigned regions only: scrutiny, document review, verification records, discrepancies, correction requests, accept/reject instruments, release scrutiny & completion, registrations | Approve/reject releases, see drafts or other regions |
| Approving Authority | All regions (read), decide forwarded release/refund requests, request information | Scrutinise, edit instruments |
| System Administrator | Users/roles, regions/banks, policy settings, monitor runs, registrations, read audit log | View instruments, documents or release requests; edit audit history |
| Auditor | Read-only records, decisions, **document metadata**, audit log, exports | Download document binaries; any modification |

The matrix is in `src/server/auth/permissions.ts`; record scoping in `src/server/auth/scope.ts`.

## 5. Getting started

### Prerequisites
* Node.js ≥ 20.18 (developed on 22) and npm
* PostgreSQL 16 (local install or `docker compose up db`)

### Setup

```bash
cp .env.example .env            # then edit DATABASE_URL, DEMO_MODE=true, DEMO_PASSWORD
npm ci                          # .npmrc sets legacy-peer-deps (works around an npm 10 resolver bug with Vitest 4)
npx prisma migrate deploy       # apply migrations
npm run db:seed                 # load deterministic demonstration data (wipes the database!)
npm run dev                     # http://localhost:3000
```

Other commands:

```bash
npm run monitor                 # one maturity/escalation/SLA pass (cron entry point)
npm run monitor:watch           # loop every MONITOR_INTERVAL_MINUTES
npm run db:reset                # drop + migrate + seed
npm run build && npm run start  # production build / server
```

The seed refuses to run if non-demo accounts exist (use `-- --force` only in development). Dates are
offsets from today in IST; set `SEED_REFERENCE_DATE=YYYY-MM-DD` for fully fixed dates.

### Demonstration accounts

Available only after seeding. With `DEMO_MODE=true` the sign-in page shows a picker that submits
the **normal password login** for these accounts — there is no authentication bypass.
All seeded accounts use the password in `DEMO_PASSWORD` (the seed's fallback when unset is
`Demo@SDP2026`; **demo only — never use in production**).

| Role | Email | Scope |
|---|---|---|
| Institution User | `inst.northfield@demo.example.org` | Northfield Institute of Technology (Demo), Northern Region |
| Institution User | `inst.coastal@demo.example.org` | Coastal College of Engineering (Demo), Southern Region |
| Officer | `officer.north@demo.example.org` | Northern, Central, Eastern regions |
| Officer | `officer.south@demo.example.org` | Southern, Western regions |
| Approving Authority | `authority@demo.example.org` | All |
| Auditor | `auditor@demo.example.org` | All (read-only) |
| System Administrator | `admin@demo.example.org` | System |
| Pending registration | `inst.riverside@demo.example.org` | Cannot sign in until approved |

Every seeded institution has a user `inst.<key>@demo.example.org` (e.g. `inst.eastbrook`, `inst.westgate`).

### Suggested demonstration flow

1. **Institution (Northfield)** — dashboard tasks; open the *correction required* record, read the
   officer's request, *Correct values*, *Submit correction*; create a *New submission*, watch the
   pre-submission check flag the missing receipt, upload a PDF, submit; *Renew / replace* the
   instrument expiring in 25 days; request release of a matured instrument.
2. **Officer (north)** — *Verification queue*: start review, review documents, record a manual review
   (note that *Confirmed* is blocked by policy), upload a bank letter and confirm, accept; open the
   *Verified — awaiting acceptance* record; re-run checks; waive a warning with a reason.
3. **Officer (south)** — the *duplicate reference* warning (SDP record under review), the *DEMO /
   SIMULATED* provider result on the verification-pending record, the legacy imports with missing
   bank/number and transposed dates, and the overdue release request.
4. **Approving authority** — *Release / refund → Awaiting my decision*: approve or reject with reason;
   note that completion is still required.
5. **Officer (north)** — upload completion evidence on the approved release and *Record completion*;
   the instrument becomes *Released (recorded)*.
6. **Administrator** — approve the *Riverside* registration, change reminder windows, *Run monitor now*,
   inspect delivery statistics (simulated emails), manage reference banks.
7. **Auditor** — audit log filters and CSV export; document metadata without download.

## 6. Automation and notifications

* `runMonitor()` (`src/server/jobs/monitor.ts`) runs from `npm run monitor`, the Render cron job,
  the Compose `monitor` service or *Administration → System health → Run monitor now*.
* **Reminders**: for held instruments with no renewal/release under way, only the *smallest
  applicable* window is sent (a late first run doesn't burst stale reminders). Dedupe key
  `maturity:<instrument>:<maturityDate>:T-<window>` — re-runs never duplicate, and a changed
  maturity date generates fresh reminders.
* **Escalation**: after maturity, level 1 (default 7 days) → regional officers + institution;
  level 2 (30 days) → approving authorities. Scrutiny older than the SLA → officers; 2× SLA →
  authorities. Overdue corrections and release steps are also flagged.
* **Delivery**: in-app notifications are created in the same transaction as the event. Email
  deliveries are processed with bounded retries and exponential backoff; the default provider is
  **simulated** and records `SIMULATED` (never `DELIVERED`). Plug a real gateway in
  `src/server/notifications/email-provider.ts`.
* All windows/SLAs are editable by administrators and audited.

## 7. External integrations — real vs simulated

| Integration | Status |
|---|---|
| Bank verification | **None exists.** `VerificationProvider` interface + `DemoSimulatedProvider` (enable with `VERIFICATION_PROVIDER=demo`). Results are stored with `isSimulated=true`, labelled "DEMO / SIMULATED", recorded as *Pending*, and can never confirm an instrument. Confirmation requires an officer-uploaded bank confirmation letter (policy `requireIndependentConfirmation`, default on). |
| Email / SMS | **Simulated** email channel only (`EMAIL_MODE=simulated`); no SMS. |
| Payments / fund release | **None.** "Completed" records evidence of processing done elsewhere. |
| Malware scanning | **Not available.** Uploads are restricted by type/size/signature and active-content heuristics only. |

## 8. Security controls

* Server-side permission checks on every service call + record-level scoping; out-of-scope IDs return 404.
* Sessions: 256-bit random token, only its SHA-256 stored; HttpOnly, SameSite=Lax, Secure in
  production; 8 h absolute / 1 h idle expiry; sessions revoked on role change, disable or suspension.
* Passwords: scrypt (N=16384, r=8, p=1), timing-equalised unknown-user path, generic error messages,
  account lock after 5 failures (15 min), per-IP rate limits on login/registration/uploads/exports.
* CSRF: every non-GET API call must carry a matching `Origin`/`Referer`.
* Input validation with Zod; Prisma parameterised queries; React output encoding; CSV formula-injection
  neutralisation; JSON body size limits.
* Uploads: size limit, extension allow-list *and* magic-byte detection must agree, PDFs with
  JavaScript/launch/embedded files rejected, markup polyglots rejected, server-generated keys,
  traversal-safe paths, atomic writes, rollback on DB failure, storage outside `public/`.
* Downloads: authorised per request, audited, `nosniff`, sandbox CSP, attachment disposition.
* Headers: CSP, X-Frame-Options, Referrer-Policy, Permissions-Policy, HSTS (production).
* Errors: typed errors mapped centrally; unknown errors return a generic message + correlation id,
  stack traces logged server-side only. Passwords, tokens and document contents are never logged.
* Audit: every material action, including exports, downloads, settings and user changes; the
  `audit_events` table rejects UPDATE/DELETE at the database level.

## 9. Testing

```bash
createdb sdp_test                      # once; or set TEST_DATABASE_URL
npm run test                           # unit + integration (Vitest; migrates and wipes the TEST database)
npm run test:e2e                       # Playwright; RESEEDS the database in .env and starts `npm run dev`
E2E_BASE_URL=http://localhost:3000 npm run test:e2e   # against an already-running server (e.g. production build)
npm run lint && npm run typecheck && npm run build
```

Coverage of the required checks (`tests/integration/workflow.test.ts`, `api-security.test.ts`,
`tests/e2e/lifecycle.spec.ts`):

| # | Check | Where |
|---|---|---|
| 1 | Institution submits an instrument | workflow #1, e2e lifecycle |
| 2 | Required-field validation | workflow #2 |
| 3 | Appears in correct regional queue | workflow #3, e2e |
| 4 | Officer inspects and records observations | workflow #4, e2e |
| 5 | Officer-only actions blocked for others | workflow #5, api-security |
| 6 | No cross-institution access | workflow #6, api-security, e2e |
| 7 | Missing documents → actionable discrepancy | workflow #7, e2e |
| 8 | Reminder at configured threshold | workflow #8–9 |
| 9 | No duplicate reminders on re-run | workflow #8–9 |
| 10 | Renewal links records, preserves history | workflow #10 |
| 11 | Invalid transitions rejected | workflow #11, unit workflow-rules |
| 12 | Release cannot bypass authorisation | workflow #12, e2e |
| 13 | Rejected request keeps decision/reason | workflow #13 |
| 14 | Completion requires evidence + reference | workflow #14 |
| 15 | Audit events; append-only | workflow #15 |
| 16 | Search/pagination/reports consistent and scoped | workflow #16, e2e |
| 17 | Protected documents | workflow #17, api-security |
| 18 | Errors never reported as success / no leakage | api-security, client `apiCall` |

Plus: CSRF origin, login lockout, stale-version and concurrent double-processing, duplicate
release requests, invalid upload types/sizes/polyglots, simulated-verification integrity,
delivery retries/failure capping, idempotent creates.

## 10. Deployment

* **Render** — `render.yaml` defines a web service (with a 1 GB persistent disk for documents),
  an hourly cron job for the monitor, and PostgreSQL. Apply it via *Blueprints* in the Render
  dashboard, set `DEMO_PASSWORD` (and `DEMO_MODE=false` for anything beyond a demo), then open a
  shell on the web service and run `npm run db:seed` if demonstration data is wanted. Persistent disks
  and pre-deploy commands need a paid instance type; confirm plan names in the dashboard.
* **Docker** — `Dockerfile` (migrates on start) and `docker-compose.yml` (Postgres + app + monitor).
* Production notes: terminate TLS in front of the app; keep `STORAGE_DIR` on durable, backed-up,
  access-restricted storage (or replace `storage/files.ts` with an object store); run a single
  instance or replace the in-memory rate limiter with a shared store; configure log retention.

## 11. Known limitations / requires confirmation

* Reminder windows, SLAs, escalation ladder, verification policy and the release approval chain are
  demonstration defaults; actual AICTE procedures, approval delegations and amount thresholds must be confirmed.
* Document retention periods, data-protection obligations and record-keeping rules have **not** been
  supplied; no retention policy is enforced.
* No real bank verification, email/SMS, payment, DigiLocker or AICTE-system integration.
* No malware scanning; PDF content heuristics are not a substitute.
* No multi-factor authentication, password reset, or SSO (would be required for production).
* In-memory rate limiting is per process.
* English only.
* Dev-tool advisories: `npm audit` reports issues in the Prisma CLI's `deepmerge-ts` and
  Tailwind 3's `postcss-selector-parser` (build-time only, no runtime exposure); resolve by upgrading
  to Prisma 7 / Tailwind 4 when convenient.
* Docker files were written but could not be built in the development sandbox (no Docker daemon).
