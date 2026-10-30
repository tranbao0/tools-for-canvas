// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HOSTILE_MESSAGE } from '../../../../tests/fixtures/announcements';
import type { AnnouncementFeed } from '../data/announcements';
import { relativeDate } from './Announcements';
import { App } from './App';
import type { AnnouncementsProps } from './contract';
import { spyActions } from './testing/actions';
import { announcementRows, announcementsProps, mkView, readyState } from './testing/mocks';

afterEach(cleanup);

type Ready = Extract<AnnouncementFeed, { status: 'ready' }>;

function setup(
  announcements: AnnouncementsProps | null = announcementsProps(),
  options: { surface?: 'panel' | 'inpage'; scope?: string | null; undo?: boolean } = {},
) {
  const actions = spyActions();
  const state = readyState({
    ...(options.undo === true ? { undo: { kind: 'announcement_read' as const, count: 1 } } : {}),
    ...(options.scope === undefined || options.scope === null
      ? {}
      : { view: mkView({ scopeCourseId: options.scope }) }),
  });
  const view = (props: AnnouncementsProps | undefined) => (
    <App
      surface={options.surface ?? 'panel'}
      state={state}
      actions={actions}
      announcements={props}
    />
  );
  const result = render(view(announcements ?? undefined));
  return {
    actions,
    rerender: (props: AnnouncementsProps | undefined) => result.rerender(view(props)),
  };
}

function feedWith(patch: Partial<Ready>): AnnouncementsProps {
  const base = announcementsProps();
  return { ...base, feed: { ...(base.feed as Ready), ...patch } };
}

describe('the tabs', () => {
  it('shows no tabs without the Announcements tab, as on the widget dashboard', () => {
    setup(null);

    expect(screen.queryByRole('tablist')).toBeNull();
    expect(screen.queryByRole('tab')).toBeNull();
  });

  it('is the ARIA tabs pattern with the unread count in the name of the tab', () => {
    setup(announcementsProps({ tab: 'tasks' }));

    const tabs = screen.getByRole('tablist', { name: 'Weekly list view' });
    const [tasks, announcements] = within(tabs).getAllByRole('tab') as [HTMLElement, HTMLElement];
    expect(tasks.getAttribute('aria-selected')).toBe('true');
    expect(tasks.getAttribute('tabindex')).toBe('0');
    expect(announcements.getAttribute('aria-selected')).toBe('false');
    expect(announcements.getAttribute('tabindex')).toBe('-1');
    expect(announcements?.getAttribute('aria-label')).toBe('Announcements, 4 unread');
    expect(announcements.textContent).toContain('4');
    const panel = screen.getByRole('tabpanel');
    expect(panel.getAttribute('aria-labelledby')).toBe(tasks?.id);
    expect(tasks.getAttribute('aria-controls')).toBe(panel.id);
  });

  it('shows no count for no unread announcement, and 99+ for many', () => {
    const { rerender } = setup(feedWith({ rows: [], unread: 0 }));
    expect(screen.getByRole('tab', { name: 'Announcements' }).textContent).toMatch(
      /^Announcements$/,
    );

    rerender(feedWith({ unread: 150 }));
    expect(screen.getByRole('tab', { name: 'Announcements, 150 unread' }).textContent).toContain(
      '99+',
    );
  });

  it('chooses a tab on click and with the arrow keys, Home and End', () => {
    const { actions } = setup(announcementsProps({ tab: 'tasks' }));

    fireEvent.click(screen.getByRole('tab', { name: /^Announcements/ }));
    expect(actions.setListTab).toHaveBeenLastCalledWith('announcements');

    const tasks = screen.getByRole('tab', { name: 'Tasks' });
    fireEvent.keyDown(tasks, { key: 'ArrowRight' });
    expect(actions.setListTab).toHaveBeenLastCalledWith('announcements');
    fireEvent.keyDown(tasks, { key: 'ArrowLeft' });
    expect(actions.setListTab).toHaveBeenLastCalledWith('announcements');
    fireEvent.keyDown(tasks, { key: 'End' });
    expect(actions.setListTab).toHaveBeenLastCalledWith('announcements');
    fireEvent.keyDown(tasks, { key: 'Home' });
    expect(actions.setListTab).toHaveBeenLastCalledWith('tasks');
    actions.setListTab.mockClear();
    fireEvent.keyDown(tasks, { key: 'a' });
    expect(actions.setListTab).not.toHaveBeenCalled();
  });

  it('shows the task list under the Tasks tab and the announcements under the other', () => {
    const { rerender } = setup(announcementsProps({ tab: 'tasks' }));
    expect(screen.queryByText('Lab room change for Thursday')).toBeNull();
    expect(screen.getByText('Past due')).toBeTruthy();

    rerender(announcementsProps());
    expect(screen.getByText('Lab room change for Thursday')).toBeTruthy();
    expect(screen.queryByText('Past due')).toBeNull();
  });

  it('names the scroll region of the in-page list after the tab', () => {
    const { rerender } = setup(announcementsProps({ tab: 'tasks' }), { surface: 'inpage' });
    expect(screen.getByRole('region', { name: 'Tasks by day' })).toBeTruthy();

    rerender(announcementsProps());
    expect(screen.getByRole('region', { name: 'Announcements' })).toBeTruthy();
    expect(screen.queryByRole('region', { name: 'Tasks by day' })).toBeNull();
  });
});

describe('the rows', () => {
  it('shows the unread announcements with the course, title, author, date and a snippet', () => {
    setup();

    const items = screen.getAllByRole('listitem').filter((el) => el.querySelector('.wr-ann-title'));
    expect(items.map((el) => el.querySelector('.wr-ann-title')?.textContent)).toEqual([
      'Lab room change for Thursday',
      'Office hours move to Thursday this week',
      'Safety goggles are required',
      'A very long announcement title that has to wrap onto several lines in a narrow list',
    ]);
    const first = items[0] as HTMLElement;
    expect(first.textContent).toContain('BIO 201');
    expect(first.textContent).toContain('Dr. Maya Okafor');
    expect(first.textContent).toContain('Today');
    expect(first.querySelector('.wr-ann-snippet')?.textContent).toBe(
      'The lab section moves to Science Hall 214 on Thursday. Read the lab safety page first.',
    );
    expect(first.classList.contains('is-unread')).toBe(true);
    expect(first.querySelector('.wr-sr')?.textContent).toContain('Unread');
    expect(first.style.getPropertyValue('--wr-course')).toBe('#1770AB');
    // No author line for a post with no author, and no snippet for an empty message.
    expect(items[3]?.querySelector('.wr-ann-author')).toBeNull();
    expect(items[3]?.querySelector('.wr-ann-snippet')).toBeNull();
  });

  it('leaves out the course name in a view of one course', () => {
    setup(announcementsProps(), { scope: '101' });

    expect(document.querySelector('.wr-ann-course')).toBeNull();
  });

  it('shows the read announcements only with Show read, and they have no control', () => {
    const { actions, rerender } = setup();
    expect(screen.queryByText('Syllabus quiz reminder')).toBeNull();
    const toggle = screen.getByRole('switch', { name: 'Show read' });
    expect((toggle as HTMLInputElement).checked).toBe(false);

    fireEvent.click(toggle);
    expect(actions.setShowRead).toHaveBeenCalledWith(true);

    rerender(announcementsProps({ showRead: true }));
    const read = screen.getByText('Syllabus quiz reminder').closest('li') as HTMLElement;
    expect(read.classList.contains('is-unread')).toBe(false);
    expect(within(read).queryByRole('button', { name: /Mark as read/ })).toBeNull();
    expect((screen.getByRole('switch', { name: 'Show read' }) as HTMLInputElement).checked).toBe(
      true,
    );
  });

  it('marks as read with one call, from the control only', () => {
    const { actions } = setup();

    const button = screen.getByRole('button', {
      name: 'Mark as read: Safety goggles are required',
    });
    expect(button.textContent).toContain('Mark as read');
    fireEvent.click(button);

    expect(actions.markAnnouncementRead).toHaveBeenCalledTimes(1);
    expect(actions.markAnnouncementRead).toHaveBeenCalledWith('102', '34901');
  });

  it('opens a message in place without any read mark, and closes it again', async () => {
    const { actions } = setup();
    vi.mocked(actions.loadAnnouncementMessage).mockResolvedValue(
      '<p>The <b>whole</b> message.</p>',
    );
    const title = screen.getByRole('button', { name: 'Lab room change for Thursday' });
    expect(title.getAttribute('aria-expanded')).toBe('false');

    fireEvent.click(title);
    expect(title.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByText('Loading the message')).toBeTruthy();
    await waitFor(() => expect(document.querySelector('.wr-ann-body')).not.toBeNull());

    expect(document.querySelector('.wr-ann-body')?.textContent).toContain('The whole message.');
    expect(actions.loadAnnouncementMessage).toHaveBeenCalledWith('101', '31901');
    // The open row shows the message in place of its snippet, and the other rows keep theirs.
    expect(title.closest('li')?.querySelector('.wr-ann-snippet')).toBeNull();
    expect(document.querySelectorAll('.wr-ann-snippet')).toHaveLength(2);
    expect(actions.markAnnouncementRead).not.toHaveBeenCalled();
    expect(
      screen.getByText(/Canvas marks the announcement as read when you open it there/),
    ).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Show less' }));
    expect(title.getAttribute('aria-expanded')).toBe('false');
    expect(document.querySelector('.wr-ann-body')).toBeNull();
    expect(actions.markAnnouncementRead).not.toHaveBeenCalled();
  });

  it('opens the page in Canvas from an open row', async () => {
    const { actions } = setup();
    vi.mocked(actions.loadAnnouncementMessage).mockResolvedValue('<p>x</p>');
    fireEvent.click(screen.getByRole('button', { name: 'Lab room change for Thursday' }));
    await waitFor(() => expect(document.querySelector('.wr-ann-body')).not.toBeNull());

    fireEvent.click(screen.getByRole('button', { name: 'Open in Canvas' }));

    expect(actions.openAnnouncement).toHaveBeenCalledWith('101', '31901');
    expect(actions.markAnnouncementRead).not.toHaveBeenCalled();
  });

  it('sanitizes the open message: no script, handler, frame, form, svg or unsafe link', async () => {
    const { actions } = setup();
    vi.mocked(actions.loadAnnouncementMessage).mockResolvedValue(HOSTILE_MESSAGE);

    fireEvent.click(screen.getByRole('button', { name: 'Lab room change for Thursday' }));
    await waitFor(() => expect(document.querySelector('.wr-ann-body')).not.toBeNull());

    const body = document.querySelector('.wr-ann-body') as HTMLElement;
    expect(body.textContent).toContain('Science Hall 214');
    expect(body.querySelector('script, iframe, form, input, svg, style')).toBeNull();
    expect(body.querySelector('[onerror], [onclick], [style]')).toBeNull();
    const links = [...body.querySelectorAll('a')].map((a) => a.getAttribute('href'));
    expect(links).toEqual([
      'https://school.instructure.com/courses/101/pages/lab-safety',
      'https://example.org/map',
    ]);
    expect(body.querySelector('a[target="_blank"][rel="noopener noreferrer"]')).not.toBeNull();
  });

  it('shows a note when the message does not load', async () => {
    const { actions } = setup();
    vi.mocked(actions.loadAnnouncementMessage).mockResolvedValue(null);

    fireEvent.click(screen.getByRole('button', { name: 'Lab room change for Thursday' }));

    expect(await screen.findByText("Couldn't load the message.")).toBeTruthy();
    expect(actions.markAnnouncementRead).not.toHaveBeenCalled();
  });

  it('drops the reply of a message that the student closed before it came', async () => {
    const { actions } = setup();
    let resolve: (html: string) => void = () => undefined;
    vi.mocked(actions.loadAnnouncementMessage).mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    const title = screen.getByRole('button', { name: 'Lab room change for Thursday' });
    fireEvent.click(title);
    fireEvent.click(title);

    resolve('<p>late</p>');
    await Promise.resolve();
    await Promise.resolve();

    expect(title.getAttribute('aria-expanded')).toBe('false');
    expect(document.querySelector('.wr-ann-body')).toBeNull();
  });

  it('shows the Undo notice for a read mark', () => {
    const { actions } = setup(announcementsProps(), { undo: true });

    expect(screen.getByText('Marked as read')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(actions.undo).toHaveBeenCalledTimes(1);
  });
});

describe('the states', () => {
  it('shows placeholders while the first load runs, and not the empty text', () => {
    setup(feedWith({ rows: [], unread: 0, loading: true }));

    expect(document.querySelectorAll('.wr-skel-row')).toHaveLength(3);
    expect(screen.queryByText(/No announcements|No unread/)).toBeNull();
    expect(screen.getByRole('switch', { name: 'Show read' })).toBeTruthy();
  });

  it('shows placeholders before the first reply', () => {
    setup({ tab: 'announcements', feed: null, showRead: false });

    expect(document.querySelectorAll('.wr-skel-row')).toHaveLength(3);
  });

  it('keeps the rows on screen while a later load runs', () => {
    setup(feedWith({ loading: true }));

    expect(document.querySelectorAll('.wr-skel-row')).toHaveLength(0);
    expect(screen.getByText('Lab room change for Thursday')).toBeTruthy();
  });

  it('says that nothing came in 14 days, and that nothing is unread', () => {
    const { rerender } = setup(feedWith({ rows: [], unread: 0 }));
    expect(screen.getByText('No announcements in the last 14 days.')).toBeTruthy();

    rerender(feedWith({ rows: announcementRows().filter((row) => row.read), unread: 0 }));
    expect(screen.getByText('No unread announcements in the last 14 days.')).toBeTruthy();
  });

  it('shows the error with Retry, and Retry asks for the list again', () => {
    const { actions } = setup(feedWith({ rows: [], unread: 0, failed: true }));

    expect(screen.getByText("Couldn't load your announcements")).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(actions.retryAnnouncements).toHaveBeenCalledTimes(1);
  });

  it('shows the placeholders when the feed is unavailable', () => {
    setup({
      tab: 'announcements',
      feed: { status: 'unavailable', tab: 'announcements' },
      showRead: false,
    });

    expect(document.querySelectorAll('.wr-skel-row')).toHaveLength(3);
  });
});

describe('relativeDate', () => {
  const view = { today: '2026-10-27', timeZone: 'America/New_York' };

  it.each([
    ['2026-10-27T16:00:00Z', 'Today'],
    ['2026-10-28T02:00:00Z', 'Today'],
    ['2026-10-27T03:00:00Z', 'Yesterday'],
    ['2026-10-26T15:00:00Z', 'Yesterday'],
    ['2026-10-24T15:00:00Z', '3 days ago'],
    ['2026-10-13T15:00:00Z', '14 days ago'],
    ['2026-10-12T15:00:00Z', 'Oct 12'],
    ['2026-10-28T15:00:00Z', 'Today'],
  ])('%s is %s', (postedAt, text) => {
    expect(relativeDate(postedAt, view)).toBe(text);
  });
});
