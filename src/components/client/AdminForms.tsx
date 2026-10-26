"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiCall, ApiError } from "./api";

function useSubmit() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string; fields?: Record<string, string[] | undefined> } | null>(null);
  async function run(fn: () => Promise<unknown>, okText: string) {
    setBusy(true);
    setMsg(null);
    try {
      await fn();
      setMsg({ ok: true, text: okText });
      router.refresh();
      return true;
    } catch (err) {
      setMsg({ ok: false, text: err instanceof ApiError ? err.message : "Request failed.", fields: err instanceof ApiError ? err.fieldErrors : undefined });
      return false;
    } finally {
      setBusy(false);
    }
  }
  const Message = () =>
    msg ? (
      <p role={msg.ok ? "status" : "alert"} className={`text-xs ${msg.ok ? "text-tone-success" : "text-tone-danger"}`}>
        {msg.text}
        {msg.fields && Object.entries(msg.fields).map(([k, v]) => v && <span key={k} className="block">{k}: {v.join(" ")}</span>)}
      </p>
    ) : null;
  return { busy, run, Message };
}

const ROLES = [
  ["INSTITUTION_USER", "Institution User"],
  ["OFFICER", "Regulation Bureau Officer"],
  ["APPROVING_AUTHORITY", "Approving Authority"],
  ["AUDITOR", "Auditor"],
  ["ADMIN", "System Administrator"],
] as const;

export function CreateUserForm({ regions, institutions }: { regions: { id: string; name: string }[]; institutions: { id: string; name: string }[] }) {
  const { busy, run, Message } = useSubmit();
  const [v, setV] = useState({ email: "", name: "", designation: "", role: "OFFICER", institutionId: "", password: "" });
  const [regionIds, setRegionIds] = useState<string[]>([]);
  return (
    <form
      className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"
      onSubmit={async (e) => {
        e.preventDefault();
        const ok = await run(() => apiCall("/api/admin/users", { json: { ...v, institutionId: v.role === "INSTITUTION_USER" ? v.institutionId || undefined : undefined, regionIds: v.role === "OFFICER" ? regionIds : [], designation: v.designation || undefined } }), "User created.");
        if (ok) setV({ email: "", name: "", designation: "", role: "OFFICER", institutionId: "", password: "" });
      }}
    >
      {(["name", "email", "designation"] as const).map((k) => (
        <div key={k}><label className="field-label" htmlFor={`u-${k}`}>{k === "email" ? "Email" : k === "name" ? "Full name" : "Designation (optional)"}</label><input id={`u-${k}`} className="input" value={v[k]} onChange={(e) => setV({ ...v, [k]: e.target.value })} /></div>
      ))}
      <div>
        <label className="field-label" htmlFor="u-role">Role</label>
        <select id="u-role" className="input" value={v.role} onChange={(e) => setV({ ...v, role: e.target.value })}>{ROLES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
      </div>
      {v.role === "INSTITUTION_USER" && (
        <div><label className="field-label" htmlFor="u-inst">Institution</label>
          <select id="u-inst" className="input" value={v.institutionId} onChange={(e) => setV({ ...v, institutionId: e.target.value })}><option value="">Select…</option>{institutions.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}</select>
        </div>
      )}
      {v.role === "OFFICER" && (
        <fieldset><legend className="field-label">Regions</legend>
          <div className="flex flex-wrap gap-2">{regions.map((r) => (
            <label key={r.id} className="flex items-center gap-1 text-xs"><input type="checkbox" checked={regionIds.includes(r.id)} onChange={(e) => setRegionIds(e.target.checked ? [...regionIds, r.id] : regionIds.filter((x) => x !== r.id))} />{r.name}</label>
          ))}</div>
        </fieldset>
      )}
      <div><label className="field-label" htmlFor="u-pw">Initial password</label><input id="u-pw" type="password" autoComplete="new-password" className="input" value={v.password} onChange={(e) => setV({ ...v, password: e.target.value })} /><p className="field-hint">10+ characters with letters and a number. Share it securely.</p></div>
      <div className="flex items-end gap-2 sm:col-span-2 lg:col-span-3"><button className="btn-primary" disabled={busy}>Create user</button><Message /></div>
    </form>
  );
}

export function EditUserForm({ user, regions }: { user: { id: string; role: string; status: string; regionIds: string[] }; regions: { id: string; name: string }[] }) {
  const { busy, run, Message } = useSubmit();
  const [role, setRole] = useState(user.role);
  const [status, setStatus] = useState(user.status === "PENDING" ? "ACTIVE" : user.status);
  const [regionIds, setRegionIds] = useState(user.regionIds);
  const [reason, setReason] = useState("");
  return (
    <form className="space-y-2" onSubmit={async (e) => { e.preventDefault(); await run(() => apiCall(`/api/admin/users/${user.id}`, { method: "PATCH", json: { role, status, regionIds: role === "OFFICER" ? regionIds : undefined, reason } }), "Saved."); }}>
      <div className="flex flex-wrap gap-2">
        <select aria-label="Role" className="input w-auto" value={role} onChange={(e) => setRole(e.target.value)}>{ROLES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
        <select aria-label="Status" className="input w-auto" value={status} onChange={(e) => setStatus(e.target.value)}><option value="ACTIVE">Active</option><option value="DISABLED">Disabled</option></select>
      </div>
      {role === "OFFICER" && (
        <div className="flex flex-wrap gap-2">{regions.map((r) => (
          <label key={r.id} className="flex items-center gap-1 text-xs"><input type="checkbox" checked={regionIds.includes(r.id)} onChange={(e) => setRegionIds(e.target.checked ? [...regionIds, r.id] : regionIds.filter((x) => x !== r.id))} />{r.name}</label>
        ))}</div>
      )}
      <input aria-label="Reason for change" className="input" placeholder="Reason for change (audited)" value={reason} onChange={(e) => setReason(e.target.value)} />
      <div className="flex items-center gap-2"><button className="btn-secondary btn-sm" disabled={busy || reason.trim().length < 3}>Save</button><Message /></div>
    </form>
  );
}

export function SettingsForm({ initial }: { initial: Record<string, unknown> }) {
  const { busy, run, Message } = useSubmit();
  const [v, setV] = useState(() => ({
    reminderWindowsDays: (initial.reminderWindowsDays as number[]).join(", "),
    postMaturityEscalationDays: (initial.postMaturityEscalationDays as number[]).join(", "),
    expiringSoonDays: String(initial.expiringSoonDays),
    scrutinySlaDays: String(initial.scrutinySlaDays),
    correctionResponseDays: String(initial.correctionResponseDays),
    releaseDecisionSlaDays: String(initial.releaseDecisionSlaDays),
    maxDeliveryAttempts: String(initial.maxDeliveryAttempts),
    maxUploadMb: String(initial.maxUploadMb),
    requireIndependentConfirmation: Boolean(initial.requireIndependentConfirmation),
    emailNotifications: Boolean(initial.emailNotifications),
  }));
  const list = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean).map(Number);
  const num: [keyof typeof v, string, string][] = [
    ["expiringSoonDays", "“Expiring soon” window (days)", ""],
    ["scrutinySlaDays", "Scrutiny SLA (days)", "Pending/under review longer than this is overdue."],
    ["correctionResponseDays", "Correction response period (days)", ""],
    ["releaseDecisionSlaDays", "Release step SLA (days)", ""],
    ["maxDeliveryAttempts", "Max email delivery attempts", ""],
    ["maxUploadMb", "Max upload size (MB)", ""],
  ];
  return (
    <form
      className="space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        await run(() => apiCall("/api/admin/settings", {
          method: "PUT",
          json: {
            reminderWindowsDays: list(v.reminderWindowsDays),
            postMaturityEscalationDays: list(v.postMaturityEscalationDays),
            expiringSoonDays: Number(v.expiringSoonDays), scrutinySlaDays: Number(v.scrutinySlaDays), correctionResponseDays: Number(v.correctionResponseDays),
            releaseDecisionSlaDays: Number(v.releaseDecisionSlaDays), maxDeliveryAttempts: Number(v.maxDeliveryAttempts), maxUploadMb: Number(v.maxUploadMb),
            requireIndependentConfirmation: v.requireIndependentConfirmation, emailNotifications: v.emailNotifications,
          },
        }), "Settings saved and audited.");
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="sm:col-span-2"><label className="field-label" htmlFor="s-rem">Reminder windows (days before maturity, 0 = on maturity date)</label><input id="s-rem" className="input" value={v.reminderWindowsDays} onChange={(e) => setV({ ...v, reminderWindowsDays: e.target.value })} /></div>
        <div className="sm:col-span-2"><label className="field-label" htmlFor="s-esc">Escalation after maturity (days; level 1 → officers, level 2+ → approving authorities)</label><input id="s-esc" className="input" value={v.postMaturityEscalationDays} onChange={(e) => setV({ ...v, postMaturityEscalationDays: e.target.value })} /></div>
        {num.map(([k, label, hint]) => (
          <div key={k}><label className="field-label" htmlFor={`s-${k}`}>{label}</label><input id={`s-${k}`} type="number" min={1} className="input" value={String(v[k])} onChange={(e) => setV({ ...v, [k]: e.target.value })} />{hint && <p className="field-hint">{hint}</p>}</div>
        ))}
      </div>
      <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={v.requireIndependentConfirmation} onChange={(e) => setV({ ...v, requireIndependentConfirmation: e.target.checked })} /><span><strong>Require independent confirmation</strong> — only a bank confirmation letter (or a real external provider) can mark an instrument confirmed. Recommended.</span></label>
      <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={v.emailNotifications} onChange={(e) => setV({ ...v, emailNotifications: e.target.checked })} /><span><strong>Email channel</strong> — create email deliveries alongside in-app notifications (simulated provider in this prototype).</span></label>
      <div className="flex items-center gap-2"><button className="btn-primary" disabled={busy}>Save settings</button><Message /></div>
    </form>
  );
}

export function ReferenceForm({ kind }: { kind: "region" | "bank" }) {
  const { busy, run, Message } = useSubmit();
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  return (
    <form className="flex flex-wrap items-end gap-2" onSubmit={async (e) => { e.preventDefault(); if (await run(() => apiCall(`/api/admin/reference/${kind}`, { json: kind === "region" ? { name, code } : { name, shortCode: code, isFictional: true } }), "Added.")) { setName(""); setCode(""); } }}>
      <div className="min-w-40 flex-1"><label className="field-label" htmlFor={`r-${kind}-n`}>{kind === "region" ? "Region name" : "Bank name"}</label><input id={`r-${kind}-n`} className="input" value={name} onChange={(e) => setName(e.target.value)} /></div>
      <div className="w-28"><label className="field-label" htmlFor={`r-${kind}-c`}>Code</label><input id={`r-${kind}-c`} className="input" value={code} onChange={(e) => setCode(e.target.value)} /></div>
      <button className="btn-secondary" disabled={busy}>Add</button>
      <Message />
    </form>
  );
}
