import type { Job } from "./types.ts";

/** Nudge after 5 working days, and again after 10. */
export const NUDGE_DAYS = [5, 10];

export function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/** ISO day + n working days, skipping Saturday and Sunday. */
export function addWorkingDays(day: string, n: number): string {
  const d = new Date(`${day}T12:00:00Z`);
  while (n > 0) {
    d.setUTCDate(d.getUTCDate() + 1);
    const dow = d.getUTCDay();
    if (dow !== 0 && dow !== 6) n--;
  }
  return d.toISOString().slice(0, 10);
}

export function appliedPatch(day = today()): Partial<Job> {
  return { status: "applied", appliedAt: day, followUps: NUDGE_DAYS.map((n) => addWorkingDays(day, n)) };
}

/** A nudge done: drop the soonest date. The job stays live until it is answered. */
export function followedUpPatch(job: Job): Partial<Job> {
  return { status: "followed_up", followUps: (job.followUps ?? []).slice(1) };
}

const LIVE = new Set(["applied", "followed_up"]);

/** Jobs with a nudge due today or overdue, most overdue first. */
export function dueFollowUps(jobs: Job[], day = today()): Job[] {
  return jobs
    .filter((j) => LIVE.has(j.status) && j.followUps?.[0] && j.followUps[0] <= day)
    .sort((a, b) => a.followUps![0].localeCompare(b.followUps![0]));
}
