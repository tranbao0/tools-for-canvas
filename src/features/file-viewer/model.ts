/** File identities and pane state contain no download addresses. */
export interface Tabs {
  ids: string[];
  active: string | null;
}
export type FileTarget =
  { fileId: string } | { courseId: string; moduleId: string; itemId: string };
const ID = /^[1-9][0-9]{0,19}$/;
const FILE = /^\/(?:courses\/[1-9][0-9]*\/)?files\/([1-9][0-9]*)(?:\/(?:download|preview))?$/;
export function plainClick(
  event: Pick<MouseEvent, 'button' | 'ctrlKey' | 'shiftKey' | 'altKey' | 'metaKey'>,
): boolean {
  return event.button === 0 && !event.ctrlKey && !event.shiftKey && !event.altKey && !event.metaKey;
}
export function fileTarget(href: string, origin: string, moduleId?: string): FileTarget | null {
  let url: URL;
  try {
    url = new URL(href, origin);
  } catch {
    return null;
  }
  if (url.origin !== origin) return null;
  const file = FILE.exec(url.pathname);
  if (file?.[1] && ID.test(file[1])) return { fileId: file[1] };
  const module = /^\/courses\/([1-9][0-9]*)\/modules\/items\/([1-9][0-9]*)$/.exec(url.pathname);
  if (module?.[1] && module[2] && moduleId && ID.test(moduleId))
    return { courseId: module[1], moduleId, itemId: module[2] };
  return null;
}
export function validRequest(value: unknown): value is string {
  return typeof value === 'string' && (ID.test(value) || FILE.test(value));
}
export function normalizeWidth(value: unknown, viewportWidth = 1920): number {
  const limit = Math.max(360, Math.floor(viewportWidth * 0.7));
  const width = typeof value === 'number' && Number.isFinite(value) ? value : 480;
  return Math.round(Math.max(360, Math.min(limit, width)));
}
export function openFile(state: Tabs, id: string): Tabs {
  if (!ID.test(id)) return state;
  const ids = [...state.ids];
  if (!ids.includes(id)) {
    if (ids.length >= 8)
      ids.splice(
        ids.findIndex((entry) => entry !== state.active),
        1,
      );
    ids.push(id);
  }
  return { ids, active: id };
}
export function normalizeTabs(value: unknown): Tabs {
  if (typeof value !== 'object' || value === null) return { ids: [], active: null };
  const raw = value as Partial<Tabs>;
  const ids = Array.isArray(raw.ids)
    ? [...new Set(raw.ids.filter((id) => typeof id === 'string' && ID.test(id)))].slice(0, 8)
    : [];
  return {
    ids,
    active:
      typeof raw.active === 'string' && ids.includes(raw.active) ? raw.active : (ids[0] ?? null),
  };
}
/** Closes a tab. The tab that takes its place becomes active, or the one before it at the end. */
export function closeFile(state: Tabs, id: string): Tabs {
  const index = state.ids.indexOf(id);
  if (index < 0) return state;
  const ids = state.ids.filter((entry) => entry !== id);
  if (state.active !== id) return { ids, active: state.active };
  return { ids, active: ids[index] ?? ids[index - 1] ?? null };
}
