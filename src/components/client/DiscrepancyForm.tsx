"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiCall, ApiError } from "./api";

export function DiscrepancyForm({ instrumentId }: { instrumentId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [severity, setSeverity] = useState("BLOCKING");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!open) return <button className="btn-secondary btn-sm" onClick={() => setOpen(true)}>Flag discrepancy</button>;
  return (
    <form
      className="mt-3 space-y-2 rounded-md border border-line p-3"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
          await apiCall(`/api/instruments/${instrumentId}/discrepancies`, { json: { message, severity } });
          setMessage("");
          setOpen(false);
          router.refresh();
        } catch (err) {
          setError(err instanceof ApiError ? err.message : "Could not record.");
        } finally {
          setBusy(false);
        }
      }}
    >
      <label className="field-label" htmlFor="disc-msg">Discrepancy observed *</label>
      <textarea id="disc-msg" className="input min-h-16" value={message} onChange={(e) => setMessage(e.target.value)} maxLength={1000} />
      <div className="flex flex-wrap items-center gap-2">
        <select aria-label="Severity" className="input w-auto" value={severity} onChange={(e) => setSeverity(e.target.value)}>
          <option value="BLOCKING">Blocking — must be resolved</option>
          <option value="WARNING">Warning — review aid</option>
        </select>
        <button className="btn-primary btn-sm" disabled={busy || message.trim().length < 5}>Record</button>
        <button type="button" className="btn-ghost btn-sm" onClick={() => setOpen(false)}>Cancel</button>
        {error && <span role="alert" className="text-xs text-tone-danger">{error}</span>}
      </div>
    </form>
  );
}
