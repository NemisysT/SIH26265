// Presentational building blocks (server-component safe).
import Link from "next/link";
import type { ReactNode } from "react";
import { AlertTriangle, CheckCircle2, Info, XCircle } from "lucide-react";
import type { Tone } from "@/lib/labels";

const TONE_CLASSES: Record<Tone, string> = {
  neutral: "bg-tone-neutral-bg text-tone-neutral",
  info: "bg-tone-info-bg text-tone-info",
  success: "bg-tone-success-bg text-tone-success",
  warning: "bg-tone-warning-bg text-tone-warning",
  danger: "bg-tone-danger-bg text-tone-danger",
  muted: "bg-surface-sunken text-ink-muted",
  accent: "bg-tone-accent-bg text-tone-accent",
};

export function Badge({ tone = "neutral", children, title }: { tone?: Tone; children: ReactNode; title?: string }) {
  return (
    <span title={title} className={`inline-flex items-center gap-1 whitespace-nowrap rounded px-1.5 py-0.5 text-2xs font-semibold ${TONE_CLASSES[tone]}`}>
      {children}
    </span>
  );
}

export function StatusBadge({ map, value }: { map: Record<string, { label: string; tone: Tone; description?: string }>; value: string | null | undefined }) {
  const entry = value ? map[value] : undefined;
  return <Badge tone={entry?.tone ?? "muted"} title={entry?.description}>{entry?.label ?? value ?? "—"}</Badge>;
}

export function DemoTag() {
  return <Badge tone="accent" title="Synthetic demonstration data">DEMO</Badge>;
}

export function PageHeader({ title, description, actions, breadcrumb }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; breadcrumb?: { label: string; href: string }[] }) {
  return (
    <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {breadcrumb && (
          <nav aria-label="Breadcrumb" className="mb-1 text-xs text-ink-subtle">
            {breadcrumb.map((b, i) => (
              <span key={b.href}>
                {i > 0 && <span className="mx-1">/</span>}
                <Link href={b.href} className="hover:text-brand hover:underline">{b.label}</Link>
              </span>
            ))}
          </nav>
        )}
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="mt-1 max-w-3xl text-sm text-ink-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Card({ title, actions, children, className = "", bodyClassName = "card-body", id }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; bodyClassName?: string; id?: string }) {
  return (
    <section className={`card ${className}`} id={id} aria-labelledby={id && title ? `${id}-title` : undefined}>
      {(title || actions) && (
        <div className="card-header">
          {title && <h2 id={id ? `${id}-title` : undefined} className="card-title">{title}</h2>}
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </div>
      )}
      <div className={bodyClassName}>{children}</div>
    </section>
  );
}

export function StatTile({ label, value, hint, href, tone }: { label: string; value: ReactNode; hint?: ReactNode; href?: string; tone?: "warning" | "danger" }) {
  const inner = (
    <>
      <div className="text-xs font-medium text-ink-muted">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums text-ink">{value}</div>
      {hint && (
        <div className={`mt-1 flex items-center gap-1 text-xs ${tone === "danger" ? "text-tone-danger" : tone === "warning" ? "text-tone-warning" : "text-ink-subtle"}`}>
          {tone && <AlertTriangle className="h-3 w-3" aria-hidden />}
          {hint}
        </div>
      )}
    </>
  );
  return href ? (
    <Link href={href} className="card block p-4 transition-colors hover:border-brand/40 hover:bg-brand-soft/40">{inner}</Link>
  ) : (
    <div className="card p-4">{inner}</div>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-md border border-dashed border-line-strong px-6 py-10 text-center">
      <p className="font-medium text-ink">{title}</p>
      {children && <div className="mt-1 max-w-md text-sm text-ink-muted">{children}</div>}
    </div>
  );
}

export function Alert({ tone = "info", title, children }: { tone?: "info" | "success" | "warning" | "danger"; title?: string; children?: ReactNode }) {
  const Icon = tone === "success" ? CheckCircle2 : tone === "danger" ? XCircle : tone === "warning" ? AlertTriangle : Info;
  return (
    <div role={tone === "danger" ? "alert" : "status"} className={`flex gap-2 rounded-md px-3 py-2.5 text-sm ${TONE_CLASSES[tone]}`}>
      <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <div>
        {title && <p className="font-semibold">{title}</p>}
        {children && <div className={title ? "mt-0.5" : ""}>{children}</div>}
      </div>
    </div>
  );
}

export function DescriptionList({ items, columns = 2 }: { items: { label: string; value: ReactNode; hint?: string }[]; columns?: 1 | 2 | 3 }) {
  const cols = columns === 3 ? "sm:grid-cols-3" : columns === 2 ? "sm:grid-cols-2" : "";
  return (
    <dl className={`grid grid-cols-1 gap-x-6 gap-y-3 ${cols}`}>
      {items.map((it) => (
        <div key={it.label} className="min-w-0">
          <dt className="text-xs font-medium text-ink-subtle">{it.label}</dt>
          <dd className="mt-0.5 break-words text-sm text-ink">{it.value ?? "—"}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Link-based pagination preserving the current filters. */
export function Pagination({ basePath, params, page, pageSize, total }: { basePath: string; params: Record<string, string | undefined>; page: number; pageSize: number; total: number }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const href = (p: number) => {
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v && k !== "page") sp.set(k, v);
    if (p > 1) sp.set("page", String(p));
    const qs = sp.toString();
    return qs ? `${basePath}?${qs}` : basePath;
  };
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  return (
    <nav aria-label="Pagination" className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-xs text-ink-muted">
      <span>Showing {from}–{to} of {total}</span>
      <div className="flex gap-1">
        {page > 1 ? <Link className="btn-secondary btn-sm" href={href(page - 1)}>Previous</Link> : <span className="btn-secondary btn-sm opacity-50" aria-disabled>Previous</span>}
        <span className="px-2 py-1.5">Page {page} of {pages}</span>
        {page < pages ? <Link className="btn-secondary btn-sm" href={href(page + 1)}>Next</Link> : <span className="btn-secondary btn-sm opacity-50" aria-disabled>Next</span>}
      </div>
    </nav>
  );
}

export function Tabs({ tabs, active }: { tabs: { key: string; label: string; href: string; count?: number }[]; active: string }) {
  return (
    <div className="mb-4 flex gap-1 overflow-x-auto border-b border-line" role="tablist">
      {tabs.map((t) => (
        <Link
          key={t.key}
          href={t.href}
          role="tab"
          aria-selected={t.key === active}
          className={`-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium ${t.key === active ? "border-brand text-brand" : "border-transparent text-ink-muted hover:text-ink"}`}
        >
          {t.label}
          {t.count !== undefined && <span className="ml-1.5 rounded bg-surface-sunken px-1.5 py-0.5 text-2xs text-ink-muted">{t.count}</span>}
        </Link>
      ))}
    </div>
  );
}
