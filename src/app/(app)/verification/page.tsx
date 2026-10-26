import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { requirePagePermission, flatParams, type SearchParams } from "@/server/page";
import { instrumentScope } from "@/server/auth/scope";
import { prisma } from "@/server/db";
import { getSettings } from "@/server/settings";
import { Badge, Card, EmptyState, PageHeader, StatusBadge, Tabs } from "@/components/ui";
import { INSTRUMENT_STATUS, VERIFICATION_STATUS } from "@/lib/labels";
import { formatDateTime, formatINR } from "@/lib/format";

export const metadata = { title: "Verification queue" };

export default async function VerificationQueuePage({ searchParams }: { searchParams: SearchParams }) {
  const actor = await requirePagePermission("instrument:review");
  const sp = await flatParams(searchParams);
  const settings = await getSettings();
  const scope = instrumentScope(actor);
  const TABS: Record<string, { label: string; where: Prisma.InstrumentWhereInput }> = {
    pending: { label: "Pending scrutiny", where: { status: "PENDING_SCRUTINY" } },
    mine: { label: "Under my review", where: { status: { in: ["UNDER_REVIEW", "VERIFICATION_PENDING"] }, reviewerId: actor.id } },
    review: { label: "All under review", where: { status: { in: ["UNDER_REVIEW", "VERIFICATION_PENDING"] } } },
    verified: { label: "Verified — awaiting acceptance", where: { status: "VERIFIED" } },
    corrections: { label: "Awaiting institution correction", where: { status: "CORRECTION_REQUIRED" } },
    discrepancies: { label: "Open discrepancies", where: { status: { notIn: ["DRAFT", "WITHDRAWN"] }, discrepancies: { some: { status: "OPEN" } } } },
  };
  const tab = sp.tab && TABS[sp.tab] ? sp.tab : "pending";
  const counts = await Promise.all(Object.entries(TABS).map(async ([k, t]) => [k, await prisma.instrument.count({ where: { AND: [scope, t.where] } })] as const));
  const rows = await prisma.instrument.findMany({
    where: { AND: [scope, TABS[tab].where] },
    orderBy: [{ statusChangedAt: "asc" }],
    take: 100,
    include: {
      institution: { select: { name: true, code: true } },
      discrepancies: { where: { status: "OPEN" }, select: { severity: true } },
      renewalAsNew: { select: { kind: true } },
      _count: { select: { documents: { where: { isCurrent: true } } } },
    },
  });
  const slaMs = settings.scrutinySlaDays * 86_400_000;

  return (
    <>
      <PageHeader title="Verification queue" description={`Oldest first. Records waiting longer than ${settings.scrutinySlaDays} days are marked overdue (configurable).`} />
      <Tabs active={tab} tabs={Object.entries(TABS).map(([k, t]) => ({ key: k, label: t.label, href: `/verification?tab=${k}`, count: counts.find(([c]) => c === k)?.[1] }))} />
      <Card bodyClassName="p-0">
        {rows.length === 0 ? <div className="p-6"><EmptyState title="Nothing in this queue" /></div> : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead><tr><th>Reference</th><th>Institution</th><th className="num">Amount</th><th>Status</th><th>In status since</th><th>Flags</th><th></th></tr></thead>
              <tbody>
                {rows.map((r) => {
                  const overdue = ["PENDING_SCRUTINY", "UNDER_REVIEW", "VERIFICATION_PENDING"].includes(r.status) && Date.now() - r.statusChangedAt.getTime() > slaMs;
                  const blocking = r.discrepancies.filter((d) => d.severity === "BLOCKING").length;
                  return (
                    <tr key={r.id}>
                      <td className="whitespace-nowrap"><Link className="link kbd-ref" href={`/instruments/${r.id}`}>{r.referenceNo}</Link>
                        <div className="text-2xs text-ink-subtle">{r.renewalAsNew ? `${r.renewalAsNew.kind.toLowerCase()} of an earlier instrument` : r.origin === "LEGACY_IMPORT" ? "legacy import" : r.type === "FDR" ? "FDR" : "Security deposit"}</div>
                      </td>
                      <td className="max-w-56"><div className="truncate">{r.institution.name}</div><div className="kbd-ref text-2xs text-ink-subtle">{r.institution.code}</div></td>
                      <td className="num whitespace-nowrap">{formatINR(r.amount)}</td>
                      <td><div className="flex flex-col items-start gap-1"><StatusBadge map={INSTRUMENT_STATUS} value={r.status} /><StatusBadge map={VERIFICATION_STATUS} value={r.verificationStatus} /></div></td>
                      <td className="whitespace-nowrap text-xs">{formatDateTime(r.statusChangedAt)}{overdue && <div className="mt-0.5"><Badge tone="danger">Overdue</Badge></div>}</td>
                      <td><div className="flex flex-wrap gap-1">
                        {blocking > 0 && <Badge tone="danger">{blocking} blocking</Badge>}
                        {r.discrepancies.length - blocking > 0 && <Badge tone="warning">{r.discrepancies.length - blocking} warning</Badge>}
                        {r._count.documents === 0 && <Badge tone="danger">No documents</Badge>}
                      </div></td>
                      <td className="num"><Link href={`/instruments/${r.id}`} className="btn-secondary btn-sm">Review</Link></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
