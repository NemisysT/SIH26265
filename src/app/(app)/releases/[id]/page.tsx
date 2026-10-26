import Link from "next/link";
import { Download, Eye } from "lucide-react";
import { requirePagePermission, orNotFound } from "@/server/page";
import { can } from "@/server/auth/scope";
import { prisma } from "@/server/db";
import { getReleaseDetail, releaseActionsFor } from "@/server/services/releases";
import { recordHistory } from "@/server/services/activity";
import { getSettings } from "@/server/settings";
import { RELEASE_TRANSITIONS } from "@/server/workflow/release-machine";
import { Alert, Badge, Card, DemoTag, DescriptionList, PageHeader, StatusBadge } from "@/components/ui";
import { ActionDialog } from "@/components/client/ActionDialog";
import { UploadForm } from "@/components/client/UploadForm";
import { DISCREPANCY_STATUS, DOCUMENT_TYPE_LABELS, INSTRUMENT_STATUS, RELEASE_STATUS, RELEASE_TYPE_LABELS } from "@/lib/labels";
import { actionLabel } from "@/lib/audit-labels";
import { formatBytes, formatDate, formatDateTime, formatINR } from "@/lib/format";

export const metadata = { title: "Release / refund request" };

const STEPS = [
  { key: "SUBMITTED", label: "Submitted" },
  { key: "UNDER_SCRUTINY", label: "Officer scrutiny" },
  { key: "PENDING_APPROVAL", label: "Authority decision" },
  { key: "APPROVED", label: "Approved" },
  { key: "COMPLETED", label: "Completion recorded" },
];

export default async function ReleaseDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requirePagePermission("release:read");
  const { id } = await params;
  const rr = await orNotFound(getReleaseDetail(actor, id));
  const settings = await getSettings();
  const history = await recordHistory(actor, [id]);
  const people = new Map(
    (await prisma.user.findMany({ where: { id: { in: [rr.scrutinizedById, rr.decidedById, rr.completedById, rr.assignedOfficerId, ...rr.documents.map((d) => d.uploadedById)].filter(Boolean) as string[] } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]),
  );
  const isOwner = actor.role === "INSTITUTION_USER" && actor.institutionId === rr.institutionId;
  const actions = releaseActionsFor(actor, rr).filter((a) => !["PROVIDE_INFO", "WITHDRAW"].includes(a) || isOwner);
  const stepIndex = STEPS.findIndex((s) => s.key === (rr.status === "INFO_REQUESTED" ? "UNDER_SCRUTINY" : rr.status));
  const canUploadSupporting = isOwner && ["SUBMITTED", "INFO_REQUESTED"].includes(rr.status);
  const canUploadEvidence = can(actor, "release:complete") && rr.status === "APPROVED";
  const hasEvidence = rr.documents.some((d) => d.docType === "RELEASE_COMPLETION_EVIDENCE" && d.isCurrent);

  return (
    <>
      <PageHeader
        breadcrumb={[{ label: "Release / Refund Requests", href: "/releases" }]}
        title={<span className="flex flex-wrap items-center gap-2"><span className="kbd-ref text-lg">{rr.referenceNo}</span><StatusBadge map={RELEASE_STATUS} value={rr.status} />{rr.isDemo && <DemoTag />}</span>}
        description={`${RELEASE_TYPE_LABELS[rr.type]} · ${rr.institution.name} (${rr.institution.code})`}
        actions={actions.map((a) => {
          const rule = RELEASE_TRANSITIONS[a];
          return (
            <ActionDialog
              key={a}
              label={rule.label}
              url={`/api/releases/${id}/actions`}
              payload={{ action: a, expectedVersion: rr.version }}
              confirm={a === "COMPLETE" && !hasEvidence ? `${rule.confirm} Upload the completion evidence document first — completion is refused without it.` : rule.confirm}
              requiresNote={rule.requiresNote}
              noteLabel={a === "FORWARD" ? "Scrutiny observations" : a === "APPROVE" || a === "REJECT" ? "Decision reason" : a === "COMPLETE" ? "Completion note (optional)" : undefined}
              fields={a === "COMPLETE" ? [{ name: "completionReference", label: "Completion reference (e.g. bank discharge advice no.)", required: true }] : undefined}
              variant={a === "REJECT" || a === "WITHDRAW" ? "danger" : a === "APPROVE" || a === "FORWARD" || a === "COMPLETE" || a === "START_SCRUTINY" ? "primary" : "secondary"}
            />
          );
        })}
      />

      <ol className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-5" aria-label="Request progress">
        {STEPS.map((s, i) => {
          const terminal = ["REJECTED", "WITHDRAWN"].includes(rr.status);
          const done = !terminal && i <= stepIndex;
          return (
            <li key={s.key} className={`rounded-md border px-3 py-2 text-xs ${done ? "border-brand/40 bg-brand-soft text-brand" : "border-line bg-surface-raised text-ink-subtle"}`} aria-current={i === stepIndex ? "step" : undefined}>
              <span className="font-semibold">{i + 1}.</span> {s.label}
            </li>
          );
        })}
      </ol>

      <div className="mb-4 space-y-2">
        {rr.status === "INFO_REQUESTED" && <Alert tone="warning" title="Further information requested">{rr.infoRequestNote}</Alert>}
        {rr.status === "REJECTED" && <Alert tone="danger" title="Rejected">{rr.decisionReason}</Alert>}
        {rr.status === "APPROVED" && <Alert tone="info" title="Approved — awaiting completion">Approval authorises processing. The request stays open until an officer records completion with a reference and evidence. No funds are moved by this portal.</Alert>}
        {rr.status === "COMPLETED" && <Alert tone="success" title="Completion recorded">Recorded on {formatDateTime(rr.completedAt)} with reference {rr.completionReference}. This is a record of processing performed outside the portal.</Alert>}
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          <Card title="Request">
            <DescriptionList
              items={[
                { label: "Instrument", value: <span><Link className="link kbd-ref" href={`/instruments/${rr.instrument.id}`}>{rr.instrument.referenceNo}</Link> <StatusBadge map={INSTRUMENT_STATUS} value={rr.instrument.status} /></span> },
                { label: "Instrument no. / bank", value: `${rr.instrument.instrumentNumber ?? "—"} · ${rr.instrument.bankName ?? "—"}` },
                { label: "Recorded instrument amount", value: formatINR(rr.instrument.amount) },
                { label: "Maturity date", value: formatDate(rr.instrument.maturityDate) },
                { label: "Requested amount", value: <strong>{formatINR(rr.requestedAmount)}</strong> },
                { label: "Submitted", value: formatDateTime(rr.submittedAt) },
              ]}
            />
            <div className="mt-4">
              <div className="text-xs font-medium text-ink-subtle">Grounds stated by the institution</div>
              <p className="mt-1 whitespace-pre-wrap text-sm">{rr.reason}</p>
            </div>
          </Card>

          <Card title="Scrutiny, decision and completion">
            <DescriptionList
              columns={1}
              items={[
                { label: "Scrutinising officer", value: rr.assignedOfficerId ? people.get(rr.assignedOfficerId) : "Not yet assigned" },
                { label: "Scrutiny observations", value: rr.scrutinyNote ? <span className="whitespace-pre-wrap">{rr.scrutinyNote}<span className="block text-2xs text-ink-subtle">{people.get(rr.scrutinizedById ?? "")} · {formatDateTime(rr.scrutinizedAt)}</span></span> : "—" },
                { label: "Decision", value: rr.decision ? <span><Badge tone={rr.decision === "APPROVED" ? "success" : "danger"}>{rr.decision}</Badge> {rr.decisionReason}<span className="block text-2xs text-ink-subtle">{people.get(rr.decidedById ?? "")} · {formatDateTime(rr.decidedAt)}</span></span> : "Pending" },
                { label: "Completion", value: rr.completedAt ? `${rr.completionReference} — ${rr.completionNote ?? ""} (${people.get(rr.completedById ?? "")}, ${formatDateTime(rr.completedAt)})` : "Not recorded" },
              ]}
            />
          </Card>

          <Card title="Documents" bodyClassName="p-0">
            <ul className="divide-y divide-line">
              {rr.documents.map((d) => (
                <li key={d.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <div className="text-sm font-medium">{DOCUMENT_TYPE_LABELS[d.docType]} {!d.isCurrent && <Badge tone="muted">superseded</Badge>}</div>
                    <div className="truncate text-xs text-ink-muted">{d.originalName} · v{d.version} · {formatBytes(d.sizeBytes)} · {formatDateTime(d.uploadedAt)} · {people.get(d.uploadedById)} · SHA-256 <span className="kbd-ref">{d.sha256.slice(0, 12)}…</span></div>
                  </div>
                  {can(actor, "document:download") ? (
                    <div className="flex gap-1">
                      <a className="btn-ghost btn-sm" href={`/api/documents/${d.id}?inline=1`} target="_blank" rel="noopener"><Eye className="h-3.5 w-3.5" aria-hidden />Preview</a>
                      <a className="btn-ghost btn-sm" href={`/api/documents/${d.id}`}><Download className="h-3.5 w-3.5" aria-hidden />Download</a>
                    </div>
                  ) : <span className="text-2xs text-ink-subtle">Metadata only</span>}
                </li>
              ))}
            </ul>
            {(canUploadSupporting || canUploadEvidence) && (
              <div className="border-t border-line p-4">
                <UploadForm
                  url={`/api/releases/${id}/documents`}
                  maxMb={settings.maxUploadMb}
                  label={canUploadEvidence ? "Upload evidence" : "Upload document"}
                  docTypes={canUploadEvidence ? [{ value: "RELEASE_COMPLETION_EVIDENCE", label: DOCUMENT_TYPE_LABELS.RELEASE_COMPLETION_EVIDENCE }] : [{ value: "RELEASE_SUPPORTING", label: DOCUMENT_TYPE_LABELS.RELEASE_SUPPORTING }, { value: "OTHER", label: DOCUMENT_TYPE_LABELS.OTHER }]}
                />
              </div>
            )}
          </Card>

          <Card title="Correspondence">
            {rr.comments.length === 0 ? <p className="text-sm text-ink-muted">No messages.</p> : (
              <ol className="space-y-3">
                {rr.comments.map((c) => (
                  <li key={c.id} className="rounded-md border border-line px-3 py-2">
                    <div className="text-2xs text-ink-subtle"><span className="font-semibold text-ink-muted">{c.authorLabel}</span> · {formatDateTime(c.createdAt)}</div>
                    <p className="mt-1 whitespace-pre-wrap text-sm">{c.body}</p>
                  </li>
                ))}
              </ol>
            )}
          </Card>
        </div>

        <div className="space-y-4">
          <Card title="Automated findings">
            {rr.discrepancies.length === 0 ? <p className="text-sm text-ink-muted">No findings.</p> : (
              <ul className="space-y-2">
                {rr.discrepancies.map((d) => (
                  <li key={d.id}>
                    <div className="flex flex-wrap gap-1"><StatusBadge map={DISCREPANCY_STATUS} value={d.status} /><Badge tone={d.severity === "BLOCKING" ? "danger" : "warning"}>{d.severity === "BLOCKING" ? "Blocking" : "Warning"}</Badge></div>
                    <p className="mt-1 text-sm">{d.message}</p>
                    {d.resolutionNote && <p className="text-xs text-ink-muted">{d.resolutionNote}</p>}
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card title="Request history" bodyClassName="max-h-[28rem] overflow-y-auto p-4">
            <ol className="space-y-2.5">
              {history.map((e) => (
                <li key={e.id.toString()} className="border-l-2 border-line pl-3">
                  <div className="text-sm font-medium">{actionLabel(e.action)}</div>
                  <div className="text-2xs text-ink-subtle">{formatDateTime(e.createdAt)} · {e.actorLabel.replace(/ <.*>$/, "")}</div>
                  {e.reason && <div className="mt-0.5 text-xs text-ink-muted">“{e.reason}”</div>}
                </li>
              ))}
            </ol>
          </Card>
        </div>
      </div>
    </>
  );
}
