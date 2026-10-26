import Link from "next/link";
import { requirePageActor, flatParams, type SearchParams } from "@/server/page";
import { listNotifications } from "@/server/services/activity";
import { clampPage } from "@/server/services/common";
import { Badge, Card, EmptyState, PageHeader, Pagination, Tabs } from "@/components/ui";
import { ActionDialog } from "@/components/client/ActionDialog";
import { NOTIFICATION_TYPE_LABELS } from "@/lib/labels";
import { formatDate, formatDateTime } from "@/lib/format";

export const metadata = { title: "Notifications" };

export default async function NotificationsPage({ searchParams }: { searchParams: SearchParams }) {
  const actor = await requirePageActor();
  const sp = await flatParams(searchParams);
  const unreadOnly = sp.filter !== "all";
  const paging = clampPage(Number(sp.page), 25);
  const { rows, total, unread } = await listNotifications(actor, { unreadOnly }, paging);
  return (
    <>
      <PageHeader
        title="Notifications"
        description="In-app notifications are authoritative. Email copies are SIMULATED in this prototype — no external message is sent."
        actions={unread > 0 ? <ActionDialog label="Mark all as read" variant="secondary" url="/api/notifications/read" payload={{ ids: "all" }} direct /> : undefined}
      />
      <Tabs active={unreadOnly ? "unread" : "all"} tabs={[{ key: "unread", label: "Unread", href: "/notifications", count: unread }, { key: "all", label: "All", href: "/notifications?filter=all" }]} />
      <Card bodyClassName="p-0">
        {rows.length === 0 ? <div className="p-6"><EmptyState title={unreadOnly ? "You're all caught up" : "No notifications"} /></div> : (
          <ul className="divide-y divide-line">
            {rows.map((n) => {
              const email = n.deliveries.find((d) => d.channel === "EMAIL");
              return (
                <li key={n.id} className={`flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-start sm:justify-between ${n.readAt ? "" : "bg-brand-soft/40"}`}>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      {!n.readAt && <span className="h-2 w-2 rounded-full bg-brand" aria-label="Unread" />}
                      <Badge tone={["OVERDUE_ACTION", "ESCALATION", "MATURITY_REACHED"].includes(n.type) ? "danger" : n.type === "MATURITY_UPCOMING" || n.type === "CORRECTION_REQUESTED" ? "warning" : "info"}>{NOTIFICATION_TYPE_LABELS[n.type]}</Badge>
                      <span className="text-2xs text-ink-subtle">{formatDateTime(n.createdAt)}</span>
                      {n.dueDate && <span className="text-2xs text-ink-subtle">· due {formatDate(n.dueDate)}</span>}
                    </div>
                    <p className="mt-1 text-sm font-medium">{n.title}</p>
                    <p className="text-sm text-ink-muted">{n.message}</p>
                    {email && <p className="mt-1 text-2xs text-ink-subtle">Email channel: {email.status === "SIMULATED" ? "simulated (not sent)" : email.status.toLowerCase()}{email.lastError ? ` — ${email.lastError}` : ""}</p>}
                  </div>
                  <div className="flex shrink-0 gap-1">
                    {n.link && <Link className="btn-secondary btn-sm" href={n.link}>Open</Link>}
                    {!n.readAt && <ActionDialog label="Mark read" size="sm" variant="ghost" url="/api/notifications/read" payload={{ ids: [n.id] }} direct />}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        <Pagination basePath="/notifications" params={sp} page={paging.page} pageSize={paging.pageSize} total={total} />
      </Card>
    </>
  );
}
