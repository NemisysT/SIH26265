"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { apiCall, ApiError } from "./api";

export interface EligibleInstrument {
  id: string;
  label: string;
  amount: string;
}

export function ReleaseRequestForm({ instruments, initialId, maxMb }: { instruments: EligibleInstrument[]; initialId?: string; maxMb: number }) {
  const router = useRouter();
  const files = useRef<HTMLInputElement>(null);
  const [instrumentId, setInstrumentId] = useState(initialId && instruments.some((i) => i.id === initialId) ? initialId : instruments[0]?.id ?? "");
  const selected = instruments.find((i) => i.id === instrumentId);
  const [type, setType] = useState("RELEASE");
  const [requestedAmount, setAmount] = useState(selected?.amount ?? "");
  const [reason, setReason] = useState("");
  const [errors, setErrors] = useState<Record<string, string[] | undefined>>({});
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [clientRequestId] = useState(() => crypto.randomUUID());

  async function submit() {
    const list = Array.from(files.current?.files ?? []);
    if (list.some((f) => f.size > maxMb * 1024 * 1024)) return setMsg(`Each file must be at most ${maxMb} MB.`);
    const form = new FormData();
    form.set("instrumentId", instrumentId);
    form.set("type", type);
    form.set("requestedAmount", requestedAmount.trim());
    form.set("reason", reason.trim());
    form.set("clientRequestId", clientRequestId);
    list.forEach((f) => form.append("files", f));
    setBusy(true);
    setMsg(null);
    setErrors({});
    try {
      const rr = await apiCall<{ id: string }>("/api/releases", { form });
      router.push(`/releases/${rr.id}`);
      router.refresh();
    } catch (err) {
      setConfirming(false);
      if (err instanceof ApiError) {
        setErrors(err.fieldErrors ?? {});
        setMsg(err.message);
      } else setMsg("Submission failed. Nothing was recorded.");
      setBusy(false);
    }
  }

  if (instruments.length === 0) {
    return <p className="text-sm text-ink-muted">No eligible instruments. Only accepted or replaced instruments without an open request or renewal can be released or refunded.</p>;
  }

  return (
    <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); setConfirming(true); }} noValidate>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label className="field-label" htmlFor="instrumentId">Instrument</label>
          <select id="instrumentId" className="input" value={instrumentId} onChange={(e) => { setInstrumentId(e.target.value); setAmount(instruments.find((i) => i.id === e.target.value)?.amount ?? ""); }}>
            {instruments.map((i) => <option key={i.id} value={i.id}>{i.label}</option>)}
          </select>
        </div>
        <div>
          <label className="field-label" htmlFor="rtype">Request type</label>
          <select id="rtype" className="input" value={type} onChange={(e) => setType(e.target.value)}>
            <option value="RELEASE">Release of instrument (return / discharge of receipt)</option>
            <option value="REFUND">Refund of deposit</option>
          </select>
        </div>
        <div>
          <label className="field-label" htmlFor="ramount">Requested amount (₹)</label>
          <input id="ramount" className={`input ${errors.requestedAmount ? "input-error" : ""}`} inputMode="decimal" value={requestedAmount} onChange={(e) => setAmount(e.target.value)} />
          {errors.requestedAmount ? <p className="field-error">{errors.requestedAmount.join(" ")}</p> : <p className="field-hint">Cannot exceed the recorded amount ({selected?.amount}).</p>}
        </div>
        <div className="sm:col-span-2">
          <label className="field-label" htmlFor="rreason">Grounds for the request *</label>
          <textarea id="rreason" className={`input min-h-24 ${errors.reason ? "input-error" : ""}`} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={2000} />
          {errors.reason && <p className="field-error">{errors.reason.join(" ")}</p>}
        </div>
        <div className="sm:col-span-2">
          <label className="field-label" htmlFor="rfiles">Supporting documents * (PDF/PNG/JPEG, up to 5, max {maxMb} MB each)</label>
          <input id="rfiles" ref={files} type="file" multiple accept=".pdf,.png,.jpg,.jpeg" className="input py-1.5" />
          {errors.files && <p className="field-error">{errors.files.join(" ")}</p>}
        </div>
      </div>
      {msg && <p role="alert" className="rounded-md bg-tone-danger-bg px-3 py-2 text-sm text-tone-danger">{msg}</p>}
      {confirming ? (
        <div className="rounded-md border border-brand/30 bg-brand-soft p-3 text-sm" role="alertdialog" aria-label="Confirm submission">
          <p>Submit this {type.toLowerCase()} request for ₹{requestedAmount}? It will be scrutinised by an officer and decided by an approving authority. Submission does not release any funds.</p>
          <div className="mt-2 flex gap-2">
            <button type="button" className="btn-primary" disabled={busy} onClick={submit}>{busy ? "Submitting…" : "Confirm submission"}</button>
            <button type="button" className="btn-secondary" disabled={busy} onClick={() => setConfirming(false)}>Back</button>
          </div>
        </div>
      ) : (
        <button className="btn-primary">Review and submit</button>
      )}
    </form>
  );
}
