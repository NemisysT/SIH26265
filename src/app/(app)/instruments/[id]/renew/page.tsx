import { notFound } from "next/navigation";
import { requirePagePermission, orNotFound } from "@/server/page";
import { prisma } from "@/server/db";
import { getInstrumentDetail } from "@/server/services/instruments";
import { PageHeader, Card, DescriptionList } from "@/components/ui";
import { InstrumentForm } from "@/components/client/InstrumentForm";
import { formatDate, formatINR } from "@/lib/format";

export const metadata = { title: "Renew or replace" };

export default async function RenewPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requirePagePermission("renewal:submit");
  const { id } = await params;
  const inst = await orNotFound(getInstrumentDetail(actor, id));
  if (inst.status !== "ACCEPTED") notFound();
  const banks = await prisma.bankReference.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, select: { name: true } });
  return (
    <>
      <PageHeader title={`Renew or replace ${inst.referenceNo}`} breadcrumb={[{ label: "Security Deposits & FDRs", href: "/instruments" }, { label: inst.referenceNo, href: `/instruments/${id}` }]} />
      <div className="grid gap-4 xl:grid-cols-3">
        <Card title="Original instrument (unchanged)" className="xl:order-2">
          <DescriptionList columns={1} items={[
            { label: "Instrument number", value: inst.instrumentNumber },
            { label: "Bank / branch", value: `${inst.bankName ?? "—"} · ${inst.branchName ?? "—"}` },
            { label: "Amount", value: formatINR(inst.amount) },
            { label: "Issue → maturity", value: `${formatDate(inst.issueDate)} → ${formatDate(inst.maturityDate)}` },
          ]} />
        </Card>
        <Card title="New instrument" className="xl:col-span-2 xl:order-1">
          <InstrumentForm mode="renew" originalId={id} banks={banks.map((b) => b.name)} initial={{ type: inst.type, bankName: inst.bankName ?? "", branchName: inst.branchName ?? "", amount: inst.amount?.toFixed(2) ?? "", purpose: inst.purpose ?? "" }} />
        </Card>
      </div>
    </>
  );
}
