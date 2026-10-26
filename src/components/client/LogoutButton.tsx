"use client";

import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";
import { apiCall } from "./api";

export function LogoutButton() {
  const router = useRouter();
  return (
    <button
      type="button"
      className="btn-ghost btn-sm"
      onClick={async () => {
        await apiCall("/api/auth/logout", { method: "POST" }).catch(() => undefined);
        router.push("/login");
        router.refresh();
      }}
    >
      <LogOut className="h-4 w-4" aria-hidden />
      <span className="hidden sm:inline">Sign out</span>
    </button>
  );
}
