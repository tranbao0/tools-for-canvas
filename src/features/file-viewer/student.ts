import { isCanvasId, normalizeCanvasId } from '../../shared/canvas/ids';
import { defineItem } from '../../shared/platform/storageItem';

/**
 * The storage key of the student that the viewer data belongs to, next to the epoch. The viewer
 * data is the tabs of the panes, the saved positions and the panes that are open in the pages. It
 * lives in `storage.session`, so it survives a restart of the worker, and a change of student
 * is found even when the worker lost its proof of the earlier student.
 */
export const STUDENT_KEY = 'viewer:session:student';

export const viewerStudentItem = defineItem<string | null>(`session:${STUDENT_KEY}`, () => null);

/** The id of a student as the viewer names it: the global decimal form, so one student has one name. */
export function studentName(id: string): string {
  return isCanvasId(id) ? normalizeCanvasId(id) : id;
}
