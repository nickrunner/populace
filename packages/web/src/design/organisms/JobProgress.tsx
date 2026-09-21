import type { JobView } from "@populace/contract";
import { forwardRef } from "react";

import { people as peopleWord } from "../../format.js";
import { Inline, Meter, Spinner, Stack, Text } from "../atoms/index.js";
import { Card } from "./Card.js";

/**
 * JobProgress — what a long-running piece of work is doing, while it does it.
 *
 * ATOMIC-INVENTORY §5 names it on `People` (row 12) and `Cohort` (row 13), and §6.3 row 18 says
 * plainly that "two `JobProgress` implementations unify". They did not: both screens kept a local
 * `WritingProgress`, and the two had already drifted apart on things a reader can see — one hid
 * the meter on `total === 0` and the other on `total === null || total === 0`; one took the first
 * non-empty label across several jobs and the other read a single job's. This is the one, and it
 * takes both shapes.
 *
 * **A job is a row, not a promise** (ADR-0027). Starting an execution, writing a cohort's people,
 * building a digest and sweeping all take time and most of them cost money, so what the browser
 * shows has to survive a reload and has to come from the row. Everything here reads
 * `job.progress` and nothing here times anything.
 *
 * **The label is the job's own.** A job publishes what it is doing; that is what is shown. The
 * `label` prop is only the word to use before any job has published one — the first second after
 * a POST, or a read that has not landed. Preferring a *busy* job's label matters when a screen
 * starts several at once: a finished job's last words ("Wrote 12 people") are not what is
 * happening now.
 *
 * **The meter appears only when the work knows its own total.** Writing people knows how many it
 * is writing; an execution does not know how many visits it will make, and `progress.total` is
 * `null` for exactly that reason. A progress bar over an unknown total is a guess drawn as a
 * measurement, so there is a `Spinner` and a sentence and no bar at all.
 *
 * **Nothing here claims a duration, and nothing here claims an outcome** (§7.3). No "2 minutes
 * remaining", no "almost done": what was actually spent and what actually landed are on the job
 * row afterwards, and the screen says so in its own words.
 */

export interface JobProgressProps {
  /**
   * The job rows being watched. One where a screen started one, several where it started several
   * at once, and empty while the first read is still in flight — which is a real state, not a
   * bug: the screen knows it started something before it knows anything about it.
   */
  jobs: readonly JobView[];
  /** What to call the work before any job has published a label of its own — "Writing them". */
  label: string;
  /**
   * The meter's sentence, which is its accessible name and its value text both. It counts people
   * by default, because both sites that needed this counted people; a job that counts something
   * else says so here.
   */
  sentence?: (done: number, total: number) => string;
}

/** A job that has not finished. Its words are the present tense; a finished job's are not. */
const busy = (job: JobView): boolean => job.status === "queued" || job.status === "running";

/** The first job with something to say, preferring the ones still working. */
function labelOf(jobs: readonly JobView[], fallback: string): string {
  const spoken =
    jobs.filter(busy).find((job) => job.progress.label !== "")?.progress.label ??
    jobs.find((job) => job.progress.label !== "")?.progress.label;
  return spoken === undefined || spoken === "" ? fallback : spoken;
}

export const JobProgress = forwardRef<HTMLElement, JobProgressProps>(function JobProgress(
  { jobs, label, sentence = (done, total) => `${done} of ${peopleWord(total)} written so far.` },
  ref,
) {
  const said = labelOf(jobs, label);
  // `total: null` means "not knowable in advance" and contributes nothing, which is the same
  // arithmetic as a job that knows it has nothing to do. Summed across the jobs, because a screen
  // that wrote four cohorts at once is watching one piece of work in four rows.
  const total = jobs.reduce((sum, job) => sum + (job.progress.total ?? 0), 0);
  const done = jobs.reduce((sum, job) => sum + job.progress.done, 0);

  return (
    <Card ref={ref} tone="sunk" pad="tight">
      <Stack gap={2}>
        <Inline gap={2} align="center">
          {/* `Spinner` carries the accessible announcement; the `Text` is the same words seen. */}
          <Spinner label={said} size="sm" />
          <Text size="ui">{said}</Text>
        </Inline>
        {total === 0 ? null : (
          <Meter value={done} of={total} size="sm" label={sentence(done, total)} />
        )}
      </Stack>
    </Card>
  );
});
