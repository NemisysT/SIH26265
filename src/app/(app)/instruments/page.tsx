import Link from "next/link";
import { Download } from "lucide-react";
import { requirePagePermission, flatParams, type SearchParams } from "@/server/page";
import { can } from "@/server/auth/scope";
import { searchInstruments, INSTRUMENT_VIEWS } from "@/server/services/search";
import { clampPage } from "@/server/services/common";
import { Badge, Card, DemoTag, EmptyState, PageHeader, Pagination, StatusBadge } from "@/components/ui";
import { MaturityCell } from "@/components/instrument-bits";
import { INSTRUMENT_STATUS, INSTRUMENT_TYPE_LABELS, VERIFICATION_STATUS, RELEASE_STATUS } from "@/lib/labels";
import { formatINR, formatINRShort } from "@/lib/format";
import { businessToday } from "@/lib/dates";

export const metadata = { title: "Security Deposits & FDRs" };

export default async function InstrumentsPage({ searchParams }: { searchParams: SearchParams }) {
  const actor = await requirePagePermission("instrument:read");
  const sp = await flatParams(searchParams);
  const paging = clampPage(Number(sp.page), 25);
  const { rows, total, totalAmount, settings } = await searchInstruments(actor, sp, paging);
  const today = businessToday();
  const isInstitution = actor.role === "INSTITUTION_USER";
  const exportQs = new URLSearchParams(Object.entries(sp).filter(([k, v]) => v && k !== "page") as [string, string][]).toString();
  const views = Object.entries(INSTRUMENT_VIEWS).filter(([k]) => k !== "drafts" || isInstitution);

  return (
    <>
      <PageHeader
        title="Security Deposits & FDRs"
        description={isInstitution ? "All instruments recorded for your institution, including drafts and historical records." : "Search and filter instruments within your authorised scope. Drafts are private to institutions until submitted."}
        actions={
          <>
            {can(actor, "report:export") && (
              <a className="btn-secondary" href={`/api/reports/instrument-register${exportQs ? `?${exportQs}` : ""}`}>
                <Download className="h-4 w-4" aria-hidden /> Export CSV
              </a>
            )}
            {can(actor, "instrument:create") && <Link href="/instruments/new" className="btn-primary">New submission</Link>}
          </>
        }
      />

      <div className="mb-3 flex gap-1 overflow-x-auto pb-1" aria-label="Quick filters">
        {views.map(([key, label]) => {
          const active = (sp.view ?? "all") === key;
          return (
            <Link key={key} href={key === "all" ? "/instruments" : `/instruments?view=${key}`} aria-current={active ? "true" : undefined}
              className={`whitespace-nowrap rounded-full border px-3 py-1 text-xs font-medium ${active ? "border-brand bg-brand text-ink-inverse" : "border-line-strong bg-surface-raised text-ink-muted hover:border-brand hover:text-brand"}`}>
              {label}
            </Link>
          );
        })}
      </div>

      <Card bodyClassName="p-0">
        <form className="grid gap-3 border-b border-line p-4 sm:grid-cols-2 lg:grid-cols-6" role="search">
          {sp.view && <input type="hidden" name="view" value={sp.view} />}
          <div className="lg:col-span-2">
            <label className="field-label" htmlFor="q">Search</label>
            <input id="q" name="q" defaultValue={sp.q} className="input" placeholder="Reference, instrument no., bank, institution name or code" />
          </div>
          <div>
            <label className="field-label" htmlFor="status">Workflow status</label>
            <select id="status" name="status" defaultValue={sp.status ?? ""} className="input">
              <option value="">Any</option>
              {Object.entries(INSTRUMENT_STATUS).filter(([k]) => k !== "DRAFT" || isInstitution).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
          </div>
          <div>
            <label className="field-label" htmlFor="verificationStatus">Verification</label>
            <select id="verificationStatus" name="verificationStatus" defaultValue={sp.verificationStatus ?? ""} className="input">
              <option value="">Any</option>
              {Object.entries(VERIFICATION_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
          </div>
          <div>
            <label className="field-label" htmlFor="type">Type</label>
            <select id="type" name="type" defaultValue={sp.type ?? ""} className="input">
              <option value="">Any</option>
              {Object.entries(INSTRUMENT_TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
          <div>
            <label className="field-label" htmlFor="bank">Bank</label>
            <input id="bank" name="bank" defaultValue={sp.bank} className="input" />
          </div>
          <div>
            <label className="field-label" htmlFor="maturityFrom">Maturity from</label>
            <input id="maturityFrom" name="maturityFrom" type="date" defaultValue={sp.maturityFrom} className="input" />
          </div>
          <div>
            <label className="field-label" htmlFor="maturityTo">Maturity to</label>
            <input id="maturityTo" name="maturityTo" type="date" defaultValue={sp.maturityTo} className="input" />
          </div>
          <div>
            <label className="field-label" htmlFor="issueFrom">Issued from</label>
            <input id="issueFrom" name="issueFrom" type="date" defaultValue={sp.issueFrom} className="input" />
          </div>
          <div>
            <label className="field-label" htmlFor="issueTo">Issued to</label>
            <input id="issueTo" name="issueTo" type="date" defaultValue={sp.issueTo} className="input" />
          </div>
          <div>
            <label className="field-label" htmlFor="sort">Sort by</label>
            <select id="sort" name="sort" defaultValue={sp.sort ?? "updatedAt"} className="input">
              <option value="updatedAt">Last updated</option>
              <option value="maturityDate">Maturity date</option>
              <option value="amount">Amount</option>
              <option value="submittedAt">Submitted</option>
              <option value="referenceNo">Reference</option>
            </select>
          </div>
          <div>
            <label className="field-label" htmlFor="dir">Order</label>
            <select id="dir" name="dir" defaultValue={sp.dir ?? "desc"} className="input">
              <option value="desc">Descending</option>
              <option value="asc">Ascending</option>
            </select>
          </div>
          <div className="flex items-end gap-2 sm:col-span-2 lg:col-span-6">
            <button className="btn-primary">Apply filters</button>
            <Link href={sp.view ? `/instruments?view=${sp.view}` : "/instruments"} className="btn-ghost">Clear</Link>
            <span className="ml-auto text-xs text-ink-muted">
              {total} record{total === 1 ? "" : "s"} · total recorded amount <strong className="text-ink">{formatINRShort(totalAmount)}</strong>
              <span className="sr-only"> ({formatINR(totalAmount)})</span>
            </span>
          </div>
        </form>

        {rows.length === 0 ? (
          <div className="p-6"><EmptyState title="No instruments match these filters">Adjust or clear the filters to see more records.</EmptyState></div>
        ) : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Reference</th>
                  {!isInstitution && <th scope="col">Institution</th>}
                  <th scope="col">Instrument</th>
                  <th scope="col" className="num">Amount</th>
                  <th scope="col">Maturity</th>
                  <th scope="col">Status</th>
                  <th scope="col">Flags</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td className="whitespace-nowrap">
                      <Link href={`/instruments/${r.id}`} className="link kbd-ref">{r.referenceNo}</Link>
                      <div className="text-2xs text-ink-subtle">{r.type === "FDR" ? "FDR" : "Security deposit"}{r.origin === "LEGACY_IMPORT" ? " · legacy import" : ""}</div>
                    </td>
                    {!isInstitution && (
                      <td className="max-w-56">
                        <div className="truncate" title={r.institution.name}>{r.institution.name}</div>
                        <div className="kbd-ref text-2xs text-ink-subtle">{r.institution.code}</div>
                      </td>
                    )}
                    <td className="max-w-56">
                      <div className="kbd-ref truncate">{r.instrumentNumber ?? <span className="text-tone-danger">missing</span>}</div>
                      <div className="truncate text-2xs text-ink-subtle">{r.bankName ?? "Bank not recorded"}</div>
                    </td>
                    <td className="num whitespace-nowrap">{formatINR(r.amount)}</td>
                    <td><MaturityCell date={r.maturityDate} today={today} windowDays={settings.expiringSoonDays} status={r.status} /></td>
                    <td>
                      <div className="flex flex-col items-start gap-1">
                        <StatusBadge map={INSTRUMENT_STATUS} value={r.status} />
                        {r.status !== "DRAFT" && <StatusBadge map={VERIFICATION_STATUS} value={r.verificationStatus} />}
                      </div>
                    </td>
                    <td>
                      <div className="flex flex-wrap gap-1">
                        {r._count.discrepancies > 0 && <Badge tone="danger">{r._count.discrepancies} open discrepanc{r._count.discrepancies === 1 ? "y" : "ies"}</Badge>}
                        {r.renewalsAsOriginal[0] && <Badge tone="info">Renewal in progress</Badge>}
                        {r.releaseRequests[0] && <Badge tone="accent">Release: {RELEASE_STATUS[r.releaseRequests[0].status]?.label}</Badge>}
                        {r.isDemo && <DemoTag />}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Pagination basePath="/instruments" params={sp} page={paging.page} pageSize={paging.pageSize} total={total} />
      </Card>
    </>
  );
}
