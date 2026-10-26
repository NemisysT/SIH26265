// Lightweight, dependency-free bar charts. Single series → one hue (chart blue), no legend; the
// card title names the measure. Values sit at the bar tip, every bar has a hover tooltip, and a
// table view carries the same numbers for screen readers / print.
import Link from "next/link";

export interface BarDatum {
  key: string;
  label: string;
  value: number;
  href?: string;
  note?: string;
}

function TableView({ data, valueLabel }: { data: BarDatum[]; valueLabel: string }) {
  return (
    <details className="mt-3 text-xs">
      <summary className="cursor-pointer text-ink-subtle hover:text-ink">View as table</summary>
      <table className="table mt-2">
        <thead><tr><th scope="col">Category</th><th scope="col" className="num">{valueLabel}</th></tr></thead>
        <tbody>{data.map((d) => <tr key={d.key}><td>{d.label}</td><td className="num">{d.value}</td></tr>)}</tbody>
      </table>
    </details>
  );
}

/** Horizontal bars — for comparing counts across named categories. */
export function HBarChart({ data, valueLabel, ariaLabel }: { data: BarDatum[]; valueLabel: string; ariaLabel: string }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <figure aria-label={ariaLabel}>
      <ul className="space-y-1.5" aria-hidden>
        {data.map((d) => {
          const row = (
            <div className="grid grid-cols-[minmax(7rem,11rem)_1fr] items-center gap-3" title={`${d.label}: ${d.value}${d.note ? ` — ${d.note}` : ""}`}>
              <span className="truncate text-xs text-ink-muted">{d.label}</span>
              <span className="flex items-center gap-2">
                <span className="h-3.5 rounded-r bg-chart" style={{ width: `${Math.max(d.value > 0 ? 1.5 : 0, (d.value / max) * 85)}%` }} />
                <span className="text-xs font-semibold tabular-nums text-ink">{d.value}</span>
              </span>
            </div>
          );
          return <li key={d.key}>{d.href ? <Link href={d.href} className="block rounded hover:bg-surface">{row}</Link> : row}</li>;
        })}
      </ul>
      <TableView data={data} valueLabel={valueLabel} />
    </figure>
  );
}

/** Vertical columns — for ordered buckets such as time-to-maturity. */
export function ColumnChart({ data, valueLabel, ariaLabel, highlightKey }: { data: BarDatum[]; valueLabel: string; ariaLabel: string; highlightKey?: string }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <figure aria-label={ariaLabel}>
      <div className="flex h-44 items-end gap-2 border-b border-line px-1" aria-hidden>
        {data.map((d) => {
          const col = (
            <div className="flex h-full flex-col items-center justify-end" title={`${d.label}: ${d.value}${d.note ? ` — ${d.note}` : ""}`}>
              <span className="mb-1 text-xs font-semibold tabular-nums text-ink">{d.value}</span>
              <span className="w-full max-w-6 rounded-t bg-chart" style={{ height: `${d.value === 0 ? 0 : Math.max(3, (d.value / max) * 82)}%` }} />
            </div>
          );
          return (
            <div key={d.key} className="flex h-full flex-1 flex-col">
              {d.href ? <Link href={d.href} className="flex h-full flex-col rounded-t hover:bg-surface">{col}</Link> : col}
            </div>
          );
        })}
      </div>
      <div className="mt-1.5 flex gap-2 px-1" aria-hidden>
        {data.map((d) => (
          <span key={d.key} className={`flex-1 text-center text-2xs leading-tight ${d.key === highlightKey ? "font-semibold text-tone-danger" : "text-ink-subtle"}`}>
            {d.label}
          </span>
        ))}
      </div>
      <TableView data={data} valueLabel={valueLabel} />
    </figure>
  );
}
