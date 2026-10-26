"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiCall, ApiError } from "./api";

export function VerificationForm({ instrumentId, version, bankLetters, requireIndependent }: { instrumentId: string; version: number; bankLetters: { id: string; label: string }[]; requireIndependent: boolean }) {
  const router = useRouter();
  const [method, setMethod] = useState<"MANUAL_DOCUMENT_REVIEW" | "BANK_CONFIRMATION_LETTER">("MANUAL_DOCUMENT_REVIEW");
  const [result, setResult] = useState("PENDING");
  const [evidenceReference, setRef] = useState("");
  const [evidenceDocumentId, setDoc] = useState(bankLetters[0]?.id ?? "");
  const [observations, setObs] = useState("");
  const [discrepancyDetails, setDetails] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const confirmBlocked = result === "CONFIRMED" && requireIndependent && method !== "BANK_CONFIRMATION_LETTER";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      await apiCall(`/api/instruments/${instrumentId}/verification`, {
        json: {
          method, result, observations, expectedVersion: version,
          ...(method === "BANK_CONFIRMATION_LETTER" ? { evidenceReference, evidenceDocumentId: evidenceDocumentId || undefined } : {}),
          ...(result === "DISCREPANCY" ? { discrepancyDetails } : {}),
        },
      });
      setMsg({ ok: true, text: "Verification recorded." });
      setObs("");
      router.refresh();
    } catch (err) {
      setMsg({ ok: false, text: err instanceof ApiError ? err.message : "Could not record verification." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="field-label" htmlFor="vmethod">Method</label>
          <select id="vmethod" className="input" value={method} onChange={(e) => setMethod(e.target.value as "MANUAL_DOCUMENT_REVIEW")}>
            <option value="MANUAL_DOCUMENT_REVIEW">Manual document review</option>
            <option value="BANK_CONFIRMATION_LETTER">Bank confirmation letter</option>
          </select>
        </div>
        <div>
          <label className="field-label" htmlFor="vresult">Result</label>
          <select id="vresult" className="input" value={result} onChange={(e) => setResult(e.target.value)}>
            <option value="PENDING">Pending — further evidence awaited</option>
            <option value="CONFIRMED">Confirmed</option>
            <option value="DISCREPANCY">Discrepancy detected</option>
            <option value="UNABLE_TO_VERIFY">Unable to verify</option>
          </select>
        </div>
      </div>
      {method === "BANK_CONFIRMATION_LETTER" && (
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="field-label" htmlFor="vref">Letter reference</label>
            <input id="vref" className="input" value={evidenceReference} onChange={(e) => setRef(e.target.value)} maxLength={120} />
          </div>
          <div>
            <label className="field-label" htmlFor="vdoc">Uploaded bank letter</label>
            <select id="vdoc" className="input" value={evidenceDocumentId} onChange={(e) => setDoc(e.target.value)}>
              {bankLetters.length === 0 && <option value="">Upload a bank verification letter first</option>}
              {bankLetters.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
            </select>
          </div>
        </div>
      )}
      {result === "DISCREPANCY" && (
        <div>
          <label className="field-label" htmlFor="vdisc">Discrepancy details *</label>
          <textarea id="vdisc" className="input min-h-16" value={discrepancyDetails} onChange={(e) => setDetails(e.target.value)} maxLength={1000} />
        </div>
      )}
      <div>
        <label className="field-label" htmlFor="vobs">Observations *</label>
        <textarea id="vobs" className="input min-h-20" value={observations} onChange={(e) => setObs(e.target.value)} maxLength={2000} />
      </div>
      {confirmBlocked && (
        <p className="rounded-md bg-tone-warning-bg px-3 py-2 text-xs text-tone-warning">
          Policy requires independent confirmation: a manual document review cannot mark the instrument confirmed. Use a bank confirmation letter.
        </p>
      )}
      {msg && <p role={msg.ok ? "status" : "alert"} className={`text-sm ${msg.ok ? "text-tone-success" : "text-tone-danger"}`}>{msg.text}</p>}
      <button className="btn-primary" disabled={busy || confirmBlocked || observations.trim().length < 3}>{busy ? "Recording…" : "Record verification"}</button>
    </form>
  );
}
