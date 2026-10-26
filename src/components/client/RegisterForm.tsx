"use client";

import { useState } from "react";
import { apiCall, ApiError } from "./api";

const FIELDS: { name: string; label: string; type?: string; hint?: string; autoComplete?: string }[] = [
  { name: "institutionName", label: "Institution name" },
  { name: "approvalReference", label: "Approval / application reference (if any)" },
  { name: "category", label: "Category (e.g. Engineering & Technology)" },
  { name: "addressLine", label: "Address" },
  { name: "city", label: "City" },
  { name: "state", label: "State / UT" },
  { name: "pincode", label: "PIN code" },
  { name: "contactName", label: "Nodal officer name", autoComplete: "name" },
  { name: "contactPhone", label: "Phone", type: "tel", autoComplete: "tel" },
  { name: "email", label: "Official email (sign-in ID)", type: "email", autoComplete: "email" },
  { name: "password", label: "Password", type: "password", hint: "At least 10 characters with letters and a number.", autoComplete: "new-password" },
];

export function RegisterForm({ regions }: { regions: { code: string; name: string }[] }) {
  const [values, setValues] = useState<Record<string, string>>({ regionCode: regions[0]?.code ?? "" });
  const [errors, setErrors] = useState<Record<string, string[] | undefined>>({});
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErrors({});
    setMsg(null);
    try {
      const res = await apiCall<{ message: string }>("/api/auth/register", { json: values });
      setMsg({ ok: true, text: res.message });
      setValues({ regionCode: regions[0]?.code ?? "" });
    } catch (err) {
      if (err instanceof ApiError) {
        setErrors(err.fieldErrors ?? {});
        setMsg({ ok: false, text: err.message });
      } else setMsg({ ok: false, text: "Registration failed." });
    } finally {
      setBusy(false);
    }
  }

  if (msg?.ok) return <p role="status" className="rounded-md bg-tone-success-bg px-3 py-3 text-sm text-tone-success">{msg.text}</p>;

  return (
    <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2" noValidate>
      <div className="sm:col-span-2">
        <label className="field-label" htmlFor="regionCode">Region</label>
        <select id="regionCode" className="input" value={values.regionCode} onChange={(e) => setValues((v) => ({ ...v, regionCode: e.target.value }))}>
          {regions.map((r) => <option key={r.code} value={r.code}>{r.name}</option>)}
        </select>
      </div>
      {FIELDS.map((f) => (
        <div key={f.name} className={["institutionName", "addressLine"].includes(f.name) ? "sm:col-span-2" : ""}>
          <label className="field-label" htmlFor={f.name}>{f.label}</label>
          <input
            id={f.name}
            type={f.type ?? "text"}
            autoComplete={f.autoComplete}
            className={`input ${errors[f.name] ? "input-error" : ""}`}
            value={values[f.name] ?? ""}
            onChange={(e) => setValues((v) => ({ ...v, [f.name]: e.target.value }))}
            aria-invalid={!!errors[f.name]}
            aria-describedby={errors[f.name] ? `${f.name}-err` : undefined}
          />
          {f.hint && !errors[f.name] && <p className="field-hint">{f.hint}</p>}
          {errors[f.name] && <p id={`${f.name}-err`} className="field-error">{errors[f.name]!.join(" ")}</p>}
        </div>
      ))}
      {msg && !msg.ok && <p role="alert" className="sm:col-span-2 rounded-md bg-tone-danger-bg px-3 py-2 text-sm text-tone-danger">{msg.text}</p>}
      <div className="sm:col-span-2">
        <button className="btn-primary" disabled={busy}>{busy ? "Submitting…" : "Submit registration"}</button>
        <p className="field-hint">Registration is reviewed by the Regulation Bureau before the account can be used.</p>
      </div>
    </form>
  );
}
