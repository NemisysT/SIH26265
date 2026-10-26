// Date-driven monitoring job: maturity reminders, overdue detection, escalation and delivery
// retries. Runs from the CLI (`npm run monitor`), a scheduled cron job, or an administrator's
// "run now" — never from a browser. Safe to run repeatedly: every reminder carries a dedupe key
// that includes the instrument's current maturity date, so re-runs never duplicate a reminder, and
// an edited maturity date produces fresh reminders for the new date.
import { prisma } from "../db";
import { getSettings, type Settings } from "../settings";
import { addDays, businessToday, daysBetween, toDateOnlyString } from "@/lib/dates";
import { formatDate } from "@/lib/format";
import { institutionUserIds, notify, officerIdsForInstitution, processDeliveries, userIdsByRole } from "../notifications/notify";
import { recordAudit } from "../audit";
import * as rules from "../services/rules";
import { now as clockNow } from "../clock";

const SYSTEM = { kind: "system" as const, label: "maturity-monitor" };

/**
 * The reminder threshold currently applicable: the smallest configured window that the remaining
 * days fall within. Only that threshold is sent, so a late first run does not emit a burst of
 * stale reminders. Returns null when no window applies yet.
 */
export function applicableWindow(daysRemaining: number, windows: number[]): number | null {
  const sorted = [...windows].sort((a, b) => a - b);
  for (const w of sorted) if (daysRemaining <= w) return w;
  return null;
}

/** Highest escalation level reached for an instrument that matured `daysPast` days ago. */
export function escalationLevel(daysPast: number, escalationDays: number[]): number {
  return [...escalationDays].sort((a, b) => a - b).filter((d) => daysPast >= d).length;
}

export interface MonitorSummary {
  reminders: number;
  maturityReached: number;
  escalations: number;
  overdueScrutiny: number;
  overdueCorrections: number;
  overdueReleases: number;
  deliveries: Awaited<ReturnType<typeof processDeliveries>>;
}

export async function runMonitor(opts: { trigger: "CLI" | "SCHEDULE" | "MANUAL" | "TEST"; triggeredById?: string; now?: Date } ) {
  const nowTs = opts.now ?? clockNow();
  const run = await prisma.jobRun.create({ data: { job: "maturity-monitor", trigger: opts.trigger, triggeredById: opts.triggeredById } });
  try {
    const settings = await getSettings();
    const summary = await monitorPass(settings, nowTs);
    await prisma.$transaction(async (tx) => {
      await tx.jobRun.update({ where: { id: run.id }, data: { status: "SUCCEEDED", finishedAt: new Date(), summary: summary as object } });
      await recordAudit(tx, SYSTEM, { action: "MONITOR_RUN", resourceType: "JobRun", resourceId: run.id, after: { trigger: opts.trigger, ...summary } });
    });
    return { runId: run.id, summary };
  } catch (err) {
    await prisma.jobRun.update({
      where: { id: run.id },
      data: { status: "FAILED", finishedAt: new Date(), error: (err instanceof Error ? err.message : String(err)).slice(0, 1000) },
    });
    throw err;
  }
}

async function monitorPass(settings: Settings, nowTs: Date): Promise<MonitorSummary> {
  const today = businessToday(nowTs);
  const s: Omit<MonitorSummary, "deliveries"> = { reminders: 0, maturityReached: 0, escalations: 0, overdueScrutiny: 0, overdueCorrections: 0, overdueReleases: 0 };
  const largestWindow = Math.max(...settings.reminderWindowsDays);

  // 1. Upcoming maturity and maturity reached — held instruments with no renewal/release under way.
  //    Instruments already being renewed or released are ineligible for reminders.
  const candidates = await prisma.instrument.findMany({
    where: { AND: [rules.held, rules.noActionUnderway, { maturityDate: { not: null, lte: addDays(today, largestWindow) } }] },
    select: { id: true, referenceNo: true, institutionId: true, maturityDate: true, amount: true },
  });
  for (const inst of candidates) {
    const remaining = daysBetween(today, inst.maturityDate!);
    const maturityIso = toDateOnlyString(inst.maturityDate)!;
    const base = { institutionId: inst.institutionId, instrumentId: inst.id, link: `/instruments/${inst.id}`, dueDate: inst.maturityDate };
    if (remaining > 0) {
      const w = applicableWindow(remaining, settings.reminderWindowsDays.filter((d) => d > 0));
      if (w === null) continue;
      s.reminders += await notify(prisma, {
        ...base,
        recipientIds: await institutionUserIds(prisma, inst.institutionId),
        type: "MATURITY_UPCOMING",
        title: `${inst.referenceNo} matures in ${remaining} day${remaining === 1 ? "" : "s"}`,
        message: `Maturity date ${formatDate(inst.maturityDate)} (${w}-day reminder). Submit a renewal/replacement or a release request in time.`,
        dedupeKey: `maturity:${inst.id}:${maturityIso}:T-${w}`,
      });
    } else {
      // On / after maturity: one "maturity reached" notice to the institution and its officers.
      const recipients = [...(await institutionUserIds(prisma, inst.institutionId)), ...(await officerIdsForInstitution(prisma, inst.institutionId))];
      s.maturityReached += await notify(prisma, {
        ...base,
        recipientIds: recipients,
        type: "MATURITY_REACHED",
        title: `${inst.referenceNo} has matured`,
        message: `Matured on ${formatDate(inst.maturityDate)}. Renewal/replacement or release action is required.`,
        dedupeKey: `maturity:${inst.id}:${maturityIso}:reached`,
      });
      // Escalation ladder after maturity: level 1 → regional officers, level 2+ → approving authorities.
      const level = escalationLevel(-remaining, settings.postMaturityEscalationDays);
      for (let l = 1; l <= level; l++) {
        const toAuthorities = l >= 2;
        s.escalations += await notify(prisma, {
          ...base,
          recipientIds: toAuthorities
            ? await userIdsByRole(prisma, "APPROVING_AUTHORITY")
            : [...(await officerIdsForInstitution(prisma, inst.institutionId)), ...(await institutionUserIds(prisma, inst.institutionId))],
          type: toAuthorities ? "ESCALATION" : "OVERDUE_ACTION",
          title: `${toAuthorities ? "Escalated" : "Overdue"}: ${inst.referenceNo} matured ${-remaining} days ago`,
          message: `No renewal, replacement or release has been started ${settings.postMaturityEscalationDays[l - 1]}+ days after maturity (escalation level ${l}).`,
          dedupeKey: `escalation:matured:${inst.id}:${maturityIso}:L${l}`,
        });
      }
    }
  }

  // 2. Scrutiny SLA breaches — alert regional officers once per status episode; escalate at 2× SLA.
  const DAY = 86_400_000;
  const scrutiny = await prisma.instrument.findMany({
    where: { status: { in: ["PENDING_SCRUTINY", "UNDER_REVIEW", "VERIFICATION_PENDING"] }, statusChangedAt: { lt: new Date(nowTs.getTime() - settings.scrutinySlaDays * DAY) } },
    select: { id: true, referenceNo: true, institutionId: true, statusChangedAt: true, status: true, reviewerId: true },
  });
  for (const inst of scrutiny) {
    const age = Math.floor((nowTs.getTime() - inst.statusChangedAt.getTime()) / DAY);
    const episode = inst.statusChangedAt.toISOString();
    const base = { institutionId: inst.institutionId, instrumentId: inst.id, link: `/instruments/${inst.id}` };
    s.overdueScrutiny += await notify(prisma, {
      ...base,
      recipientIds: inst.reviewerId ? [inst.reviewerId] : await officerIdsForInstitution(prisma, inst.institutionId),
      type: "OVERDUE_ACTION",
      title: `Scrutiny overdue: ${inst.referenceNo}`,
      message: `In status ${inst.status.replace(/_/g, " ").toLowerCase()} for ${age} days (SLA ${settings.scrutinySlaDays} days).`,
      dedupeKey: `overdue:scrutiny:${inst.id}:${episode}`,
    });
    if (age >= settings.scrutinySlaDays * 2) {
      s.escalations += await notify(prisma, {
        ...base,
        recipientIds: await userIdsByRole(prisma, "APPROVING_AUTHORITY"),
        type: "ESCALATION",
        title: `Escalated: scrutiny of ${inst.referenceNo} overdue`,
        message: `Pending for ${age} days — twice the ${settings.scrutinySlaDays}-day SLA.`,
        dedupeKey: `escalation:scrutiny:${inst.id}:${episode}`,
      });
    }
  }

  // 3. Correction responses overdue — remind the institution and inform officers.
  const corrections = await prisma.instrument.findMany({
    where: { status: "CORRECTION_REQUIRED", statusChangedAt: { lt: new Date(nowTs.getTime() - settings.correctionResponseDays * DAY) } },
    select: { id: true, referenceNo: true, institutionId: true, statusChangedAt: true },
  });
  for (const inst of corrections) {
    s.overdueCorrections += await notify(prisma, {
      institutionId: inst.institutionId,
      instrumentId: inst.id,
      link: `/instruments/${inst.id}`,
      recipientIds: [...(await institutionUserIds(prisma, inst.institutionId)), ...(await officerIdsForInstitution(prisma, inst.institutionId))],
      type: "OVERDUE_ACTION",
      title: `Correction overdue: ${inst.referenceNo}`,
      message: `The requested correction has not been submitted within ${settings.correctionResponseDays} days.`,
      dedupeKey: `overdue:correction:${inst.id}:${inst.statusChangedAt.toISOString()}`,
    });
  }

  // 4. Release / refund requests waiting beyond the decision SLA.
  const releases = await prisma.releaseRequest.findMany({
    where: rules.overdueReleases(nowTs, settings),
    select: { id: true, referenceNo: true, institutionId: true, instrumentId: true, status: true, statusChangedAt: true },
  });
  for (const rr of releases) {
    const recipients =
      rr.status === "PENDING_APPROVAL" ? await userIdsByRole(prisma, "APPROVING_AUTHORITY") : await officerIdsForInstitution(prisma, rr.institutionId);
    s.overdueReleases += await notify(prisma, {
      institutionId: rr.institutionId,
      instrumentId: rr.instrumentId,
      releaseRequestId: rr.id,
      link: `/releases/${rr.id}`,
      recipientIds: recipients,
      type: "OVERDUE_ACTION",
      title: `Release request overdue: ${rr.referenceNo}`,
      message: `Awaiting ${rr.status === "PENDING_APPROVAL" ? "a decision" : "scrutiny"} beyond the ${settings.releaseDecisionSlaDays}-day SLA.`,
      dedupeKey: `overdue:release:${rr.id}:${rr.statusChangedAt.toISOString()}`,
    });
  }

  // 5. Email delivery attempts / retries (simulated provider unless a real one is configured).
  const deliveries = await processDeliveries(nowTs);
  return { ...s, deliveries };
}
