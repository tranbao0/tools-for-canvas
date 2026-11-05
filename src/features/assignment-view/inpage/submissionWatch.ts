/**
 * The read of a submission while the assignment pane is open (design decision 26, step 3). The
 * pane reads the submission on each trusted load of its frame after the first, when it closes, and
 * every 20 seconds, because the new student view submits without a page load. A change in the
 * submission asks the weekly list to refresh. Nothing here draws a row.
 */
import { normalizeCanvasId } from '../../../shared/canvas/ids';
import type { DataMessage } from '../../weekly-list/data/protocol';
import {
  isDetailsReply,
  type AssignmentDetailsMessage,
  type AssignmentDetailsReply,
} from '../protocol';
import { submissionChanged, type SubmissionMark } from '../preview';
import { createListRefresh } from './listRefresh';

export interface SubmissionWatchOptions {
  /** The course of the page. */
  courseId: string;
  send(message: AssignmentDetailsMessage | DataMessage): Promise<unknown>;
  /** Whether the view is on. A read while it is off does nothing. */
  active(): boolean;
  /** Called when a read finds the submission of another student. */
  onOtherStudent(): void;
}

export interface SubmissionWatch {
  /**
   * Reads the submission of an assignment. The first read of an assignment is its baseline, and
   * each later read is compared with the read before it. A change in `submitted_at`,
   * `workflow_state` or `attempt` asks the weekly list to refresh. A failed read leaves the
   * baseline as it is and rejects.
   */
  read(assignmentId: string): Promise<void>;
  /**
   * Forgets the baselines, also those of a read that is on its way, and keeps the waiting
   * refresh. The next read of each assignment is a baseline again.
   */
  forget(): void;
  /** Forgets the baselines and drops a waiting refresh. */
  stop(): void;
}

export function createSubmissionWatch(options: SubmissionWatchOptions): SubmissionWatch {
  const { courseId, send } = options;
  const listRefresh = createListRefresh(send);
  /**
   * The compared fields of the last good reply of each assignment, by assignment id. The reply
   * holds signed session addresses, so only a copy of these fields stays in memory.
   */
  const known = new Map<string, SubmissionMark>();
  let stopped = false;
  /** Counts the times the baselines were forgotten, so a read that began before cannot write one. */
  let generation = 0;

  async function load(assignmentId: string): Promise<AssignmentDetailsReply> {
    const reply = await send({ type: 'assignment:details', courseId, assignmentId });
    if (
      !isDetailsReply(reply) ||
      normalizeCanvasId(reply.details.assignment.id) !== normalizeCanvasId(assignmentId)
    ) {
      throw new Error('The background gave no details');
    }
    return reply;
  }

  return {
    async read(assignmentId) {
      if (stopped || !options.active()) return;
      const previous = known.get(assignmentId);
      const began = generation;
      const next = await load(assignmentId);
      if (stopped || !options.active() || began !== generation) return;
      const { user_id, submitted_at, workflow_state, attempt } = next.details.submission;
      const mark: SubmissionMark = { user_id, submitted_at, workflow_state, attempt };
      if (previous !== undefined && previous.user_id !== mark.user_id) {
        known.clear();
        options.onOtherStudent();
        return;
      }
      known.set(assignmentId, mark);
      if (previous !== undefined && submissionChanged(previous, mark)) {
        // The visible refresh keeps the Canvas rate limit and the backoff of the weekly list.
        listRefresh.request();
      }
    },
    forget() {
      generation += 1;
      known.clear();
    },
    stop() {
      if (stopped) return;
      stopped = true;
      known.clear();
      listRefresh.stop();
    },
  };
}
