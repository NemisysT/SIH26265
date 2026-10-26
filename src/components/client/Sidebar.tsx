"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Bell, Building2, CalendarClock, ClipboardCheck, FileSpreadsheet, HandCoins, Landmark, LayoutDashboard, Menu, ScrollText, Settings, X } from "lucide-react";

const ICONS = { Bell, Building2, CalendarClock, ClipboardCheck, FileSpreadsheet, HandCoins, Landmark, LayoutDashboard, ScrollText, Settings };

export interface SidebarItem {
  href: string;
  label: string;
  icon: keyof typeof ICONS;
  badge?: number;
}

export function Sidebar({ items }: { items: SidebarItem[] }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const links = (
    <ul className="space-y-0.5">
      {items.map((it) => {
        const Icon = ICONS[it.icon];
        const active = pathname === it.href || pathname.startsWith(`${it.href}/`);
        return (
          <li key={it.href}>
            <Link
              href={it.href}
              onClick={() => setOpen(false)}
              aria-current={active ? "page" : undefined}
              className={`flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm ${active ? "bg-white/15 font-semibold text-white" : "text-white/80 hover:bg-white/10 hover:text-white"}`}
            >
              <Icon className="h-4 w-4 shrink-0" aria-hidden />
              <span className="flex-1">{it.label}</span>
              {it.badge ? <span className="rounded-full bg-white px-1.5 text-2xs font-bold text-brand" aria-label={`${it.badge} unread`}>{it.badge}</span> : null}
            </Link>
          </li>
        );
      })}
    </ul>
  );
  return (
    <>
      <button type="button" className="btn-ghost btn-sm lg:hidden" aria-expanded={open} aria-controls="mobile-nav" onClick={() => setOpen((o) => !o)}>
        {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        <span className="sr-only">Toggle navigation</span>
      </button>
      {open && (
        <nav id="mobile-nav" aria-label="Main" className="fixed inset-x-0 top-14 z-40 max-h-[calc(100vh-3.5rem)] overflow-y-auto bg-brand p-3 shadow-lg lg:hidden">
          {links}
        </nav>
      )}
      <nav aria-label="Main" className="fixed bottom-0 left-0 top-14 z-30 hidden w-64 flex-col overflow-y-auto bg-brand px-3 py-4 lg:flex">
        {links}
      </nav>
    </>
  );
}
