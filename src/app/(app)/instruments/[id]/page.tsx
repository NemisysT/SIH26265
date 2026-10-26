import Link from "next/link";
import { ArrowRight, Download, Eye, Link2 } from "lucide-react";
import { requirePagePermission, orNotFound, flatParams, type SearchParams } from "@/server/page";
import { can } from "@/server/auth/scope";
import { prisma } from "@/server/db";
import { getInstrumentDetail } from "@/server/services/instruments";
import { computeInstrumentFindings } from "@/server/services/checks";
import { recordHistory } from "@/server/services/activity";
import { getSettings } from "@/server/settings";
import { getVerificationProvider } from "@/server/verification/provider";
import { INSTRUMENT_TRANSITIONS, availableActions, type InstrumentStatusName, INSTITUTION_DOCUMENT_STATUSES } from "@/server/workflow/instrument-machine";
import { OPEN_RELEASE_STATUSES } from "@/server/workflow/release-machine";
import { Alert, Badge, Card, DemoTag, DescriptionList, EmptyState, PageHeader, StatusBadge } from "@/components/ui";
import { ActionDialog } from "@/components/client/ActionDialog";
import { UploadForm } from "@/components/client/UploadForm";
import { VerificationForm } from "@/components/client/VerificationForm";
import { CommentForm } from "@/components/client/CommentForm";
import { DiscrepancyForm } from "@/components/client/DiscrepancyForm";
import { MaturityCell } from "@/components/instrument-bits";
import {
  DISCREPANCY_STATUS, DOCUMENT_REVIEW, DOCUMENT_TYPE_LABELS, INSTRUMENT_STATUS, INSTRUMENT_TYPE_LABELS, RELEASE_STATUS,
  RENEWAL_STATUS, VERIFICATION_METHOD_LABELS, VERIFICATION_SOURCE_LABELS, VERIFICATION_STATUS,
} from "@/lib/labels";
import { actionLabel } from "@/lib/audit-labels";
import { formatBytes, formatDate, formatDateTime, formatINR } from "@/lib/format";
import { businessToday } from "@/lib/dates";

export const metadata = { title: "Instrument" };

export default async function InstrumentDetailPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SearchParams }) {
  const actor = await requirePagePermission("instrument:read");
  const { id } = await params;
  const sp = await flatParams(searchParams);
  const inst = await orNotFound(getInstrumentDetail(actor, id));
  const settings = await getSettings();
  const today = businessToday();
  const isOwner = actor.role === "INSTITUTION_USER" && actor.institutionId === inst.institutionId;
  const status = inst.status as InstrumentStatusName;
  const isStaff = can(actor, "comment:internal");

  const history = await recordHistory(actor, [id, ...inst.releaseRequests.map((r) => r.id), ...(inst.renewalAsNew ? [inst.renewalAsNew.id] : []), ...inst.renewalsAsOriginal.map((r) => r.id)]);
  const preview = status === "DRAFT" || status === "CORRECTION_REQUIRED" ? await prisma.$transaction((tx) => computeInstrumentFindings(tx, id)) : null;
  const uploaderIds = [...new Set(inst.documents.map((d) => d.uploadedById))];
  const uploaders = new Map((await prisma.user.findMany({ where: { id: { in: uploaderIds } }, select: { id: true, name: true, role: true } })).map((u) => [u.id, u]));

  const actions = availableActions(status).filter((a) => {
    const rule = INSTRUMENT_TRANSITIONS[a];
    if (rule.permission === "instrument:edit-own") return isOwner;
    return can(actor, rule.permission);
  });
  const openRelease = inst.releaseRequests.find((r) => (OPEN_RELEASE_STATUSES as string[]).includes(r.status));
  const openRenewal = inst.renewalsAsOriginal.find((r) => r.status === "IN_PROGRESS");
  const canUploadInstitution = isOwner && INSTITUTION_DOCUMENT_STATUSES.includes(status);
  const canUploadOfficer = can(actor, "document:upload-officer") && ["UNDER_REVIEW", "VERIFICATION_PENDING"].includes(status);
  const canReviewDocs = can(actor, "document:review") && ["UNDER_REVIEW", "VERIFICATION_PENDING"].includes(status);
  const openDiscrepancies = inst.discrepancies.filter((d) => d.status === "OPEN");
  const provider = getVerificationProvider();
  const currentDocs = inst.documents.filter((d) => d.isCurrent);
  const olderDocs = inst.documents.filter((d) => !d.isCurrent);

  return (
    <>
      <PageHeader
        breadcrumb={[{ label: "Security Deposits & FDRs", href: "/instruments" }]}
        title={
          <span className="flex flex-wrap items-center gap-2">
            <span className="kbd-ref text-lg">{inst.referenceNo}</span>
            <StatusBadge map={INSTRUMENT_STATUS} value={inst.status} />
            {inst.status !== "DRAFT" && <Badge tone={VERIFICATION_STATUS[inst.verificationStatus].tone}>Verification: {VERIFICATION_STATUS[inst.verificationStatus].label}</Badge>}
            {inst.origin === "LEGACY_IMPORT" && <Badge tone="neutral">Legacy import</Badge>}
            {inst.isDemo && <DemoTag />}
          </span>
        }
        description={`${INSTRUMENT_TYPE_LABELS[inst.type]} · ${inst.institution.name} (${inst.institution.code}) · ${inst.institution.region.name}`}
        actions={
          <>
            {isOwner && ["DRAFT", "CORRECTION_REQUIRED"].includes(status) && (
              <Link className="btn-secondary" href={`/instruments/${id}/edit`}>{status === "DRAFT" ? "Edit draft" : "Correct values"}</Link>
            )}
            {actions.map((a) => {
              const rule = INSTRUMENT_TRANSITIONS[a];
              return (
                <ActionDialog
                  key={a}
                  label={rule.label}
                  url={`/api/instruments/${id}/transitions`}
                  payload={{ action: a, expectedVersion: inst.version }}
                  confirm={rule.confirm}
                  requiresNote={rule.requiresNote}
                  noteLabel={a === "RESUBMIT" ? "Describe the corrections made" : undefined}
                  variant={a === "REJECT" || a === "WITHDRAW" ? "danger" : a === "START_REVIEW" || a === "SUBMIT" || a === "ACCEPT" || a === "RESUBMIT" ? "primary" : "secondary"}
                />
              );
            })}
            {isOwner && status === "ACCEPTED" && !openRenewal && !openRelease && can(actor, "renewal:submit") && (
              <Link className="btn-secondary" href={`/instruments/${id}/renew`}>Renew / replace</Link>
            )}
            {isOwner && ["ACCEPTED", "REPLACED"].includes(status) && !openRelease && !openRenewal && (
              <Link className="btn-secondary" href={`/releases/new?instrumentId=${id}`}>Request release / refund</Link>
            )}
          </>
        }
      />

      <div className="mb-4 space-y-2">
        {sp.saved && <Alert tone="success">Saved.</Alert>}
        {status === "DRAFT" && <Alert tone="info" title="Draft — not submitted">This draft is visible only to your institution. Upload the receipt and submit when complete. A draft is not a verified instrument.</Alert>}
        {status === "CORRECTION_REQUIRED" && <Alert tone="warning" title="Correction required">{inst.comments.filter((c) => c.authorLabel.includes("Request correction")).at(-1)?.body ?? "The Bureau requested a correction."}</Alert>}
        {status === "REJECTED" && <Alert tone="danger" title="Rejected">{inst.decisionReason}</Alert>}
        {status === "WITHDRAWN" && <Alert tone="info" title="Withdrawn">{inst.decisionReason}</Alert>}
        {status === "REPLACED" && <Alert tone="info" title="Replaced">This instrument was superseded by an accepted renewal/replacement. Its original values and documents are preserved below.</Alert>}
        {status === "RELEASED" && <Alert tone="info" title="Release recorded">Release/refund completion was recorded in the portal. No funds are moved by this system.</Alert>}
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          <Card title="Institution-submitted details" actions={<span className="text-2xs text-ink-subtle">As entered by the institution — not independently verified unless stated below</span>}>
            <DescriptionList
              columns={3}
              items={[
                { label: "Instrument / receipt no.", value: inst.instrumentNumber ? <span className="kbd-ref">{inst.instrumentNumber}</span> : <span className="text-tone-danger">Not recorded</span> },
                { label: "Issuing bank", value: inst.bankName ?? <span className="text-tone-danger">Not recorded</span> },
                { label: "Branch", value: inst.branchName },
                { label: "IFSC", value: inst.ifscCode ? <span className="kbd-ref">{inst.ifscCode}</span> : "—" },
                { label: "Amount", value: <strong>{formatINR(inst.amount)}</strong> },
                { label: "Currency", value: inst.currency },
                { label: "Issue date", value: formatDate(inst.issueDate) },
                { label: "Maturity date", value: <MaturityCell date={inst.maturityDate} today={today} windowDays={settings.expiringSoonDays} status={inst.status} /> },
                { label: "Validity / lien end", value: formatDate(inst.validUntil) },
                { label: "Purpose", value: inst.purpose },
                { label: "Submitted", value: formatDateTime(inst.submittedAt) },
                { label: "First submitted", value: formatDateTime(inst.firstSubmittedAt) },
              ]}
            />
            {inst.notes && <p className="mt-4 rounded-md bg-surface px-3 py-2 text-sm text-ink-muted">{inst.notes}</p>}
          </Card>

          {preview && (
            <Card title="Pre-submission checks">
              {preview.length === 0 ? (
                <p className="text-sm text-tone-success">No automated findings. Checks are review aids and do not verify the instrument.</p>
              ) : (
                <ul className="space-y-1.5 text-sm">
                  {preview.map((f) => (
                    <li key={f.code} className="flex items-start gap-2">
                      <Badge tone={f.severity === "BLOCKING" ? "danger" : "warning"}>{f.severity === "BLOCKING" ? "Blocking" : "Warning"}</Badge>
                      <span>{f.message}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          )}

          <Card title={`Documents (${currentDocs.length} current)`} bodyClassName="p-0">
            {currentDocs.length === 0 ? (
              <div className="p-4"><EmptyState title="No documents uploaded">{isOwner ? "Upload the FDR / deposit receipt before submitting." : "Missing mandatory documents are flagged as discrepancies."}</EmptyState></div>
            ) : (
              <div className="overflow-x-auto">
                <table className="table">
                  <thead><tr><th>Document</th><th>Uploaded</th><th>SHA-256</th><th>Review</th><th className="num">Actions</th></tr></thead>
                  <tbody>
                    {currentDocs.map((d) => (
                      <tr key={d.id}>
                        <td className="max-w-64">
                          <div className="font-medium">{DOCUMENT_TYPE_LABELS[d.docType]}</div>
                          <div className="truncate text-xs text-ink-muted" title={d.originalName}>{d.originalName} · v{d.version} · {formatBytes(d.sizeBytes)} · {d.mimeType}</div>
                        </td>
                        <td className="text-xs"><div className="whitespace-nowrap">{formatDateTime(d.uploadedAt)}</div><div className="max-w-40 truncate text-ink-subtle" title={uploaders.get(d.uploadedById)?.name}>{uploaders.get(d.uploadedById)?.name ?? "—"}</div></td>
                        <td className="text-xs"><span className="kbd-ref" title={`SHA-256 ${d.sha256}`}>{d.sha256.slice(0, 12)}…</span></td>
                        <td>
                          <StatusBadge map={DOCUMENT_REVIEW} value={d.reviewStatus} />
                          {d.reviewNote && <div className="mt-1 text-xs text-ink-muted">{d.reviewNote}</div>}
                        </td>
                        <td>
                          <div className="flex flex-wrap justify-end gap-1">
                            {can(actor, "document:download") ? (
                              <>
                                <a className="btn-ghost btn-sm" href={`/api/documents/${d.id}?inline=1`} target="_blank" rel="noopener"><Eye className="h-3.5 w-3.5" aria-hidden />Preview</a>
                                <a className="btn-ghost btn-sm" href={`/api/documents/${d.id}`}><Download className="h-3.5 w-3.5" aria-hidden />Download</a>
                              </>
                            ) : (
                              <span className="text-2xs text-ink-subtle" title="Auditors can view document metadata only">Metadata only</span>
                            )}
                            {canReviewDocs && d.docType !== "BANK_VERIFICATION_LETTER" && d.reviewStatus === "PENDING" && (
                              <>
                                <ActionDialog label="Accept" size="sm" variant="secondary" url={`/api/documents/${d.id}/review`} payload={{ status: "ACCEPTED" }} title="Accept document" confirm="Mark this document as reviewed and acceptable? This is a document review, not bank confirmation." noteLabel="Observation (optional)" />
                                <ActionDialog label="Reject" size="sm" variant="danger" url={`/api/documents/${d.id}/review`} payload={{ status: "REJECTED" }} title="Reject document" requiresNote />
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {olderDocs.length > 0 && (
              <details className="border-t border-line px-4 py-2 text-xs">
                <summary className="cursor-pointer text-ink-muted">{olderDocs.length} superseded version(s) retained</summary>
                <ul className="mt-2 space-y-1">
                  {olderDocs.map((d) => (
                    <li key={d.id}>
                      {DOCUMENT_TYPE_LABELS[d.docType]} v{d.version} — {d.originalName} ({formatDateTime(d.uploadedAt)}){" "}
                      {can(actor, "document:download") && <a className="link" href={`/api/documents/${d.id}`}>download</a>}
                    </li>
                  ))}
                </ul>
              </details>
            )}
            {(canUploadInstitution || canUploadOfficer) && (
              <div className="border-t border-line p-4">
                <UploadForm
                  url={`/api/instruments/${id}/documents`}
                  maxMb={settings.maxUploadMb}
                  docTypes={
                    canUploadInstitution
                      ? (inst.replacesInstrumentId ? ["FDR_RECEIPT", "DEPOSIT_CONFIRMATION", "RENEWAL_DOCUMENT", "OTHER"] : ["FDR_RECEIPT", "DEPOSIT_CONFIRMATION", "OTHER"]).map((t) => ({ value: t, label: DOCUMENT_TYPE_LABELS[t] }))
                      : [{ value: "BANK_VERIFICATION_LETTER", label: DOCUMENT_TYPE_LABELS.BANK_VERIFICATION_LETTER }]
                  }
                />
              </div>
            )}
          </Card>

          {inst.status !== "DRAFT" && (
            <Card
              title={`Discrepancies (${openDiscrepancies.length} open)`}
              actions={
                can(actor, "discrepancy:manage") && !["DRAFT", "WITHDRAWN"].includes(status) ? (
                  <ActionDialog label="Re-run automated checks" size="sm" variant="secondary" url={`/api/instruments/${id}/checks`} direct />
                ) : undefined
              }
            >
              {inst.discrepancies.length === 0 ? (
                <p className="text-sm text-ink-muted">No discrepancies recorded.</p>
              ) : (
                <ul className="divide-y divide-line">
                  {inst.discrepancies.map((d) => (
                    <li key={d.id} className="flex flex-col gap-2 py-2.5 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <StatusBadge map={DISCREPANCY_STATUS} value={d.status} />
                          <Badge tone={d.severity === "BLOCKING" ? "danger" : "warning"}>{d.severity === "BLOCKING" ? "Blocking" : "Warning"}</Badge>
                          <Badge tone="neutral">{d.source === "AUTOMATED" ? "Automated check" : "Officer observation"}</Badge>
                          <span className="text-2xs text-ink-subtle">{formatDateTime(d.raisedAt)}</span>
                        </div>
                        <p className="mt-1 text-sm">{d.message}</p>
                        {d.resolutionNote && <p className="mt-1 text-xs text-ink-muted">Resolution: {d.resolutionNote} ({formatDateTime(d.resolvedAt)})</p>}
                      </div>
                      {d.status === "OPEN" && can(actor, "discrepancy:manage") && !(d.source === "AUTOMATED" && d.severity === "BLOCKING") && (
                        <div className="flex shrink-0 gap-1">
                          {d.source === "OFFICER" && <ActionDialog label="Resolve" size="sm" variant="secondary" url={`/api/discrepancies/${d.id}/resolve`} payload={{ outcome: "RESOLVED" }} title="Resolve discrepancy" requiresNote noteLabel="How was it resolved?" />}
                          <ActionDialog label="Waive" size="sm" variant="secondary" url={`/api/discrepancies/${d.id}/resolve`} payload={{ outcome: "WAIVED" }} title="Waive discrepancy" requiresNote noteLabel="Reason for waiving" confirm="Waiving records an authorised decision to proceed despite this finding." />
                        </div>
                      )}
                      {d.status === "OPEN" && d.source === "AUTOMATED" && d.severity === "BLOCKING" && (
                        <span className="text-2xs text-ink-subtle sm:max-w-40 sm:text-right">Closes automatically when a correction removes the condition</span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              {can(actor, "discrepancy:manage") && !["DRAFT", "WITHDRAWN", "REJECTED", "RELEASED"].includes(status) && <div className="mt-3"><DiscrepancyForm instrumentId={id} /></div>}
            </Card>
          )}

          {inst.status !== "DRAFT" && (
            <Card title="Verification record" bodyClassName="p-0">
              {inst.verifications.length === 0 ? (
                <div className="p-4 text-sm text-ink-muted">No verification activity yet.</div>
              ) : (
                <ul className="divide-y divide-line">
                  {inst.verifications.map((v) => (
                    <li key={v.id} className="px-4 py-3">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <StatusBadge map={VERIFICATION_STATUS} value={v.result} />
                        <Badge tone="neutral">{VERIFICATION_METHOD_LABELS[v.method]}</Badge>
                        <Badge tone="muted">Source: {VERIFICATION_SOURCE_LABELS[v.source]}</Badge>
                        {v.isSimulated && <Badge tone="accent">DEMO / SIMULATED</Badge>}
                        {v.independentlyConfirmed ? <Badge tone="success">Independently confirmed</Badge> : v.result === "CONFIRMED" ? <Badge tone="warning">Not independently confirmed</Badge> : null}
                        <span className="text-2xs text-ink-subtle">{formatDateTime(v.attemptedAt)} · {v.initiatedBy}</span>
                      </div>
                      {v.observations && <p className="mt-1 text-sm">{v.observations}</p>}
                      {v.discrepancyDetails && <pre className="mt-1 whitespace-pre-wrap font-sans text-xs text-ink-muted">{v.discrepancyDetails}</pre>}
                      {v.evidenceReference && <p className="mt-1 text-xs text-ink-muted">Evidence reference: <span className="kbd-ref">{v.evidenceReference}</span>{v.providerName ? ` · ${v.providerName}` : ""}</p>}
                    </li>
                  ))}
                </ul>
              )}
              {can(actor, "verification:record") && ["UNDER_REVIEW", "VERIFICATION_PENDING"].includes(status) && (
                <div className="space-y-4 border-t border-line p-4">
                  <VerificationForm
                    instrumentId={id}
                    version={inst.version}
                    requireIndependent={settings.requireIndependentConfirmation}
                    bankLetters={inst.documents.filter((d) => d.docType === "BANK_VERIFICATION_LETTER" && d.isCurrent).map((d) => ({ id: d.id, label: `${d.originalName} (v${d.version})` }))}
                  />
                  <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3">
                    {provider ? (
                      <ActionDialog label="Query external provider" size="sm" variant="secondary" url={`/api/instruments/${id}/external-verification`} title="External verification" confirm={provider.isSimulated ? "The configured provider is a DEMO / SIMULATED adapter. Its result is recorded as simulated and cannot confirm the instrument." : "Query the configured verification provider."} />
                    ) : (
                      <span className="text-xs text-ink-subtle">No external bank-verification provider is configured.</span>
                    )}
                  </div>
                </div>
              )}
            </Card>
          )}

          <Card title="Correspondence">
            {inst.comments.length === 0 ? <p className="text-sm text-ink-muted">No messages.</p> : (
              <ol className="space-y-3">
                {inst.comments.map((c) => (
                  <li key={c.id} className={`rounded-md border px-3 py-2 ${c.visibility === "INTERNAL" ? "border-tone-accent/30 bg-tone-accent-bg/40" : "border-line"}`}>
                    <div className="flex flex-wrap items-center gap-2 text-2xs text-ink-subtle">
                      <span className="font-semibold text-ink-muted">{c.authorLabel}</span>
                      <span>{formatDateTime(c.createdAt)}</span>
                      {c.visibility === "INTERNAL" && <Badge tone="accent">Internal</Badge>}
                    </div>
                    <p className="mt-1 whitespace-pre-wrap text-sm">{c.body}</p>
                  </li>
                ))}
              </ol>
            )}
            {(isOwner || can(actor, "instrument:review") || actor.role === "APPROVING_AUTHORITY") && (
              <div className="mt-4"><CommentForm url={`/api/instruments/${id}/comments`} allowInternal={isStaff && actor.role !== "AUDITOR"} /></div>
            )}
          </Card>
        </div>

        <div className="space-y-4">
          <Card title="Lifecycle links">
            <div className="space-y-3 text-sm">
              {inst.replaces ? (
                <div>
                  <div className="text-xs font-medium text-ink-subtle">{inst.renewalAsNew?.kind === "REPLACEMENT" ? "Replaces" : "Renews"}</div>
                  <Link className="link kbd-ref" href={`/instruments/${inst.replaces.id}`}>{inst.replaces.referenceNo}</Link>{" "}
                  <StatusBadge map={INSTRUMENT_STATUS} value={inst.replaces.status} />
                  <div className="text-xs text-ink-muted">Original maturity {formatDate(inst.replaces.maturityDate)} · {formatINR(inst.replaces.amount)}</div>
                  {inst.renewalAsNew && (
                    <div className="mt-1 text-xs text-ink-muted">Case {inst.renewalAsNew.referenceNo}: <StatusBadge map={RENEWAL_STATUS} value={inst.renewalAsNew.status} /> — {inst.renewalAsNew.reason}</div>
                  )}
                </div>
              ) : null}
              {inst.renewalsAsOriginal.length > 0 && (
                <div>
                  <div className="text-xs font-medium text-ink-subtle">Renewal / replacement attempts</div>
                  <ul className="mt-1 space-y-1">
                    {inst.renewalsAsOriginal.map((r) => (
                      <li key={r.id} className="flex flex-wrap items-center gap-1.5">
                        <Link2 className="h-3.5 w-3.5 text-ink-subtle" aria-hidden />
                        <Link className="link kbd-ref" href={`/instruments/${r.newInstrument.id}`}>{r.newInstrument.referenceNo}</Link>
                        <StatusBadge map={RENEWAL_STATUS} value={r.status} />
                        <span className="text-2xs text-ink-subtle">{r.kind.toLowerCase()} · {formatDate(r.previousMaturityDate)} → {formatDate(r.proposedMaturityDate)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {!inst.replaces && inst.renewalsAsOriginal.length === 0 && <p className="text-ink-muted">No renewal or replacement linked.</p>}
            </div>
          </Card>

          <Card title="Release / refund">
            {inst.releaseRequests.length === 0 ? (
              <p className="text-sm text-ink-muted">No requests.</p>
            ) : (
              <ul className="space-y-2">
                {inst.releaseRequests.map((r) => (
                  <li key={r.id} className="flex items-center justify-between gap-2">
                    <span>
                      <Link className="link kbd-ref" href={`/releases/${r.id}`}>{r.referenceNo}</Link>
                      <div className="text-2xs text-ink-subtle">{formatDateTime(r.submittedAt)} · {formatINR(r.requestedAmount)}</div>
                    </span>
                    <StatusBadge map={RELEASE_STATUS} value={r.status} />
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title="Record history" bodyClassName="max-h-[32rem] overflow-y-auto p-4">
            {history.length === 0 ? <p className="text-sm text-ink-muted">No events.</p> : (
              <ol className="space-y-2.5">
                {history.map((e) => (
                  <li key={e.id.toString()} className="border-l-2 border-line pl-3">
                    <div className="text-sm font-medium">{actionLabel(e.action)}</div>
                    <div className="text-2xs text-ink-subtle">{formatDateTime(e.createdAt)} · {e.actorLabel.replace(/ <.*>$/, "")}</div>
                    {e.reason && <div className="mt-0.5 text-xs text-ink-muted">“{e.reason}”</div>}
                  </li>
                ))}
              </ol>
            )}
            {can(actor, "audit:read") && <Link href={`/audit?q=${id}`} className="link mt-3 inline-flex items-center gap-1 text-xs">Full audit detail <ArrowRight className="h-3 w-3" /></Link>}
          </Card>
        </div>
      </div>
    </>
  );
}
