"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiCall, ApiError } from "./api";

export function CommentForm({ url, allowInternal }: { url: string; allowInternal: boolean }) {
  const router = useRouter();
  const [body, setBody] = useState("");
  const [visibility, setVisibility] = useState("SHARED");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      className="space-y-2"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
          await apiCall(url, { json: { body, visibility } });
          setBody("");
          router.refresh();
        } catch (err) {
          setError(err instanceof ApiError ? err.message : "Could not post.");
        } finally {
          setBusy(false);
        }
      }}
    >
      <label className="field-label" htmlFor={`c-${url}`}>Add a message</label>
      <textarea id={`c-${url}`} className="input min-h-16" value={body} onChange={(e) => setBody(e.target.value)} maxLength={2000} />
      <div className="flex flex-wrap items-center gap-2">
        {allowInternal && (
          <select aria-label="Visibility" className="input w-auto" value={visibility} onChange={(e) => setVisibility(e.target.value)}>
            <option value="SHARED">Visible to institution</option>
            <option value="INTERNAL">Internal note (Bureau only)</option>
          </select>
        )}
        <button className="btn-secondary" disabled={busy || !body.trim()}>{busy ? "Posting…" : "Post"}</button>
        {error && <span role="alert" className="text-xs text-tone-danger">{error}</span>}
      </div>
    </form>
  );
}
