import Link from "next/link";
import { ArrowRight, Search } from "lucide-react";
import { requirePageActor } from "@/server/page";
import { can } from "@/server/auth/scope";
import { getAdminOverview, getDashboard } from "@/server/services/dashboard";
import { Card, EmptyState, PageHeader, StatTile, StatusBadge, Badge } from "@/components/ui";
import { ColumnChart, HBarChart } from "@/components/charts";
import { MaturityCell } from "@/components/instrument-bits";
import { INSTRUMENT_STATUS, ROLE_LABELS } from "@/lib/labels";
import { formatDateTime, formatINRShort, formatINR } from "@/lib/format";
import type { Actor } from "@/server/auth/actor";
import { actionLabel } from "@/lib/audit-labels";

export const metadata = { title: "Overview" };

export default async function DashboardPage() {
  const actor = await requirePageActor();
  if (actor.role === "ADMIN") return <AdminDashboard actor={actor} />;
  const d = await getDashboard(actor);
  const m = d.metrics;
  const isInstitution = actor.role === "INSTITUTION_USER";

  return (
    <>
      <PageHeader
        title={isInstitution ? "Institution overview" : "Regulation Bureau overview"}
        description={
          isInstitution
            ? "Your institution's security deposits and FDRs, open requests and upcoming deadlines."
            : `Figures cover records within your authorised scope (${ROLE_LABELS[actor.role]}). All values are computed from portal records.`
        }
        actions={
          <>
            {can(actor, "instrument:create") && <Link href="/instruments/new" className="btn-primary">New submission</Link>}
            {can(actor, "instrument:review") && <Link href="/verification" className="btn-primary">Open verification queue</Link>}
          </>
        }
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        <StatTile label="Active instruments (held)" value={m.activeCount} hint={`${formatINRShort(m.activeValue)} recorded value`} href="/instruments?view=active" />
        <StatTile label="Total recorded deposit value" value={formatINRShort(m.activeValue)} hint={formatINR(m.activeValue)} href="/instruments?view=active" />
        <StatTile label="Expiring within 30 days" value={m.expiring30} hint={`${m.expiring60} within 60 · ${m.expiringWindow} within ${d.settings.expiringSoonDays}`} href="/instruments?view=expiring&withinDays=30" tone={m.expiring30 ? "warning" : undefined} />
        <StatTile label="Matured awaiting action" value={m.maturedAwaiting} hint="No renewal or release started" href="/renewals" tone={m.maturedAwaiting ? "danger" : undefined} />
        <StatTile label="Pending verification" value={m.pendingVerification} hint="Submitted to accepted" href="/instruments?view=pending-verification" />
        <StatTile label="Unresolved discrepancies" value={m.withDiscrepancies} hint={`${m.missingDocs} missing mandatory documents`} href="/instruments?view=discrepancies" tone={m.withDiscrepancies ? "warning" : undefined} />
        <StatTile label="Renewals / replacements in progress" value={m.renewalsInProgress} href="/instruments?view=renewal" />
        <StatTile label="Pending release / refund requests" value={m.pendingReleases} hint={`${formatINRShort(m.pendingReleaseValue)} requested`} href="/releases?view=open" />
        <StatTile label="Overdue actions" value={m.overdue} hint={`${m.overdueInstruments} instruments · ${m.overdueReleases} requests`} href="/instruments?view=overdue" tone={m.overdue ? "danger" : undefined} />
        <Card className="col-span-2 md:col-span-3 xl:col-span-1" bodyClassName="p-4">
          <form action="/instruments" className="space-y-2">
            <label htmlFor="dash-q" className="text-xs font-medium text-ink-muted">Find an instrument</label>
            <div className="flex gap-2">
              <input id="dash-q" name="q" className="input" placeholder="Ref., number, bank, institution" />
              <button className="btn-secondary" aria-label="Search"><Search className="h-4 w-4" /></button>
            </div>
          </form>
        </Card>
      </div>

      <div className="mt-6 grid gap-4 xl:grid-cols-3">
        <Card title="Outstanding tasks" className="xl:col-span-1">
          {d.tasks.length === 0 ? (
            <EmptyState title="No tasks for this role" />
          ) : (
            <ul className="divide-y divide-line">
              {d.tasks.map((t) => (
                <li key={t.label}>
                  <Link href={t.href} className="flex items-center justify-between gap-3 py-2.5 hover:text-brand">
                    <span className="text-sm">{t.label}</span>
                    <span className="flex items-center gap-2">
                      <span className={`min-w-8 rounded px-2 py-0.5 text-center text-sm font-semibold tabular-nums ${t.count ? "bg-brand-soft text-brand" : "bg-surface-sunken text-ink-subtle"}`}>{t.count}</span>
                      <ArrowRight className="h-4 w-4 text-ink-subtle" aria-hidden />
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title="Held instruments by time to maturity" className="xl:col-span-1">
          <ColumnChart
            ariaLabel="Number of held instruments in each time-to-maturity bucket"
            valueLabel="Instruments"
            highlightKey="matured"
            data={d.maturityBuckets.map((b) => ({
              key: b.key,
              label: b.label,
              value: b.count,
              href: b.key === "matured" ? "/instruments?view=matured" : b.max ? `/instruments?view=expiring&withinDays=${b.max}` : "/instruments?view=active",
            }))}
          />
        </Card>
        <Card title="Records by workflow status" className="xl:col-span-1">
          <HBarChart
            ariaLabel="Number of records in each workflow status"
            valueLabel="Records"
            data={d.statusDistribution.map((s) => ({
              key: s.status,
              label: INSTRUMENT_STATUS[s.status]?.label ?? s.status,
              value: s.count,
              note: INSTRUMENT_STATUS[s.status]?.description,
              href: `/instruments?status=${s.status}`,
            }))}
          />
        </Card>
      </div>

      <div className="mt-6 grid gap-4 xl:grid-cols-5">
        <Card title={`Upcoming maturity (next ${d.settings.expiringSoonDays} days) and matured`} className="xl:col-span-3" bodyClassName="overflow-x-auto" actions={<Link href="/renewals" className="link text-xs">Renewal &amp; expiry →</Link>}>
          {d.upcoming.length === 0 ? (
            <div className="p-4"><EmptyState title="No held instruments mature in this window" /></div>
          ) : (
            <table className="table">
              <thead>
                <tr><th>Reference</th>{!isInstitution && <th>Institution</th>}<th className="num">Amount</th><th>Maturity</th><th>Action under way</th></tr>
              </thead>
              <tbody>
                {d.upcoming.map((i) => (
                  <tr key={i.id}>
                    <td className="whitespace-nowrap"><Link className="link kbd-ref" href={`/instruments/${i.id}`}>{i.referenceNo}</Link></td>
                    {!isInstitution && <td className="max-w-48 truncate" title={i.institution.name}>{i.institution.name}</td>}
                    <td className="num">{formatINR(i.amount)}</td>
                    <td><MaturityCell date={i.maturityDate} today={d.today} windowDays={d.settings.expiringSoonDays} status={i.status} /></td>
                    <td>
                      {i.renewalsAsOriginal[0] ? <Badge tone="info" title={i.renewalsAsOriginal[0].referenceNo}>Renewal in progress</Badge>
                        : i.releaseRequests[0] ? <Badge tone="accent" title={i.releaseRequests[0].referenceNo}>Release requested</Badge>
                        : <Badge tone="warning">None started</Badge>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
        <Card title="Recent workflow activity" className="xl:col-span-2">
          {d.activity.length === 0 ? (
            <EmptyState title="No recent activity" />
          ) : (
            <ol className="space-y-3">
              {d.activity.map((e) => (
                <li key={e.id.toString()} className="border-l-2 border-line pl-3">
                  <div className="text-sm font-medium">{actionLabel(e.action)}</div>
                  <div className="text-xs text-ink-subtle">
                    {formatDateTime(e.createdAt)} · {e.actorLabel.replace(/ <.*>$/, "")}
                  </div>
                  {e.resourceType === "Instrument" && <Link className="link text-xs" href={`/instruments/${e.resourceId}`}>Open record</Link>}
                  {e.resourceType === "ReleaseRequest" && <Link className="link text-xs" href={`/releases/${e.resourceId}`}>Open request</Link>}
                </li>
              ))}
            </ol>
          )}
        </Card>
      </div>
      <p className="mt-4 text-2xs text-ink-subtle">
        Definitions: <em>held</em> = accepted and not replaced/released; <em>matured</em> = maturity date on or before today (IST);
        <em> expiring</em> = held and maturing within the window; <em>overdue</em> = matured {d.settings.postMaturityEscalationDays[0]}+ days with no action,
        scrutiny beyond {d.settings.scrutinySlaDays} days, correction beyond {d.settings.correctionResponseDays} days, or release steps beyond {d.settings.releaseDecisionSlaDays} days.
        Thresholds are configurable demonstration defaults.
      </p>
    </>
  );
}

async function AdminDashboard({ actor }: { actor: Actor }) {
  const o = await getAdminOverview(actor);
  const count = (role: string) => o.usersByRole.filter((u) => u.role === role).reduce((a, u) => a + u._count._all, 0);
  const deliveries = (status: string) => o.deliveries.filter((d) => d.channel === "EMAIL" && d.status === status).reduce((a, d) => a + d._count._all, 0);
  return (
    <>
      <PageHeader title="System overview" description="Operational status for administrators. Financial records and documents are not visible to this role." actions={<Link className="btn-primary" href="/admin?tab=system">Monitoring job</Link>} />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatTile label="Pending institution registrations" value={o.pendingInstitutions} href="/institutions?status=PENDING_APPROVAL" tone={o.pendingInstitutions ? "warning" : undefined} hint="Awaiting approval" />
        <StatTile label="Institution users" value={count("INSTITUTION_USER")} hint={`${o.pendingUsers} pending activation`} href="/admin?tab=users" />
        <StatTile label="Bureau staff accounts" value={count("OFFICER") + count("APPROVING_AUTHORITY") + count("AUDITOR") + count("ADMIN")} href="/admin?tab=users" />
        <StatTile label="Simulated / failed email deliveries" value={`${deliveries("SIMULATED")} / ${deliveries("FAILED")}`} hint={`${deliveries("PENDING")} pending`} href="/admin?tab=system" />
      </div>
      <Card title="Recent monitoring runs" className="mt-6" bodyClassName="overflow-x-auto">
        {o.jobs.length === 0 ? <div className="p-4"><EmptyState title="The monitor has not run yet" /></div> : (
          <table className="table">
            <thead><tr><th>Started</th><th>Trigger</th><th>Status</th><th>Summary</th></tr></thead>
            <tbody>
              {o.jobs.map((j) => (
                <tr key={j.id}>
                  <td>{formatDateTime(j.startedAt)}</td>
                  <td>{j.trigger}</td>
                  <td><StatusBadge map={{ SUCCEEDED: { label: "Succeeded", tone: "success" }, FAILED: { label: "Failed", tone: "danger" }, RUNNING: { label: "Running", tone: "info" } }} value={j.status} /></td>
                  <td className="text-xs text-ink-muted">{j.error ?? (j.summary ? summarise(j.summary as Record<string, unknown>) : "—")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </>
  );
}

function summarise(s: Record<string, unknown>) {
  const keys = ["reminders", "maturityReached", "escalations", "overdueScrutiny", "overdueCorrections", "overdueReleases"];
  return keys.map((k) => `${k}: ${s[k] ?? 0}`).join(" · ");
}
