import Link from "next/link";
import { ShieldCheck } from "lucide-react";
import { requirePageActor } from "@/server/page";
import { can } from "@/server/auth/scope";
import { unreadCount } from "@/server/services/activity";
import { NAV_ITEMS } from "@/components/nav";
import { Sidebar, type SidebarItem } from "@/components/client/Sidebar";
import { LogoutButton } from "@/components/client/LogoutButton";
import { ROLE_LABELS } from "@/lib/labels";
import { env } from "@/server/env";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const actor = await requirePageActor();
  const unread = await unreadCount(actor);
  const items: SidebarItem[] = NAV_ITEMS.filter((n) => !n.permission || can(actor, n.permission)).map((n) => ({
    href: n.href === "/institutions" && actor.role === "INSTITUTION_USER" && actor.institutionId ? `/institutions/${actor.institutionId}` : n.href,
    label: n.href === "/institutions" && actor.role === "INSTITUTION_USER" ? "My Institution" : n.label,
    icon: n.icon as SidebarItem["icon"],
    badge: n.href === "/notifications" ? unread : undefined,
  }));

  return (
    <div className="min-h-screen">
      <header className="fixed inset-x-0 top-0 z-40 flex h-14 items-center gap-3 border-b border-line bg-surface-raised px-3 lg:pl-4">
        <Sidebar items={items} />
        <Link href="/dashboard" className="flex min-w-0 items-center gap-2">
          <ShieldCheck className="h-6 w-6 shrink-0 text-brand" aria-hidden />
          <span className="truncate text-sm font-semibold text-ink">
            Security Deposit &amp; FDR Portal
            <span className="ml-2 hidden font-normal text-ink-subtle md:inline">Prototype · SIH PS 26265</span>
          </span>
        </Link>
        <div className="ml-auto flex items-center gap-2">
          <div className="hidden text-right leading-tight sm:block">
            <div className="text-xs font-semibold text-ink">{actor.name}</div>
            <div className="text-2xs text-ink-subtle">{ROLE_LABELS[actor.role]}</div>
          </div>
          <LogoutButton />
        </div>
      </header>
      <div className="pt-14 lg:pl-64">
        {env.demoMode && (
          <div className="border-b border-tone-accent/20 bg-tone-accent-bg px-4 py-1.5 text-center text-xs text-tone-accent">
            Demonstration environment with synthetic data. Not an official AICTE system; no bank or payment system is connected.
          </div>
        )}
        <main className="mx-auto max-w-[1400px] px-4 py-6 lg:px-8">{children}</main>
        <footer className="mx-auto max-w-[1400px] px-4 pb-8 text-2xs text-ink-subtle lg:px-8">
          Prototype for Smart India Hackathon problem statement 26265. Not affiliated with or endorsed by AICTE. Workflow rules and deadlines are configurable demonstration defaults pending confirmation.
        </footer>
      </div>
    </div>
  );
}
