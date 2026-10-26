import type { Permission } from "@/server/auth/permissions";

export interface NavItem {
  href: string;
  label: string;
  icon: string;
  permission?: Permission;
  /** Show only to roles that process work in this area. */
  roles?: string[];
}

export const NAV_ITEMS: NavItem[] = [
  { href: "/dashboard", label: "Overview", icon: "LayoutDashboard" },
  { href: "/institutions", label: "Institutions", icon: "Building2", permission: "institution:read" },
  { href: "/instruments", label: "Security Deposits & FDRs", icon: "Landmark", permission: "instrument:read" },
  { href: "/verification", label: "Verification Queue", icon: "ClipboardCheck", permission: "instrument:review" },
  { href: "/renewals", label: "Renewal & Expiry", icon: "CalendarClock", permission: "instrument:read" },
  { href: "/releases", label: "Release / Refund Requests", icon: "HandCoins", permission: "release:read" },
  { href: "/notifications", label: "Notifications", icon: "Bell" },
  { href: "/reports", label: "Reports", icon: "FileSpreadsheet", permission: "report:export" },
  { href: "/audit", label: "Audit Logs", icon: "ScrollText", permission: "audit:read" },
  { href: "/admin", label: "Administration", icon: "Settings", permission: "admin:users" },
];
