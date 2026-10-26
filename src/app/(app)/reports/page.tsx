import { Download } from "lucide-react";
import { requirePagePermission } from "@/server/page";
import { can, instrumentScope, releaseScope } from "@/server/auth/scope";
import { prisma } from "@/server/db";
import { getSettings } from "@/server/settings";
import { INSTRUMENT_VIEWS } from "@/server/services/search";
import * as rules from "@/server/services/rules";
import { Card, PageHeader } from "@/components/ui";
import { INSTRUMENT_STATUS, RELEASE_STATUS } from "@/lib/labels";
import { formatINR } from "@/lib/format";
import { businessToday } from "@/lib/dates";

export const metadata = { title: "Reports" };

export default async function ReportsPage() {
  const actor = await requirePagePermission("report:export");
  const settings = await getSettings();
  const today = businessToday();
  const scope = instrumentScope(actor);
  const [byStatus, byBank, releases, matured, expiring] = await Promise.all([
    prisma.instrument.groupBy({ by: ["status"], where: scope, _count: { _all: true }, _sum: { amount: true }, orderBy: { status: "asc" } }),
    prisma.instrument.groupBy({ by: ["bankName"], where: { AND: [scope, rules.held] }, _count: { _all: true }, _sum: { amount: true }, orderBy: { _sum: { amount: "desc" } } }),
    prisma.releaseRequest.groupBy({ by: ["status"], where: releaseScope(actor), _count: { _all: true }, _sum: { requestedAmount: true }, orderBy: { status: "asc" } }),
    prisma.instrument.aggregate({ where: { AND: [scope, rules.matured(today)] }, _count: true, _sum: { amount: true } }),
    prisma.instrument.aggregate({ where: { AND: [scope, rules.expiringWithin(today, settings.expiringSoonDays)] }, _count: true, _sum: { amount: true } }),
  ]);
  const sum = (rows: { _count: { _all: number }; _sum: Record<string, unknown> }[], key: string) => ({
    count: rows.reduce((a, r) => a + r._count._all, 0),
    amount: rows.reduce((a, r) => a + Math.round(Number((r._sum[key] as { toString(): string } | null)?.toString() ?? 0) * 100), 0) / 100,
  });
  const statusTotal = sum(byStatus, "amount");
  const bankTotal = sum(byBank, "amount");
  const releaseTotal = sum(releases, "requestedAmount");

  const downloads = [
    { kind: "instrument-register", title: "Instrument register", desc: "All instruments in your scope with status, verification and maturity state. Supports the same filters as the list (append query parameters)." },
    { kind: "maturity-schedule", title: "Maturity schedule", desc: "Held instruments matured or maturing within 180 days, ordered by date." },
    { kind: "release-requests", title: "Release / refund requests", desc: "Requests with decisions, reasons and completion references." },
    { kind: "discrepancies", title: "Open discrepancies", desc: "Unresolved automated and officer findings." },
    ...(can(actor, "audit:export") ? [{ kind: "audit-log", title: "Audit log", desc: "Append-only audit events (auditor export)." }] : []),
  ];

  return (
    <>
      <PageHeader title="Reports" description="Summaries and CSV exports are computed from the same authorised scope as the on-screen records. Every export is recorded in the audit trail." />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Downloads (CSV)" className="lg:col-span-2" bodyClassName="p-0">
          <ul className="divide-y divide-line">
            {downloads.map((d) => (
              <li key={d.kind} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div><div className="font-medium">{d.title}</div><div className="text-xs text-ink-muted">{d.desc}</div></div>
                <a className="btn-secondary btn-sm" href={`/api/reports/${d.kind}`}><Download className="h-3.5 w-3.5" aria-hidden />Download CSV</a>
              </li>
            ))}
          </ul>
          <div className="border-t border-line px-4 py-3 text-xs text-ink-muted">
            Quick filtered registers:{" "}
            {Object.entries(INSTRUMENT_VIEWS).filter(([k]) => !["all", "drafts"].includes(k)).map(([k, label], i) => (
              <span key={k}>{i > 0 && " · "}<a className="link" href={`/api/reports/instrument-register?view=${k}`}>{label}</a></span>
            ))}
          </div>
        </Card>

        <Card title="Instruments by workflow status" bodyClassName="p-0">
          <table className="table">
            <thead><tr><th>Status</th><th className="num">Records</th><th className="num">Recorded amount</th></tr></thead>
            <tbody>
              {byStatus.map((r) => <tr key={r.status}><td>{INSTRUMENT_STATUS[r.status]?.label}</td><td className="num">{r._count._all}</td><td className="num">{formatINR(r._sum.amount)}</td></tr>)}
              <tr className="font-semibold"><td>Total</td><td className="num">{statusTotal.count}</td><td className="num">{formatINR(statusTotal.amount)}</td></tr>
            </tbody>
          </table>
        </Card>

        <Card title="Held instruments by issuing bank" bodyClassName="p-0">
          <table className="table">
            <thead><tr><th>Bank (as submitted)</th><th className="num">Held</th><th className="num">Amount</th></tr></thead>
            <tbody>
              {byBank.map((r) => <tr key={r.bankName ?? "none"}><td>{r.bankName ?? "Not recorded"}</td><td className="num">{r._count._all}</td><td className="num">{formatINR(r._sum.amount)}</td></tr>)}
              <tr className="font-semibold"><td>Total</td><td className="num">{bankTotal.count}</td><td className="num">{formatINR(bankTotal.amount)}</td></tr>
            </tbody>
          </table>
        </Card>

        <Card title="Maturity position">
          <dl className="grid grid-cols-2 gap-4">
            <div><dt className="text-xs text-ink-subtle">Matured, still held</dt><dd className="text-lg font-semibold">{matured._count} · {formatINR(matured._sum.amount)}</dd></div>
            <div><dt className="text-xs text-ink-subtle">Expiring within {settings.expiringSoonDays} days</dt><dd className="text-lg font-semibold">{expiring._count} · {formatINR(expiring._sum.amount)}</dd></div>
          </dl>
        </Card>

        <Card title="Release / refund requests by status" bodyClassName="p-0">
          <table className="table">
            <thead><tr><th>Status</th><th className="num">Requests</th><th className="num">Requested</th></tr></thead>
            <tbody>
              {releases.map((r) => <tr key={r.status}><td>{RELEASE_STATUS[r.status]?.label}</td><td className="num">{r._count._all}</td><td className="num">{formatINR(r._sum.requestedAmount)}</td></tr>)}
              <tr className="font-semibold"><td>Total</td><td className="num">{releaseTotal.count}</td><td className="num">{formatINR(releaseTotal.amount)}</td></tr>
            </tbody>
          </table>
        </Card>
      </div>
    </>
  );
}
