import Link from "next/link";
import { redirect } from "next/navigation";
import { requirePagePermission, flatParams, type SearchParams } from "@/server/page";
import { listInstitutions } from "@/server/services/institutions";
import { clampPage } from "@/server/services/common";
import { prisma } from "@/server/db";
import { Card, DemoTag, EmptyState, PageHeader, Pagination, StatusBadge } from "@/components/ui";
import { INSTITUTION_STATUS } from "@/lib/labels";
import { formatINR } from "@/lib/format";

export const metadata = { title: "Institutions" };

export default async function InstitutionsPage({ searchParams }: { searchParams: SearchParams }) {
  const actor = await requirePagePermission("institution:read");
  if (actor.role === "INSTITUTION_USER" && actor.institutionId) redirect(`/institutions/${actor.institutionId}`);
  const sp = await flatParams(searchParams);
  const paging = clampPage(Number(sp.page), 25);
  const [{ rows, total, showFinancials }, regions] = await Promise.all([
    listInstitutions(actor, sp, paging),
    prisma.region.findMany({ orderBy: { name: "asc" } }),
  ]);
  return (
    <>
      <PageHeader title="Institutions" description={actor.role === "OFFICER" ? "Institutions in your assigned regions." : "Institution-wise records and registration status."} />
      <Card bodyClassName="p-0">
        <form className="flex flex-wrap items-end gap-2 border-b border-line p-4" role="search">
          <div className="min-w-56 flex-1"><label className="field-label" htmlFor="iq">Search</label><input id="iq" name="q" defaultValue={sp.q} className="input" placeholder="Name, code or city" /></div>
          <div>
            <label className="field-label" htmlFor="istatus">Status</label>
            <select id="istatus" name="status" defaultValue={sp.status ?? ""} className="input">
              <option value="">Any</option>
              {Object.entries(INSTITUTION_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
          </div>
          <div>
            <label className="field-label" htmlFor="iregion">Region</label>
            <select id="iregion" name="regionId" defaultValue={sp.regionId ?? ""} className="input">
              <option value="">Any</option>
              {regions.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          </div>
          <button className="btn-primary">Apply</button>
        </form>
        {rows.length === 0 ? <div className="p-6"><EmptyState title="No institutions match" /></div> : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead><tr><th>Institution</th><th>Code</th><th>Region</th><th>Location</th><th>Status</th>{showFinancials && <th className="num">Held instruments</th>}{showFinancials && <th className="num">Held value</th>}</tr></thead>
              <tbody>
                {rows.map((i) => (
                  <tr key={i.id}>
                    <td className="max-w-72"><Link className="link" href={`/institutions/${i.id}`}>{i.name}</Link> {i.isDemo && <DemoTag />}<div className="text-2xs text-ink-subtle">{i.category}</div></td>
                    <td className="kbd-ref whitespace-nowrap">{i.code}</td>
                    <td className="whitespace-nowrap">{i.region.name}</td>
                    <td className="whitespace-nowrap">{i.city}, {i.state}</td>
                    <td><StatusBadge map={INSTITUTION_STATUS} value={i.status} /></td>
                    {showFinancials && <td className="num">{"_count" in i ? (i._count as { instruments: number }).instruments : "—"}</td>}
                    {showFinancials && <td className="num whitespace-nowrap">{formatINR(i.heldValue)}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Pagination basePath="/institutions" params={sp} page={paging.page} pageSize={paging.pageSize} total={total} />
      </Card>
    </>
  );
}
