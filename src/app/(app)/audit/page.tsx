import Link from "next/link";
import { Download } from "lucide-react";
import { requirePagePermission, flatParams, type SearchParams } from "@/server/page";
import { can } from "@/server/auth/scope";
import { listAudit } from "@/server/services/activity";
import { clampPage } from "@/server/services/common";
import { Alert, Card, EmptyState, PageHeader, Pagination } from "@/components/ui";
import { actionLabel } from "@/lib/audit-labels";
import { formatDateTime } from "@/lib/format";

export const metadata = { title: "Audit logs" };

function linkFor(type: string, id: string) {
  if (type === "Instrument") return `/instruments/${id}`;
  if (type === "ReleaseRequest") return `/releases/${id}`;
  if (type === "Institution") return `/institutions/${id}`;
  return null;
}

export default async function AuditPage({ searchParams }: { searchParams: SearchParams }) {
  const actor = await requirePagePermission("audit:read");
  const sp = await flatParams(searchParams);
  const paging = clampPage(Number(sp.page), 50);
  const { rows, total } = await listAudit(actor, sp, paging);
  const exportQs = new URLSearchParams(Object.entries({ from: sp.from, to: sp.to }).filter(([, v]) => v) as [string, string][]).toString();
  return (
    <>
      <PageHeader
        title="Audit logs"
        description="Append-only record of material actions. The database rejects updates and deletes on audit events; there is no interface to modify them."
        actions={can(actor, "audit:export") ? <a className="btn-secondary" href={`/api/reports/audit-log${exportQs ? `?${exportQs}` : ""}`}><Download className="h-4 w-4" aria-hidden />Export CSV</a> : undefined}
      />
      {actor.role === "ADMIN" && <div className="mb-3"><Alert tone="info">Administrators can review the audit log but cannot alter it.</Alert></div>}
      <Card bodyClassName="p-0">
        <form className="grid gap-3 border-b border-line p-4 sm:grid-cols-3 lg:grid-cols-6" role="search">
          <div className="lg:col-span-2"><label className="field-label" htmlFor="aq">Actor, resource ID or reason</label><input id="aq" name="q" defaultValue={sp.q} className="input" /></div>
          <div><label className="field-label" htmlFor="aaction">Action contains</label><input id="aaction" name="action" defaultValue={sp.action} className="input" placeholder="e.g. RELEASE" /></div>
          <div>
            <label className="field-label" htmlFor="atype">Resource type</label>
            <select id="atype" name="resourceType" defaultValue={sp.resourceType ?? ""} className="input">
              <option value="">Any</option>
              {["Instrument", "ReleaseRequest", "RenewalCase", "Institution", "User", "SystemSetting", "Report", "JobRun", "Region", "BankReference"].map((t) => <option key={t}>{t}</option>)}
            </select>
          </div>
          <div><label className="field-label" htmlFor="afrom">From</label><input id="afrom" name="from" type="date" defaultValue={sp.from} className="input" /></div>
          <div><label className="field-label" htmlFor="ato">To</label><input id="ato" name="to" type="date" defaultValue={sp.to} className="input" /></div>
          <div className="flex gap-2 sm:col-span-3 lg:col-span-6"><button className="btn-primary">Filter</button><Link className="btn-ghost" href="/audit">Clear</Link><span className="ml-auto self-center text-xs text-ink-muted">{total} events</span></div>
        </form>
        {rows.length === 0 ? <div className="p-6"><EmptyState title="No audit events match" /></div> : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead><tr><th>#</th><th>Time</th><th>Actor</th><th>Action</th><th>Resource</th><th>Details</th></tr></thead>
              <tbody>
                {rows.map((e) => {
                  const href = linkFor(e.resourceType, e.resourceId);
                  return (
                    <tr key={e.id.toString()}>
                      <td className="kbd-ref text-ink-subtle">{e.id.toString()}</td>
                      <td className="whitespace-nowrap text-xs">{formatDateTime(e.createdAt)}</td>
                      <td className="max-w-56 text-xs"><div className="truncate" title={e.actorLabel}>{e.actorLabel}</div><div className="text-ink-subtle">{e.actorRole}</div></td>
                      <td className="text-xs"><div className="font-medium">{actionLabel(e.action)}</div><div className="kbd-ref text-ink-subtle">{e.action}</div></td>
                      <td className="text-xs">{e.resourceType}<div className="kbd-ref text-ink-subtle">{href ? <Link className="link" href={href}>{e.resourceId.slice(0, 8)}…</Link> : e.resourceId.slice(0, 18)}</div></td>
                      <td className="max-w-md text-xs">
                        {e.reason && <div className="mb-1">“{e.reason}”</div>}
                        {(e.before || e.after) && (
                          <details>
                            <summary className="cursor-pointer text-ink-subtle">Before / after</summary>
                            <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap rounded bg-surface-sunken p-2 text-2xs">{JSON.stringify({ before: e.before, after: e.after }, null, 2)}</pre>
                          </details>
                        )}
                        {e.correlationId && <div className="kbd-ref text-2xs text-ink-subtle">corr {e.correlationId.slice(0, 8)}</div>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <Pagination basePath="/audit" params={sp} page={paging.page} pageSize={paging.pageSize} total={total} />
      </Card>
    </>
  );
}
