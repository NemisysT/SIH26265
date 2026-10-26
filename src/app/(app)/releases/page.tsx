import Link from "next/link";
import { Download } from "lucide-react";
import { requirePagePermission, flatParams, type SearchParams } from "@/server/page";
import { can } from "@/server/auth/scope";
import { listReleaseRequests } from "@/server/services/releases";
import { clampPage } from "@/server/services/common";
import { Card, DemoTag, EmptyState, PageHeader, Pagination, StatusBadge, Tabs } from "@/components/ui";
import { RELEASE_STATUS, RELEASE_TYPE_LABELS } from "@/lib/labels";
import { formatDateTime, formatINR, formatINRShort } from "@/lib/format";

export const metadata = { title: "Release / refund requests" };

export default async function ReleasesPage({ searchParams }: { searchParams: SearchParams }) {
  const actor = await requirePagePermission("release:read");
  const sp = await flatParams(searchParams);
  const view = (["open", "awaiting-me", "decided", "all"].includes(sp.view ?? "") ? sp.view : "open") as "open";
  const paging = clampPage(Number(sp.page), 25);
  const { rows, total, totalAmount } = await listReleaseRequests(actor, { q: sp.q, status: sp.status, view: sp.status ? "all" : view }, paging);
  const isInstitution = actor.role === "INSTITUTION_USER";
  const awaitingLabel = actor.role === "APPROVING_AUTHORITY" ? "Awaiting my decision" : actor.role === "OFFICER" ? "Awaiting scrutiny / completion" : isInstitution ? "Information requested" : null;
  return (
    <>
      <PageHeader
        title="Release / refund requests"
        description="Officer scrutiny → approving authority decision → completion recorded with evidence. No funds are moved by this portal."
        actions={
          <>
            {can(actor, "report:export") && <a className="btn-secondary" href={`/api/reports/release-requests${sp.status ? `?status=${sp.status}` : ""}`}><Download className="h-4 w-4" aria-hidden />Export CSV</a>}
            {can(actor, "release:create") && <Link className="btn-primary" href="/releases/new">New request</Link>}
          </>
        }
      />
      <Tabs
        active={sp.status ? "" : view}
        tabs={[
          { key: "open", label: "Open", href: "/releases?view=open" },
          ...(awaitingLabel ? [{ key: "awaiting-me", label: awaitingLabel, href: "/releases?view=awaiting-me" }] : []),
          { key: "decided", label: "Decided", href: "/releases?view=decided" },
          { key: "all", label: "All", href: "/releases?view=all" },
        ]}
      />
      <Card bodyClassName="p-0">
        <form className="flex flex-wrap items-end gap-2 border-b border-line p-4" role="search">
          <input type="hidden" name="view" value={view} />
          <div className="min-w-56 flex-1">
            <label className="field-label" htmlFor="rq">Search</label>
            <input id="rq" name="q" defaultValue={sp.q} className="input" placeholder="Request / instrument reference, institution" />
          </div>
          <div>
            <label className="field-label" htmlFor="rstatus">Status</label>
            <select id="rstatus" name="status" defaultValue={sp.status ?? ""} className="input">
              <option value="">Any</option>
              {Object.entries(RELEASE_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
          </div>
          <button className="btn-primary">Apply</button>
          <span className="ml-auto text-xs text-ink-muted">{total} request{total === 1 ? "" : "s"} · {formatINRShort(totalAmount)} requested</span>
        </form>
        {rows.length === 0 ? <div className="p-6"><EmptyState title="No requests in this view" /></div> : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead><tr><th>Request</th>{!isInstitution && <th>Institution</th>}<th>Instrument</th><th>Type</th><th className="num">Requested</th><th>Status</th><th>Last change</th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td className="whitespace-nowrap"><Link className="link kbd-ref" href={`/releases/${r.id}`}>{r.referenceNo}</Link> {r.isDemo && <DemoTag />}</td>
                    {!isInstitution && <td className="max-w-56 truncate">{r.institution.name}</td>}
                    <td className="kbd-ref whitespace-nowrap">{r.instrument.referenceNo}</td>
                    <td className="whitespace-nowrap">{RELEASE_TYPE_LABELS[r.type]}</td>
                    <td className="num whitespace-nowrap">{formatINR(r.requestedAmount)}</td>
                    <td><StatusBadge map={RELEASE_STATUS} value={r.status} /></td>
                    <td className="whitespace-nowrap text-xs">{formatDateTime(r.statusChangedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Pagination basePath="/releases" params={{ ...sp, view }} page={paging.page} pageSize={paging.pageSize} total={total} />
      </Card>
    </>
  );
}
