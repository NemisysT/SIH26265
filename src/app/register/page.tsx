import Link from "next/link";
import { prisma } from "@/server/db";
import { RegisterForm } from "@/components/client/RegisterForm";

export const dynamic = "force-dynamic";
export const metadata = { title: "Institution registration" };

export default async function RegisterPage() {
  const regions = await prisma.region.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, select: { code: true, name: true } });
  return (
    <main className="mx-auto max-w-2xl px-4 py-10">
      <Link href="/login" className="link text-sm">← Back to sign in</Link>
      <h1 className="mt-3 text-xl font-semibold">Institution registration</h1>
      <p className="mt-1 text-sm text-ink-muted">
        Register your institution to submit and track security deposits and FDRs. Accounts are activated after approval.
      </p>
      <div className="card mt-6 p-6">
        <RegisterForm regions={regions} />
      </div>
    </main>
  );
}
