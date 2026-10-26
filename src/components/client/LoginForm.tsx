"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiCall, ApiError } from "./api";

export interface DemoAccount {
  email: string;
  name: string;
  role: string;
  description: string;
}

export function LoginForm({ demoAccounts, demoPassword }: { demoAccounts: DemoAccount[]; demoPassword: string | null }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function signIn(e: string, p: string) {
    setBusy(true);
    setError(null);
    try {
      // The demo picker uses exactly the same password login as the form — there is no bypass.
      await apiCall("/api/auth/login", { json: { email: e, password: p } });
      router.push("/dashboard");
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Sign-in failed.");
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          void signIn(email, password);
        }}
      >
        <div>
          <label className="field-label" htmlFor="email">Email</label>
          <input id="email" type="email" autoComplete="username" required className="input" value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div>
          <label className="field-label" htmlFor="password">Password</label>
          <input id="password" type="password" autoComplete="current-password" required className="input" value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        {error && <p role="alert" className="rounded-md bg-tone-danger-bg px-3 py-2 text-sm text-tone-danger">{error}</p>}
        <button className="btn-primary w-full" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>
      </form>

      {demoPassword && demoAccounts.length > 0 && (
        <div className="rounded-lg border border-tone-accent/30 bg-tone-accent-bg/50 p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-tone-accent">Demonstration accounts (DEMO_MODE)</p>
          <p className="mt-1 text-xs text-ink-muted">
            Sign in as a sample role. These accounts exist only in seeded demonstration data and share the documented demo password.
          </p>
          <ul className="mt-3 grid gap-2">
            {demoAccounts.map((a) => (
              <li key={a.email}>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => signIn(a.email, demoPassword)}
                  className="w-full rounded-md border border-line bg-surface-raised px-3 py-2 text-left hover:border-brand/50 hover:bg-brand-soft/40"
                >
                  <span className="block text-sm font-semibold text-ink">{a.role}</span>
                  <span className="block text-xs text-ink-muted">{a.name} · <span className="kbd-ref">{a.email}</span></span>
                  <span className="block text-2xs text-ink-subtle">{a.description}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
