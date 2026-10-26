"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { apiCall, ApiError } from "./api";

export interface InstrumentFormValues {
  type: string;
  instrumentNumber: string;
  bankName: string;
  branchName: string;
  ifscCode: string;
  amount: string;
  issueDate: string;
  maturityDate: string;
  validUntil: string;
  purpose: string;
  notes: string;
}

interface Props {
  mode: "create" | "edit" | "renew";
  initial?: Partial<InstrumentFormValues>;
  instrumentId?: string;
  expectedVersion?: number;
  banks: string[];
  /** For renewals: the original instrument summary shown alongside. */
  originalId?: string;
  lockType?: boolean;
}

const EMPTY: InstrumentFormValues = {
  type: "FDR", instrumentNumber: "", bankName: "", branchName: "", ifscCode: "", amount: "",
  issueDate: "", maturityDate: "", validUntil: "", purpose: "", notes: "",
};

export function InstrumentForm({ mode, initial, instrumentId, expectedVersion, banks, originalId, lockType }: Props) {
  const router = useRouter();
  const [v, setV] = useState<InstrumentFormValues>({ ...EMPTY, ...initial });
  const [kind, setKind] = useState<"RENEWAL" | "REPLACEMENT">("RENEWAL");
  const [reason, setReason] = useState("");
  const [errors, setErrors] = useState<Record<string, string[] | undefined>>({});
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [clientRequestId] = useState(() => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : undefined));

  const set = (k: keyof InstrumentFormValues) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setV((prev) => ({ ...prev, [k]: e.target.value }));

  const warnings = useMemo(() => {
    const w: string[] = [];
    if (v.issueDate && v.maturityDate && v.maturityDate <= v.issueDate) w.push("Maturity date must be after the issue date.");
    if (v.amount && !/^\d{1,13}(\.\d{1,2})?$/.test(v.amount.trim())) w.push("Amount must be a number with at most 2 decimals (no commas).");
    if (v.bankName && banks.length && !banks.some((b) => b.toLowerCase() === v.bankName.trim().toLowerCase())) w.push("Bank is not in the reference list; it will be flagged for review.");
    return w;
  }, [v, banks]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErrors({});
    setMsg(null);
    const payload: Record<string, unknown> = Object.fromEntries(Object.entries(v).map(([k, val]) => [k, typeof val === "string" ? val.trim() : val]));
    try {
      if (mode === "create") {
        const created = await apiCall<{ id: string }>("/api/instruments", { json: { ...payload, clientRequestId } });
        router.push(`/instruments/${created.id}?saved=1`);
      } else if (mode === "edit") {
        await apiCall(`/api/instruments/${instrumentId}`, { method: "PATCH", json: { ...payload, expectedVersion } });
        router.push(`/instruments/${instrumentId}?saved=1`);
      } else {
        const res = await apiCall<{ instrument: { id: string } }>(`/api/instruments/${originalId}/renewal`, { json: { ...payload, kind, reason, clientRequestId } });
        router.push(`/instruments/${res.instrument.id}?saved=1`);
      }
      router.refresh();
    } catch (err) {
      if (err instanceof ApiError) {
        setErrors(err.fieldErrors ?? {});
        setMsg(err.message);
      } else setMsg("Could not save. Nothing was changed.");
      setBusy(false);
    }
  }

  const field = (k: keyof InstrumentFormValues, label: string, opts: { type?: string; hint?: string; required?: boolean; list?: string; inputMode?: "decimal"; placeholder?: string } = {}) => (
    <div>
      <label className="field-label" htmlFor={k}>{label}{opts.required && <span className="text-tone-danger"> *</span>}</label>
      <input
        id={k}
        type={opts.type ?? "text"}
        className={`input ${errors[k] ? "input-error" : ""}`}
        value={v[k]}
        onChange={set(k)}
        list={opts.list}
        inputMode={opts.inputMode}
        placeholder={opts.placeholder}
        aria-invalid={!!errors[k]}
        aria-describedby={errors[k] ? `${k}-err` : opts.hint ? `${k}-hint` : undefined}
      />
      {errors[k] ? <p id={`${k}-err`} className="field-error">{errors[k]!.join(" ")}</p> : opts.hint ? <p id={`${k}-hint`} className="field-hint">{opts.hint}</p> : null}
    </div>
  );

  return (
    <form onSubmit={save} className="space-y-6" noValidate>
      {mode === "renew" && (
        <fieldset className="grid gap-4 rounded-md border border-line p-4 sm:grid-cols-2">
          <legend className="px-1 text-xs font-semibold text-ink-muted">Renewal / replacement</legend>
          <div>
            <label className="field-label" htmlFor="kind">Kind</label>
            <select id="kind" className="input" value={kind} onChange={(e) => setKind(e.target.value as "RENEWAL")}>
              <option value="RENEWAL">Renewal (same deposit renewed by the bank)</option>
              <option value="REPLACEMENT">Replacement (a new instrument replaces the original)</option>
            </select>
          </div>
          <div>
            <label className="field-label" htmlFor="reason">Reason<span className="text-tone-danger"> *</span></label>
            <input id="reason" className={`input ${errors.reason ? "input-error" : ""}`} value={reason} onChange={(e) => setReason(e.target.value)} />
            {errors.reason && <p className="field-error">{errors.reason.join(" ")}</p>}
          </div>
          <p className="text-xs text-ink-muted sm:col-span-2">
            A new linked record is created. The original instrument&apos;s dates, amount, bank details and documents are kept unchanged; it is marked
            &quot;replaced&quot; only when the new instrument is accepted.
          </p>
        </fieldset>
      )}

      <fieldset className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <legend className="mb-2 text-sm font-semibold">Instrument details</legend>
        <div>
          <label className="field-label" htmlFor="type">Instrument type<span className="text-tone-danger"> *</span></label>
          <select id="type" className="input" value={v.type} onChange={set("type")} disabled={lockType}>
            <option value="FDR">Fixed Deposit Receipt (FDR)</option>
            <option value="SECURITY_DEPOSIT">Security Deposit</option>
          </select>
        </div>
        {field("instrumentNumber", "Instrument / receipt number", { required: true })}
        {field("amount", "Deposit amount (₹)", { required: true, inputMode: "decimal", hint: "Rupees, e.g. 1500000.00 — no commas.", placeholder: "0.00" })}
        {field("bankName", "Issuing bank", { required: true, list: "bank-list" })}
        {field("branchName", "Branch", { required: true })}
        {field("ifscCode", "IFSC (optional)", { hint: "Format ABCD0123456" })}
        {field("issueDate", "Issue date", { type: "date", required: true })}
        {field("maturityDate", "Maturity date", { type: "date", required: true })}
        {field("validUntil", "Validity / lien end date (optional)", { type: "date" })}
        <datalist id="bank-list">{banks.map((b) => <option key={b} value={b} />)}</datalist>
      </fieldset>

      <fieldset className="grid gap-4 sm:grid-cols-2">
        <legend className="mb-2 text-sm font-semibold">Context</legend>
        {field("purpose", "Purpose / approval reference")}
        <div className="sm:col-span-2">
          <label className="field-label" htmlFor="notes">Notes</label>
          <textarea id="notes" className="input min-h-20" value={v.notes} onChange={set("notes")} maxLength={2000} />
        </div>
      </fieldset>

      {warnings.length > 0 && (
        <ul className="list-inside list-disc rounded-md bg-tone-warning-bg px-4 py-2 text-xs text-tone-warning" aria-live="polite">
          {warnings.map((w) => <li key={w}>{w}</li>)}
        </ul>
      )}
      {msg && <p role="alert" className="rounded-md bg-tone-danger-bg px-3 py-2 text-sm text-tone-danger">{msg}</p>}

      <div className="flex flex-wrap items-center gap-2">
        <button className="btn-primary" disabled={busy}>{busy ? "Saving…" : mode === "edit" ? "Save changes" : "Save draft"}</button>
        <button type="button" className="btn-ghost" onClick={() => router.back()} disabled={busy}>Cancel</button>
        <span className="text-xs text-ink-muted">
          {mode === "edit" ? "Saved values are recorded in the audit trail." : "Saving creates a draft. Upload documents and submit from the record page; a draft is not visible to the Bureau."}
        </span>
      </div>
    </form>
  );
}
