import { requirePagePermission, flatParams, type SearchParams } from "@/server/page";
import { prisma } from "@/server/db";
import { instrumentScope } from "@/server/auth/scope";
import { getSettings } from "@/server/settings";
import { OPEN_RELEASE_STATUSES } from "@/server/workflow/release-machine";
import { Card, PageHeader, Alert } from "@/components/ui";
import { ReleaseRequestForm } from "@/components/client/ReleaseRequestForm";
import { formatDate, formatINR } from "@/lib/format";

export const metadata = { title: "New release / refund request" };

export default async function NewReleasePage({ searchParams }: { searchParams: SearchParams }) {
  const actor = await requirePagePermission("release:create");
  const sp = await flatParams(searchParams);
  const settings = await getSettings();
  const eligible = await prisma.instrument.findMany({
    where: {
      AND: [
        instrumentScope(actor),
        { status: { in: ["ACCEPTED", "REPLACED"] } },
        { releaseRequests: { none: { status: { in: OPEN_RELEASE_STATUSES } } } },
        { renewalsAsOriginal: { none: { status: "IN_PROGRESS" } } },
      ],
    },
    orderBy: { maturityDate: "asc" },
  });
  return (
    <>
      <PageHeader title="New release / refund request" breadcrumb={[{ label: "Release / Refund Requests", href: "/releases" }]} />
      <div className="mb-4"><Alert tone="info">Requests are processed by the Regulation Bureau in two steps (officer scrutiny, then an approving authority&apos;s decision). Approval authorises processing; completion is recorded separately once evidence is available.</Alert></div>
      <Card>
        <ReleaseRequestForm
          maxMb={settings.maxUploadMb}
          initialId={sp.instrumentId}
          instruments={eligible.map((i) => ({
            id: i.id,
            amount: i.amount?.toFixed(2) ?? "",
            label: `${i.referenceNo} · ${i.instrumentNumber ?? "no number"} · ${i.bankName ?? "—"} · ${formatINR(i.amount)} · matures ${formatDate(i.maturityDate)}${i.status === "REPLACED" ? " (replaced)" : ""}`,
          }))}
        />
      </Card>
    </>
  );
}
