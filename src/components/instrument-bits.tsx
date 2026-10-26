import { Badge } from "./ui";
import { MATURITY_STATE } from "@/lib/labels";
import { daysBetween, maturityState } from "@/lib/dates";
import { formatDate } from "@/lib/format";

/** Maturity cell: date + derived state badge + days remaining (business rule in lib/dates). */
export function MaturityCell({ date, today, windowDays, status }: { date: Date | null; today: Date; windowDays: number; status: string }) {
  if (!date) return <Badge tone="warning">No date</Badge>;
  const held = status === "ACCEPTED";
  const state = maturityState(date, today, windowDays);
  const days = daysBetween(today, date);
  const meta = MATURITY_STATE[state];
  return (
    <div className="whitespace-nowrap leading-tight">
      <div className="tabular-nums">{formatDate(date)}</div>
      {held && (
        <div className="mt-0.5 flex items-center gap-1">
          <Badge tone={meta.tone}>{meta.label}</Badge>
          <span className="text-2xs text-ink-subtle">{days > 0 ? `${days} d left` : days === 0 ? "today" : `${-days} d ago`}</span>
        </div>
      )}
    </div>
  );
}
