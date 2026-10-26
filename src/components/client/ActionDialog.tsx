"use client";

import { useId, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { apiCall, ApiError } from "./api";

interface Props {
  label: string;
  url: string;
  payload?: Record<string, unknown>;
  /** Confirmation copy for consequential actions. */
  confirm?: string;
  title?: string;
  requiresNote?: boolean;
  noteLabel?: string;
  notePlaceholder?: string;
  /** Extra single-line text inputs, e.g. completion reference. */
  fields?: { name: string; label: string; required?: boolean; placeholder?: string }[];
  variant?: "primary" | "secondary" | "danger" | "ghost";
  size?: "sm" | "md";
  redirectTo?: string;
  children?: ReactNode;
  /** Execute immediately without a dialog (non-consequential actions only). */
  direct?: boolean;
  method?: "POST" | "PATCH" | "PUT";
}

export function ActionDialog(props: Props) {
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const uid = useId();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [values, setValues] = useState<Record<string, string>>({});
  const cls = `${props.variant === "danger" ? "btn-danger" : props.variant === "secondary" ? "btn-secondary" : props.variant === "ghost" ? "btn-ghost" : "btn-primary"} ${props.size === "sm" ? "btn-sm" : ""}`;

  async function run() {
    setBusy(true);
    setError(null);
    try {
      await apiCall(props.url, { method: props.method ?? "POST", json: { ...props.payload, ...(note.trim() ? { note: note.trim() } : {}), ...values } });
      dialog.current?.close();
      setNote("");
      setValues({});
      if (props.redirectTo) router.push(props.redirectTo);
      router.refresh();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Unexpected error. Nothing was confirmed.");
    } finally {
      setBusy(false);
    }
  }

  if (props.direct) {
    return (
      <span className="inline-flex flex-col">
        <button type="button" className={cls} disabled={busy} onClick={run}>
          {busy ? "Working…" : props.label}
        </button>
        {error && <span role="alert" className="field-error">{error}</span>}
      </span>
    );
  }

  const missingRequired =
    (props.requiresNote && note.trim().length === 0) || (props.fields ?? []).some((f) => f.required && !values[f.name]?.trim());

  return (
    <>
      <button type="button" className={cls} onClick={() => { setError(null); dialog.current?.showModal(); }}>
        {props.label}
      </button>
      <dialog ref={dialog} className="w-[min(92vw,520px)] rounded-lg border border-line bg-surface-raised p-0 text-ink shadow-xl backdrop:bg-black/40" aria-labelledby={`${uid}-title`}>
        <form method="dialog" onSubmit={(e) => { e.preventDefault(); void run(); }}>
          <div className="border-b border-line px-5 py-3">
            <h2 id={`${uid}-title`} className="text-base font-semibold">{props.title ?? props.label}</h2>
          </div>
          <div className="space-y-3 px-5 py-4">
            {props.confirm && <p className="text-sm text-ink-muted">{props.confirm}</p>}
            {props.children}
            {(props.fields ?? []).map((f) => (
              <div key={f.name}>
                <label className="field-label" htmlFor={`${uid}-${f.name}`}>{f.label}{f.required && " *"}</label>
                <input id={`${uid}-${f.name}`} className="input" placeholder={f.placeholder} value={values[f.name] ?? ""} onChange={(e) => setValues((v) => ({ ...v, [f.name]: e.target.value }))} maxLength={120} />
              </div>
            ))}
            {(props.requiresNote || props.noteLabel) && (
              <div>
                <label className="field-label" htmlFor={`${uid}-note`}>{props.noteLabel ?? "Reason / observation"}{props.requiresNote && " *"}</label>
                <textarea id={`${uid}-note`} className="input min-h-24" value={note} onChange={(e) => setNote(e.target.value)} placeholder={props.notePlaceholder} maxLength={2000} />
                <p className="field-hint">Recorded permanently in the audit trail.</p>
              </div>
            )}
            {error && <p role="alert" className="rounded-md bg-tone-danger-bg px-3 py-2 text-sm text-tone-danger">{error}</p>}
          </div>
          <div className="flex justify-end gap-2 border-t border-line bg-surface px-5 py-3">
            <button type="button" className="btn-secondary" onClick={() => dialog.current?.close()} disabled={busy}>Cancel</button>
            <button type="submit" className={props.variant === "danger" ? "btn-danger" : "btn-primary"} disabled={busy || missingRequired}>
              {busy ? "Saving…" : `Confirm: ${props.label}`}
            </button>
          </div>
        </form>
      </dialog>
    </>
  );
}
