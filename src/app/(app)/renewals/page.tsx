import Link from "next/link";
import { requirePagePermission } from "@/server/page";
import { instrumentScope } from "@/server/auth/scope";
import { prisma } from "@/server/db";
import { getSettings } from "@/server/settings";
import * as rules from "@/server/services/rules";
import { Badge, Card, EmptyState, PageHeader, StatusBadge } from "@/components/ui";
import { MaturityCell } from "@/components/instrument-bits";
import { INSTRUMENT_STATUS, RENEWAL_STATUS } from "@/lib/labels";
import { formatDate, formatDateTime, formatINR } from "@/lib/format";
import { addDays, businessToday } from "@/lib/dates";
import { OPEN_RELEASE_STATUSES } from "@/server/workflow/release-machine";

export const metadata = { title: "Renewal & expiry" };

export default async function RenewalsPage() {
  const actor = await requirePagePermission("instrument:read");
  const settings = await getSettings();
  const today = businessToday();
  const scope = instrumentScope(actor);
  const include = {
    institution: { select: { name: true, code: true } },
    renewalsAsOriginal: { where: { status: "IN_PROGRESS" as const }, select: { referenceNo: true, newInstrumentId: true } },
    releaseRequests: { where: { status: { in: OPEN_RELEASE_STATUSES } }, select: { id: true, referenceNo: true } },
  };
  const [matured, expiring, cases] = await Promise.all([
    prisma.instrument.findMany({ where: { AND: [scope, rules.matured(today)] }, orderBy: { maturityDate: "asc" }, include }),
    prisma.instrument.findMany({ where: { AND: [scope, rules.expiringWithin(today, settings.expiringSoonDays)] }, orderBy: { maturityDate: "asc" }, include }),
    prisma.renewalCase.findMany({
      where: { originalInstrument: scope },
      orderBy: { submittedAt: "desc" },
      take: 50,
      include: { originalInstrument: { select: { id: true, referenceNo: true, institution: { select: { name: true } } } }, newInstrument: { select: { id: true, referenceNo: true, status: true } } },
    }),
  ]);
  const isInstitution = actor.role === "INSTITUTION_USER";
  const actionCell = (i: (typeof matured)[number]) =>
    i.renewalsAsOriginal[0] ? <Link href={`/instruments/${i.renewalsAsOriginal[0].newInstrumentId}`}><Badge tone="info">Renewal {i.renewalsAsOriginal[0].referenceNo}</Badge></Link>
    : i.releaseRequests[0] ? <Link href={`/releases/${i.releaseRequests[0].id}`}><Badge tone="accent">Release {i.releaseRequests[0].referenceNo}</Badge></Link>
    : isInstitution ? (
      <span className="flex flex-wrap gap-1">
        <Link className="btn-secondary btn-sm" href={`/instruments/${i.id}/renew`}>Renew / replace</Link>
        <Link className="btn-ghost btn-sm" href={`/releases/new?instrumentId=${i.id}`}>Request release</Link>
      </span>
    ) : <Badge tone="warning">No action started</Badge>;

  const table = (rows: typeof matured, empty: string) =>
    rows.length === 0 ? <div className="p-4"><EmptyState title={empty} /></div> : (
      <div className="overflow-x-auto">
        <table className="table">
          <thead><tr><th>Reference</th>{!isInstitution && <th>Institution</th>}<th>Bank</th><th className="num">Amount</th><th>Maturity</th><th>Action</th></tr></thead>
          <tbody>
            {rows.map((i) => (
              <tr key={i.id}>
                <td className="whitespace-nowrap"><Link className="link kbd-ref" href={`/instruments/${i.id}`}>{i.referenceNo}</Link></td>
                {!isInstitution && <td className="max-w-56 truncate">{i.institution.name}</td>}
                <td className="max-w-48 truncate">{i.bankName}</td>
                <td className="num whitespace-nowrap">{formatINR(i.amount)}</td>
                <td><MaturityCell date={i.maturityDate} today={today} windowDays={settings.expiringSoonDays} status={i.status} /></td>
                <td>{actionCell(i)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );

  return (
    <>
      <PageHeader
        title="Renewal & expiry"
        description={`Held instruments that have matured or mature within ${settings.expiringSoonDays} days (until ${formatDate(addDays(today, settings.expiringSoonDays))}). Reminders are sent at ${settings.reminderWindowsDays.join(", ")} days before maturity (demonstration defaults).`}
      />
      <div className="space-y-4">
        <Card title={`Matured (${matured.length})`} bodyClassName="p-0">{table(matured, "No matured held instruments")}</Card>
        <Card title={`Expiring within ${settings.expiringSoonDays} days (${expiring.length})`} bodyClassName="p-0">{table(expiring, "Nothing expiring in this window")}</Card>
        <Card title="Renewal / replacement cases" bodyClassName="p-0">
          {cases.length === 0 ? <div className="p-4"><EmptyState title="No renewal cases" /></div> : (
            <div className="overflow-x-auto">
              <table className="table">
                <thead><tr><th>Case</th><th>Original</th><th>New instrument</th><th>Maturity change</th><th>Status</th><th>Submitted</th></tr></thead>
                <tbody>
                  {cases.map((c) => (
                    <tr key={c.id}>
                      <td className="kbd-ref whitespace-nowrap">{c.referenceNo}<div className="font-sans text-2xs text-ink-subtle">{c.kind.toLowerCase()}</div></td>
                      <td><Link className="link kbd-ref" href={`/instruments/${c.originalInstrument.id}`}>{c.originalInstrument.referenceNo}</Link>{!isInstitution && <div className="text-2xs text-ink-subtle">{c.originalInstrument.institution.name}</div>}</td>
                      <td><Link className="link kbd-ref" href={`/instruments/${c.newInstrument.id}`}>{c.newInstrument.referenceNo}</Link><div><StatusBadge map={INSTRUMENT_STATUS} value={c.newInstrument.status} /></div></td>
                      <td className="whitespace-nowrap text-xs">{formatDate(c.previousMaturityDate)} → {formatDate(c.proposedMaturityDate)}</td>
                      <td><StatusBadge map={RENEWAL_STATUS} value={c.status} /></td>
                      <td className="whitespace-nowrap text-xs">{formatDateTime(c.submittedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </>
  );
}
