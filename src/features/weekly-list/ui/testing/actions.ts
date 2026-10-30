/** Spy actions for component tests. */
import { vi, type Mock } from 'vitest';
import type { Actions } from '../contract';

export type SpyActions = { [K in keyof Actions]: Mock<Actions[K]> };

export function spyActions(): SpyActions {
  return {
    goToSpan: vi.fn(),
    stepSpan: vi.fn(),
    setCourseFilter: vi.fn(),
    setDone: vi.fn(),
    skip: vi.fn(),
    unskip: vi.fn(),
    skipAllOlder: vi.fn(),
    undo: vi.fn(),
    dismissUndo: vi.fn(),
    createTask: vi.fn(async () => true),
    updateTask: vi.fn(),
    deleteTask: vi.fn(),
    moveTaskToToday: vi.fn(),
    openItem: vi.fn(),
    allowAccess: vi.fn(),
    acceptOffer: vi.fn(),
    dismissOffer: vi.fn(),
    openCanvas: vi.fn(),
    retry: vi.fn(),
    saveSettings: vi.fn(),
    saveTools: vi.fn(),
    markNoteSeen: vi.fn(),
    setListTab: vi.fn(),
    setShowRead: vi.fn(),
    markAnnouncementRead: vi.fn(),
    loadAnnouncementMessage: vi.fn(async () => null),
    openAnnouncement: vi.fn(),
    retryAnnouncements: vi.fn(),
  };
}
