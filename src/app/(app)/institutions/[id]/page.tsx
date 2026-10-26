import Link from "next/link";
import { requirePagePermission, orNotFound } from "@/server/page";
import { can } from "@/server/auth/scope";
import { getInstitution } from "@/server/services/institutions";
import { searchInstruments } from "@/server/services/search";
import { Alert, Card, DemoTag, DescriptionList, PageHeader, StatusBadge } from "@/components/ui";
import { ActionDialog } from "@/components/client/ActionDialog";
import { INSTITUTION_STATUS, INSTRUMENT_STATUS } from "@/lib/labels";
import { formatDate, formatDateTime, formatINR } from "@/lib/format";

export const metadata = { title: "Institution" };

export default async function InstitutionDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requirePagePermission("institution:read");
  const { id } = await params;
  const inst = await orNotFound(getInstitution(actor, id));
  const instruments = can(actor, "instrument:read") ? await searchInstruments(actor, { institutionId: id, sort: "maturityDate", dir: "asc" }, { skip: 0, take: 50 }) : null;
  const manage = can(actor, "institution:manage-registration");
  return (
    <>
      <PageHeader
        breadcrumb={actor.role === "INSTITUTION_USER" ? undefined : [{ label: "Institutions", href: "/institutions" }]}
        title={<span className="flex flex-wrap items-center gap-2">{inst.name} <StatusBadge map={INSTITUTION_STATUS} value={inst.status} />{inst.isDemo && <DemoTag />}</span>}
        description={`${inst.code} · ${inst.category} · ${inst.region.name}`}
        actions={manage ? (
          <>
            {inst.status === "PENDING_APPROVAL" && <ActionDialog label="Approve registration" url={`/api/institutions/${id}/decision`} payload={{ action: "APPROVE" }} confirm="Activate this institution and its pending user accounts?" />}
            {inst.status === "PENDING_APPROVAL" && <ActionDialog label="Reject registration" variant="danger" url={`/api/institutions/${id}/decision`} payload={{ action: "REJECT" }} requiresNote noteLabel="Reason" />}
            {inst.status === "ACTIVE" && <ActionDialog label="Suspend" variant="danger" url={`/api/institutions/${id}/decision`} payload={{ action: "SUSPEND" }} requiresNote noteLabel="Reason" confirm="Suspended institutions keep their records but their users can no longer sign in." />}
            {inst.status === "SUSPENDED" && <ActionDialog label="Reactivate" url={`/api/institutions/${id}/decision`} payload={{ action: "REACTIVATE" }} requiresNote noteLabel="Reason" />}
          </>
        ) : undefined}
      />
      {inst.statusReason && <div className="mb-4"><Alert tone={inst.status === "ACTIVE" ? "info" : "warning"} title="Status note">{inst.statusReason}</Alert></div>}
      <div className="grid gap-4 xl:grid-cols-3">
        <Card title="Profile" className="xl:col-span-1">
          <DescriptionList columns={1} items={[
            { label: "Approval / application reference", value: inst.approvalReference },
            { label: "Address", value: `${inst.addressLine}, ${inst.city}, ${inst.state} ${inst.pincode}` },
            { label: "Contact", value: `${inst.contactName} · ${inst.contactPhone}` },
            { label: "Contact email", value: inst.contactEmail },
            { label: "Registered", value: formatDateTime(inst.createdAt) },
            { label: "Approved", value: formatDateTime(inst.approvedAt) },
          ]} />
          <div className="mt-4">
            <div className="text-xs font-medium text-ink-subtle">Users</div>
            <ul className="mt-1 space-y-1 text-sm">
              {inst.users.map((u) => <li key={u.id}>{u.name} <span className="text-xs text-ink-subtle">· {u.status.toLowerCase()}</span></li>)}
            </ul>
          </div>
        </Card>
        {instruments && (
          <Card title={`Instruments (${instruments.total})`} className="xl:col-span-2" bodyClassName="overflow-x-auto p-0" actions={<Link className="link text-xs" href={`/instruments?institutionId=${id}`}>Open in register →</Link>}>
            <table className="table">
              <thead><tr><th>Reference</th><th>Instrument</th><th className="num">Amount</th><th>Maturity</th><th>Status</th></tr></thead>
              <tbody>
                {instruments.rows.map((r) => (
                  <tr key={r.id}>
                    <td className="whitespace-nowrap"><Link className="link kbd-ref" href={`/instruments/${r.id}`}>{r.referenceNo}</Link></td>
                    <td className="max-w-56 truncate">{r.instrumentNumber ?? "—"} · {r.bankName ?? "—"}</td>
                    <td className="num whitespace-nowrap">{formatINR(r.amount)}</td>
                    <td className="whitespace-nowrap">{formatDate(r.maturityDate)}</td>
                    <td><StatusBadge map={INSTRUMENT_STATUS} value={r.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        )}
      </div>
    </>
  );
}
