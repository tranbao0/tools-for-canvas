/**
 * The announcements of the scenario, as `GET /api/v1/courses/:id/discussion_topics/:id` and
 * `GET /api/v1/announcements` return them. The first one carries markup that a hostile or careless
 * teacher could post: the sanitizer must keep its text and links and drop the rest.
 */
import type { AnnouncementTopic } from '../../src/shared/canvas/types';

export interface AnnouncementFixture extends AnnouncementTopic {
  courseId: string;
  /** Whether the student has read it when the scenario starts. */
  read: boolean;
}

/** HTML with every kind of trouble the sanitizer must handle, around some good content. */
export const HOSTILE_MESSAGE = [
  '<h1>Dear Class,</h1>',
  '<h2>Lab details</h2>',
  '<p>The lab section moves to <strong>Science Hall 214</strong> on Thursday.</p>',
  '<p>Read the <a href="/courses/101/pages/lab-safety">lab safety page</a> and the ',
  '<a href="https://example.org/map">building map</a> first.</p>',
  '<ul><li>Bring your goggles</li><li>Bring your notebook</li></ul>',
  '<table border="1" cellspacing="0" cellpadding="4"><tr><th>Group</th><th>Room</th></tr><tr><td>A</td><td>214</td></tr></table>',
  '<script>window.__pwned = 1;</script>',
  '<img src="https://example.org/missing.png" onerror="window.__pwned = 2" alt="logo">',
  '<p onclick="window.__pwned = 3" style="position:fixed;top:0;left:0;width:9999px;height:9999px">',
  'Click for the <a href="javascript:window.__pwned = 4">party</a> or the ',
  '<a href="data:text/html,<script>window.__pwned=5</script>">other party</a>.</p>',
  '<iframe src="https://example.org/frame"></iframe>',
  '<form action="https://example.org/steal"><input name="password"><button>Send</button></form>',
  '<svg onload="window.__pwned = 6"><a xlink:href="javascript:window.__pwned = 7"><text>x</text></a></svg>',
].join('');

export const ANNOUNCEMENTS: readonly AnnouncementFixture[] = [
  {
    id: '31901',
    courseId: '101',
    title: 'Lab room change for Thursday',
    message: HOSTILE_MESSAGE,
    posted_at: '2026-10-27T16:00:00Z',
    read: false,
    user_name: 'Dr. Maya Okafor',
  },
  {
    id: '31002',
    courseId: '101',
    title: 'Syllabus quiz reminder',
    message: '<p>The syllabus quiz closes on Friday.</p>',
    posted_at: '2026-10-20T14:00:00Z',
    read: true,
    user_name: 'Dr. Maya Okafor',
  },
  {
    id: '31003',
    courseId: '101',
    title: 'Welcome to BIO 110',
    message: '<p>Welcome. The first lab starts in week two.</p>',
    posted_at: '2026-09-02T14:00:00Z',
    read: false,
    user_name: 'Dr. Maya Okafor',
  },
  {
    id: '32901',
    courseId: '102',
    title: 'Office hours move to Thursday this week',
    message: '<p>Office hours move to <em>Thursday</em>, 3pm to 4pm.</p>',
    posted_at: '2026-10-27T15:00:00Z',
    read: false,
    user_name: 'Prof. Ines Duarte',
  },
  {
    id: '34901',
    courseId: '104',
    title: 'Safety goggles are required',
    message: '<p>Everyone needs splash goggles for Lab 7.</p>',
    posted_at: '2026-10-26T15:00:00Z',
    read: false,
    user_name: 'Sam Whitaker',
  },
];

/**
 * Older announcements, posted before the 14 days that the Announcements tab shows (the scenario
 * clock is 2026-10-27), so the tab keeps its rows. The widget of the dashboard lists them all: 30
 * more rows for the infinite list, and two about a lockdown browser for the search.
 */
const FILLER_COURSES = ['101', '102', '104'] as const;
const FILLER_AUTHORS = ['Dr. Maya Okafor', 'Prof. Ines Duarte', 'Sam Whitaker'] as const;

export const OLDER_ANNOUNCEMENTS: readonly AnnouncementFixture[] = [
  {
    id: '36001',
    courseId: '101',
    title: 'Install the Lockdown Browser',
    message: '<p>Please install the Lockdown Browser before the first exam.</p>',
    posted_at: '2026-10-10T14:00:00Z',
    read: true,
    user_name: 'Dr. Maya Okafor',
  },
  {
    id: '36002',
    courseId: '102',
    title: 'Quiz 3 rules',
    message:
      '<p>The quiz runs inside the lockdown browser. Bring a charged laptop and your student card.</p>',
    posted_at: '2026-10-08T14:00:00Z',
    read: false,
    user_name: 'Prof. Ines Duarte',
  },
  ...Array.from({ length: 30 }, (_unused, index): AnnouncementFixture => {
    const number = index + 1;
    const posted = new Date(Date.UTC(2026, 9, 12, 14, 0, 0) - index * 24 * 60 * 60 * 1000);
    return {
      id: String(40000 + number),
      courseId: FILLER_COURSES[index % 3] ?? '101',
      title: `Weekly note ${number}`,
      message: `<p>Note number ${number} of the term. Read the chapter and bring your questions.</p>`,
      posted_at: posted.toISOString(),
      read: number % 3 === 0,
      user_name: FILLER_AUTHORS[index % 3] ?? null,
    };
  }),
];

/** Every announcement that Canvas holds for the student. */
export const ALL_ANNOUNCEMENTS: readonly AnnouncementFixture[] = [
  ...ANNOUNCEMENTS,
  ...OLDER_ANNOUNCEMENTS,
];
