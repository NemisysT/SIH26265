import { requirePagePermission, flatParams, type SearchParams } from "@/server/page";
import { prisma } from "@/server/db";
import { listUsers } from "@/server/services/admin";
import { getSettings } from "@/server/settings";
import { Badge, Card, PageHeader, StatusBadge, Tabs, Alert } from "@/components/ui";
import { ActionDialog } from "@/components/client/ActionDialog";
import { CreateUserForm, EditUserForm, ReferenceForm, SettingsForm } from "@/components/client/AdminForms";
import { ROLE_LABELS } from "@/lib/labels";
import { formatDateTime } from "@/lib/format";
import { env } from "@/server/env";

export const metadata = { title: "Administration" };

export default async function AdminPage({ searchParams }: { searchParams: SearchParams }) {
  const actor = await requirePagePermission("admin:users");
  const sp = await flatParams(searchParams);
  const tab = ["users", "settings", "reference", "system"].includes(sp.tab ?? "") ? sp.tab! : "users";
  const regions = await prisma.region.findMany({ orderBy: { name: "asc" } });

  return (
    <>
      <PageHeader title="Administration" description="Accounts, roles, reference data, policy configuration and system health. Every change is audited; audit history cannot be edited from here." />
      <Tabs active={tab} tabs={[
        { key: "users", label: "Users & roles", href: "/admin?tab=users" },
        { key: "settings", label: "Notification & policy settings", href: "/admin?tab=settings" },
        { key: "reference", label: "Reference data", href: "/admin?tab=reference" },
        { key: "system", label: "System health", href: "/admin?tab=system" },
      ]} />
      {tab === "users" && <UsersTab actorId={actor.id} regions={regions} actor={actor} />}
      {tab === "settings" && (
        <Card title="Operational policy" actions={<span className="text-2xs text-ink-subtle">Demonstration defaults — not established AICTE deadlines</span>}>
          <SettingsForm initial={(await getSettings()) as unknown as Record<string, unknown>} />
        </Card>
      )}
      {tab === "reference" && <ReferenceTab regions={regions} />}
      {tab === "system" && <SystemTab />}
    </>
  );
}

async function UsersTab({ regions, actor }: { actorId: string; regions: { id: string; name: string }[]; actor: Parameters<typeof listUsers>[0] }) {
  const [users, institutions] = await Promise.all([listUsers(actor), prisma.institution.findMany({ where: { status: "ACTIVE" }, orderBy: { name: "asc" }, select: { id: true, name: true } })]);
  return (
    <div className="space-y-4">
      <Card title="Create account"><CreateUserForm regions={regions} institutions={institutions} /></Card>
      <Card title={`Accounts (${users.length})`} bodyClassName="overflow-x-auto p-0">
        <table className="table">
          <thead><tr><th>User</th><th>Role & scope</th><th>Status</th><th>Last sign-in</th><th>Change</th></tr></thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td className="max-w-64"><div className="font-medium">{u.name} {u.isDemo && <Badge tone="accent">DEMO</Badge>}</div><div className="kbd-ref truncate text-2xs text-ink-subtle">{u.email}</div></td>
                <td className="text-xs">{ROLE_LABELS[u.role]}<div className="text-ink-subtle">{u.institution?.name ?? u.officerRegions.map((r) => r.region.name).join(", ")}</div></td>
                <td><StatusBadge map={{ ACTIVE: { label: "Active", tone: "success" }, PENDING: { label: "Pending", tone: "warning" }, DISABLED: { label: "Disabled", tone: "danger" } }} value={u.status} /></td>
                <td className="whitespace-nowrap text-xs">{formatDateTime(u.lastLoginAt)}</td>
                <td className="min-w-72">{u.id === actor.id ? <span className="text-2xs text-ink-subtle">Your own account cannot change its role or status.</span> : <EditUserForm user={{ id: u.id, role: u.role, status: u.status, regionIds: u.officerRegions.map((r) => r.regionId) }} regions={regions} />}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

async function ReferenceTab({ regions }: { regions: { id: string; name: string; code: string; isActive: boolean }[] }) {
  const banks = await prisma.bankReference.findMany({ orderBy: { name: "asc" } });
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card title="Regions">
        <ul className="mb-4 divide-y divide-line">
          {regions.map((r) => (
            <li key={r.id} className="flex items-center justify-between py-2 text-sm">
              <span>{r.name} <span className="kbd-ref text-ink-subtle">{r.code}</span> {!r.isActive && <Badge tone="muted">inactive</Badge>}</span>
              <ActionDialog label={r.isActive ? "Deactivate" : "Activate"} size="sm" variant="ghost" method="PATCH" url={`/api/admin/reference/region/${r.id}`} payload={{ isActive: !r.isActive }} direct />
            </li>
          ))}
        </ul>
        <ReferenceForm kind="region" />
      </Card>
      <Card title="Bank reference list" actions={<span className="text-2xs text-ink-subtle">Used for suggestions and the unknown-bank check</span>}>
        <ul className="mb-4 divide-y divide-line">
          {banks.map((b) => (
            <li key={b.id} className="flex items-center justify-between py-2 text-sm">
              <span>{b.name} <span className="kbd-ref text-ink-subtle">{b.shortCode}</span> {b.isFictional && <Badge tone="accent">fictional</Badge>} {!b.isActive && <Badge tone="muted">inactive</Badge>}</span>
              <ActionDialog label={b.isActive ? "Deactivate" : "Activate"} size="sm" variant="ghost" method="PATCH" url={`/api/admin/reference/bank/${b.id}`} payload={{ isActive: !b.isActive }} direct />
            </li>
          ))}
        </ul>
        <ReferenceForm kind="bank" />
      </Card>
    </div>
  );
}

async function SystemTab() {
  const [jobs, deliveries, failed] = await Promise.all([
    prisma.jobRun.findMany({ orderBy: { startedAt: "desc" }, take: 15 }),
    prisma.notificationDelivery.groupBy({ by: ["channel", "status"], _count: { _all: true } }),
    prisma.notificationDelivery.findMany({ where: { status: "FAILED" }, orderBy: { updatedAt: "desc" }, take: 10 }),
  ]);
  return (
    <div className="space-y-4">
      <Card title="Maturity & escalation monitor" actions={<ActionDialog label="Run monitor now" url="/api/admin/monitor" confirm="Run the maturity/escalation monitor now? Reminders already sent for the same event are not duplicated." />}>
        <p className="text-sm text-ink-muted">
          Runs from the command line (<code className="kbd-ref">npm run monitor</code>), a scheduled cron job, or this button. It never depends on a browser being open.
          Email delivery mode: <strong>{env.emailMode === "simulated" ? "SIMULATED (no messages leave the system)" : "disabled"}</strong>.
        </p>
        <div className="mt-3 overflow-x-auto">
          <table className="table">
            <thead><tr><th>Started</th><th>Trigger</th><th>Status</th><th>Summary</th></tr></thead>
            <tbody>
              {jobs.map((j) => (
                <tr key={j.id}>
                  <td className="whitespace-nowrap text-xs">{formatDateTime(j.startedAt)}</td>
                  <td className="text-xs">{j.trigger}</td>
                  <td><StatusBadge map={{ SUCCEEDED: { label: "Succeeded", tone: "success" }, FAILED: { label: "Failed", tone: "danger" }, RUNNING: { label: "Running", tone: "info" } }} value={j.status} /></td>
                  <td className="max-w-xl text-2xs text-ink-muted"><code className="whitespace-pre-wrap break-all">{j.error ?? JSON.stringify(j.summary)}</code></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Notification deliveries" bodyClassName="p-0">
          <table className="table">
            <thead><tr><th>Channel</th><th>Status</th><th className="num">Count</th></tr></thead>
            <tbody>{deliveries.map((d) => <tr key={`${d.channel}-${d.status}`}><td>{d.channel}</td><td>{d.status}</td><td className="num">{d._count._all}</td></tr>)}</tbody>
          </table>
        </Card>
        <Card title="Recent delivery failures">
          {failed.length === 0 ? <Alert tone="success">No failed deliveries.</Alert> : (
            <ul className="space-y-1 text-xs">{failed.map((f) => <li key={f.id}>{formatDateTime(f.updatedAt)} · attempts {f.attempts} · {f.lastError}</li>)}</ul>
          )}
        </Card>
      </div>
    </div>
  );
}
