/**
 * How the student hands work in, from an assignment's `submission_types`. See docs/design.md, decision 7.
 */
import type { Assignment } from '../../../shared/canvas/types';
import type { HandIn } from './types';
import { toolNameFromUrl } from './tools';

/** Work that Canvas checks off when the student submits. */
const ON_CANVAS_TYPES = new Set([
  'online_upload',
  'online_text_entry',
  'online_url',
  'media_recording',
  'student_annotation',
  'online_quiz',
  'discussion_topic',
]);

/** Work handed in where Canvas cannot see it. */
const OUTSIDE_TYPES = new Set(['external_tool', 'on_paper']);

/** Assignments with nothing to hand in. They show as reminders. */
const NOTHING_TYPES = new Set(['none', 'not_graded', 'attendance', 'wiki_page']);

export interface HandInInfo {
  handIn: HandIn;
  /** Tool name for `external_tool` work, or `null` when the URL gives none. */
  toolName: string | null;
  onPaper: boolean;
}

export type HandInSource = Pick<
  Assignment,
  'submission_types' | 'is_quiz_lti_assignment' | 'external_tool_tag_attributes'
>;

/**
 * Classifies an assignment. A New Quiz is On Canvas. When the types mix methods, On Canvas wins
 * over Outside Canvas, and Outside Canvas wins over nothing to hand in. Unknown or empty types
 * count as On Canvas, so the item follows the normal rules.
 */
export function classifyHandIn(assignment: HandInSource): HandInInfo {
  const types = assignment.submission_types;
  if (
    assignment.is_quiz_lti_assignment === true ||
    types.some((type) => ON_CANVAS_TYPES.has(type))
  ) {
    return { handIn: 'canvas', toolName: null, onPaper: false };
  }
  if (types.some((type) => OUTSIDE_TYPES.has(type))) {
    const onPaper = types.includes('on_paper') && !types.includes('external_tool');
    const toolName = onPaper ? null : toolNameFromUrl(assignment.external_tool_tag_attributes?.url);
    return { handIn: 'outside', toolName, onPaper };
  }
  if (types.length > 0 && types.every((type) => NOTHING_TYPES.has(type))) {
    return { handIn: 'none', toolName: null, onPaper: false };
  }
  return { handIn: 'canvas', toolName: null, onPaper: false };
}
