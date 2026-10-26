import Link from "next/link";
import { redirect } from "next/navigation";
import { ShieldCheck } from "lucide-react";
import { getCurrentActor } from "@/server/auth/session";
import { env } from "@/server/env";
import { prisma } from "@/server/db";
import { LoginForm, type DemoAccount } from "@/components/client/LoginForm";
import { ROLE_LABELS } from "@/lib/labels";

export const dynamic = "force-dynamic";
export const metadata = { title: "Sign in" };

const DEMO_ORDER: { email: string; description: string }[] = [
  { email: "inst.northfield@demo.example.org", description: "Institution: drafts, submissions, corrections, renewals and release requests." },
  { email: "officer.north@demo.example.org", description: "Officer for Northern, Central and Eastern regions: scrutiny, verification, completion." },
  { email: "officer.south@demo.example.org", description: "Officer for Southern and Western regions." },
  { email: "authority@demo.example.org", description: "Decides forwarded release/refund requests." },
  { email: "auditor@demo.example.org", description: "Read-only access to records, decisions and audit trails." },
  { email: "admin@demo.example.org", description: "Accounts, reference data, policy settings and the monitoring job." },
];

export default async function LoginPage() {
  if (await getCurrentActor()) redirect("/dashboard");
  let demoAccounts: DemoAccount[] = [];
  if (env.demoMode) {
    const users = await prisma.user.findMany({ where: { isDemo: true, status: "ACTIVE", email: { in: DEMO_ORDER.map((d) => d.email) } } });
    demoAccounts = DEMO_ORDER.flatMap((d) => {
      const u = users.find((x) => x.email === d.email);
      return u ? [{ email: u.email, name: u.name, role: ROLE_LABELS[u.role], description: d.description }] : [];
    });
  }
  return (
    <main className="flex min-h-screen items-start justify-center px-4 py-10 sm:items-center">
      <div className="w-full max-w-md">
        <div className="mb-6 flex items-center gap-3">
          <ShieldCheck className="h-9 w-9 text-brand" aria-hidden />
          <div>
            <h1 className="text-lg font-semibold">Security Deposit &amp; FDR Portal</h1>
            <p className="text-xs text-ink-subtle">Prototype for SIH problem statement 26265 · not an official AICTE system</p>
          </div>
        </div>
        <div className="card p-6">
          <LoginForm demoAccounts={demoAccounts} demoPassword={env.demoMode ? (process.env.DEMO_PASSWORD ?? "Demo@SDP2026") : null} />
        </div>
        <p className="mt-4 text-center text-sm text-ink-muted">
          New institution? <Link href="/register" className="link">Register for access</Link>
        </p>
      </div>
    </main>
  );
}
