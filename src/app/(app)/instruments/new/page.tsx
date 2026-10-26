import { requirePagePermission } from "@/server/page";
import { prisma } from "@/server/db";
import { PageHeader, Card, Alert } from "@/components/ui";
import { InstrumentForm } from "@/components/client/InstrumentForm";

export const metadata = { title: "New submission" };

export default async function NewInstrumentPage() {
  const actor = await requirePagePermission("instrument:create");
  const [banks, institution] = await Promise.all([
    prisma.bankReference.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, select: { name: true } }),
    prisma.institution.findUnique({ where: { id: actor.institutionId! }, select: { status: true, name: true } }),
  ]);
  return (
    <>
      <PageHeader title="New security deposit / FDR" description={`Recording for ${institution?.name ?? "your institution"}.`} breadcrumb={[{ label: "Security Deposits & FDRs", href: "/instruments" }]} />
      {institution?.status !== "ACTIVE" && <div className="mb-4"><Alert tone="warning" title="Institution not active">Your institution must be approved before records can be created or submitted.</Alert></div>}
      <Card><InstrumentForm mode="create" banks={banks.map((b) => b.name)} /></Card>
    </>
  );
}
