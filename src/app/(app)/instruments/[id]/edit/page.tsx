import { notFound } from "next/navigation";
import { requirePagePermission, orNotFound } from "@/server/page";
import { prisma } from "@/server/db";
import { getInstrumentDetail } from "@/server/services/instruments";
import { PageHeader, Card, Alert } from "@/components/ui";
import { InstrumentForm } from "@/components/client/InstrumentForm";
import { toDateOnlyString } from "@/lib/dates";

export const metadata = { title: "Edit instrument" };

export default async function EditInstrumentPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requirePagePermission("instrument:edit-own");
  const { id } = await params;
  const inst = await orNotFound(getInstrumentDetail(actor, id));
  if (!["DRAFT", "CORRECTION_REQUIRED"].includes(inst.status)) notFound();
  const banks = await prisma.bankReference.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, select: { name: true } });
  const latestRequest = inst.comments.filter((c) => c.authorLabel.includes("Request correction")).at(-1);
  return (
    <>
      <PageHeader title={`${inst.status === "DRAFT" ? "Edit draft" : "Correct"} ${inst.referenceNo}`} breadcrumb={[{ label: "Security Deposits & FDRs", href: "/instruments" }, { label: inst.referenceNo, href: `/instruments/${id}` }]} />
      {inst.status === "CORRECTION_REQUIRED" && latestRequest && (
        <div className="mb-4"><Alert tone="warning" title="Correction requested by the Bureau">{latestRequest.body}</Alert></div>
      )}
      <Card>
        <InstrumentForm
          mode="edit"
          instrumentId={id}
          expectedVersion={inst.version}
          lockType={inst.status !== "DRAFT"}
          banks={banks.map((b) => b.name)}
          initial={{
            type: inst.type,
            instrumentNumber: inst.instrumentNumber ?? "",
            bankName: inst.bankName ?? "",
            branchName: inst.branchName ?? "",
            ifscCode: inst.ifscCode ?? "",
            amount: inst.amount?.toFixed(2) ?? "",
            issueDate: toDateOnlyString(inst.issueDate) ?? "",
            maturityDate: toDateOnlyString(inst.maturityDate) ?? "",
            validUntil: toDateOnlyString(inst.validUntil) ?? "",
            purpose: inst.purpose ?? "",
            notes: inst.notes ?? "",
          }}
        />
      </Card>
    </>
  );
}
