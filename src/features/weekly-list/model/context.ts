/**
 * The context of an item: a course id, a group context id, or `null` for the Personal context.
 */

/** Label of the ring and context of custom tasks with no course. The UI shows its own text for it. */
export const PERSONAL_LABEL = 'Personal';

/**
 * Prefix of the context id for items of a group whose course is unknown, such as an account group.
 * Such an item gets `courseId` `group_<id>`, which is also its Canvas color key.
 */
export const GROUP_CONTEXT_PREFIX = 'group_';

/** True for a `group_<id>` context id, which is not a Canvas course id. */
export function isGroupContext(courseId: string): boolean {
  return courseId.startsWith(GROUP_CONTEXT_PREFIX);
}
