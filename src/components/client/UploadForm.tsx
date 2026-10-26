"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { apiCall, ApiError } from "./api";

export function UploadForm({ url, docTypes, maxMb, label = "Upload document" }: { url: string; docTypes: { value: string; label: string }[]; maxMb: number; label?: string }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [docType, setDocType] = useState(docTypes[0]?.value ?? "");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const file = input.current?.files?.[0];
    if (!file) return setMsg({ ok: false, text: "Choose a file first." });
    if (file.size > maxMb * 1024 * 1024) return setMsg({ ok: false, text: `File exceeds ${maxMb} MB.` });
    const form = new FormData();
    form.set("docType", docType);
    form.set("file", file);
    setBusy(true);
    setMsg(null);
    try {
      await apiCall(url, { form });
      setMsg({ ok: true, text: `Uploaded ${file.name}.` });
      if (input.current) input.current.value = "";
      router.refresh();
    } catch (err) {
      setMsg({ ok: false, text: err instanceof ApiError ? err.message : "Upload failed. Nothing was saved." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-2 rounded-md border border-dashed border-line-strong bg-surface p-3">
      <div className="grid gap-2 sm:grid-cols-[200px_1fr_auto] sm:items-end">
        <div>
          <label className="field-label" htmlFor={`dt-${url}`}>Document type</label>
          <select id={`dt-${url}`} className="input" value={docType} onChange={(e) => setDocType(e.target.value)}>
            {docTypes.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
          </select>
        </div>
        <div>
          <label className="field-label" htmlFor={`file-${url}`}>File (PDF, PNG or JPEG, max {maxMb} MB)</label>
          <input id={`file-${url}`} ref={input} type="file" accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg" className="input py-1.5" />
        </div>
        <button className="btn-primary" disabled={busy}>{busy ? "Uploading…" : label}</button>
      </div>
      {msg && <p role={msg.ok ? "status" : "alert"} className={msg.ok ? "text-xs text-tone-success" : "text-xs text-tone-danger"}>{msg.text}</p>}
      <p className="field-hint">File type is verified from its content and a SHA-256 hash is recorded. This proves integrity since upload, not authenticity.</p>
    </form>
  );
}
