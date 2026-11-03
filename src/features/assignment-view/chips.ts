/**
 * The status chips of the open assignment: the same rules and the same labels as the weekly list
 * (design decisions 7 and 26). The details reply holds the facts, so the chips need no other read.
 */
import { classifyHandIn } from '../weekly-list/model/handin';
import { submissionFacts } from '../weekly-list/model/normalize';
import {
  availabilityFor,
  doneChipsFor,
  handInChipFor,
  hasWarningChip,
  itemState,
  redoBlocksDone,
  statusChip,
} from '../weekly-list/model/rules';
import type { AssignmentData, Item, ItemView } from '../weekly-list/model/types';
import { itemTags, type Tag } from '../weekly-list/ui/tags';
import type { AssignmentDetails } from './protocol';

/** The assignment as the list model reads it, built from the details reply. */
function assignmentData(details: AssignmentDetails): AssignmentData {
  const { assignment, submission } = details;
  return {
    id: assignment.id,
    name: assignment.name,
    course_id: '',
    due_at: assignment.due_at,
    lock_at: assignment.lock_at ?? null,
    unlock_at: assignment.unlock_at ?? null,
    submission_types: assignment.submission_types ?? [],
    is_quiz_lti_assignment: assignment.is_quiz_lti_assignment,
    html_url: '',
    external_tool_tag_attributes: { url: assignment.external_tool_url ?? null },
    submission: {
      submitted_at: submission.submitted_at ?? null,
      workflow_state: submission.workflow_state ?? 'unsubmitted',
      excused: submission.excused ?? false,
      missing: submission.missing ?? false,
      late_policy_status: submission.late_policy_status ?? null,
      custom_grade_status_id: submission.custom_grade_status_id ?? null,
      redo_request: submission.redo_request ?? false,
      cached_due_date: null,
      score: submission.score,
    },
  };
}

/** The chips of an assignment as the weekly list shows them, in the same order. */
export function assignmentTags(
  details: AssignmentDetails,
  now: Temporal.Instant,
  timeZone: string,
): Tag[] {
  const data = assignmentData(details);
  const handIn = classifyHandIn(data);
  const item: Item = {
    key: `assignment:${details.assignment.id}`,
    kind: 'assignment',
    plannableType: 'assignment',
    plannableId: details.assignment.id,
    assignmentId: details.assignment.id,
    title: details.assignment.name,
    subtitleTag: null,
    courseId: null,
    contextLabel: '',
    color: '',
    due: details.assignment.due_at,
    url: null,
    handIn: handIn.handIn,
    toolName: handIn.toolName,
    onPaper: handIn.onPaper,
    isReminder: handIn.handIn === 'none',
    override: null,
    facts: submissionFacts(data),
    noteId: null,
    noteDetails: null,
  };
  const state = itemState(item);
  const doneChips = doneChipsFor(item, state);
  const view: ItemView = {
    ...item,
    state,
    // The Grades page lists past work too, so a past due date always gets its chip here.
    chip: statusChip(item, state, { now, showPastDueChip: true, gradeStatuses: undefined }),
    availability: availabilityFor(item, state, now),
    handInChip: handInChipFor(item),
    doneChips,
    hasWarning: hasWarningChip(doneChips),
    checkboxDisabled: redoBlocksDone(item),
    canSkip: false,
    canMoveToToday: false,
    isLookAhead: false,
  };
  return itemTags(view, timeZone);
}
