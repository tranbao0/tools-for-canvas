// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ASSIGNMENT_DETAILS } from '../../../../tests/fixtures/assignment-view';
import { SESSION_PATH, frameRows } from '../../../../tests/fixtures/submission-frame';
import { submissionDetailsPage } from '../../../../tests/fixtures/submission-page';
import type { AssignmentDetailsMessage } from '../protocol';
import type { FeedbackRequest } from './feedbackPane';
import { createSubmissionView, type SubmissionView } from './submission';

const ORIGIN = 'https://school.instructure.com';
const PAGE = '/courses/12/assignments/101/submissions/42';

type Details = typeof ASSIGNMENT_DETAILS;

function reply(change: (details: Details) => void = () => undefined) {
  const details = structuredClone(ASSIGNMENT_DETAILS);
  details.assignment.description =
    '<p>Choose one industry.</p><ul><li>Cite four sources.</li></ul>';
  details.submission.submission_type = 'online_upload';
  details.submission.attachments = [{ id: '501', display_name: 'essay.pdf', size: 120_832 }];
  change(details);
  return { details, timeZone: 'America/New_York' };
}

/** Gives the frame of the page the document that Canvas serves in it. */
function showInFrame(html: string, href = `${ORIGIN}${PAGE}?preview=1&rand=1`): HTMLIFrameElement {
  const frame = document.querySelector<HTMLIFrameElement>('#preview_frame')!;
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  Object.defineProperty(doc, 'readyState', { value: 'complete', configurable: true });
  Object.defineProperty(frame, 'contentDocument', { value: doc, configurable: true });
  Object.defineProperty(frame, 'contentWindow', {
    value: { location: { href } },
    configurable: true,
  });
  return frame;
}

const FILE_ROW = frameRows(PAGE, [
  { fileId: '501', name: 'essay.pdf', size: '118 KB', button: 'View Feedback', unread: true },
]);

let send: ReturnType<typeof vi.fn<(message: AssignmentDetailsMessage) => Promise<unknown>>>;
let view: SubmissionView;
let openFeedback: ReturnType<typeof vi.fn<(request: FeedbackRequest) => void>>;
let closeFeedback: ReturnType<typeof vi.fn<() => void>>;

function load(html = submissionDetailsPage()): void {
  // The test gives the frame its document itself, so the frame loads no address.
  document.body.innerHTML = /<body>([\s\S]*)<\/body>/
    .exec(html)![1]!
    .replace(/(<iframe id="preview_frame") src="[^"]*"/, '$1');
}

function start(user = '42', assignment = '101'): SubmissionView {
  view = createSubmissionView({
    doc: document,
    origin: ORIGIN,
    pathname: `/courses/12/assignments/${assignment}/submissions/${user}`,
    courseId: '12',
    assignmentId: assignment,
    userId: user,
    send,
    theme: () => 'light',
    openFeedback,
    closeFeedback,
  });
  view.setActive(true);
  return view;
}

const settle = () => vi.advanceTimersByTimeAsync(10);
const host = () => document.getElementById('av-submission-details');
const root = () => host()?.shadowRoot;
const container = () => document.querySelector('.submission-details-container')!;

beforeEach(() => {
  vi.useFakeTimers();
  // happy-dom writes a line to stderr for each iframe that it does not load. The view needs no load.
  const write = process.stderr.write.bind(process.stderr) as (chunk: unknown) => boolean;
  vi.spyOn(process.stderr, 'write').mockImplementation((chunk: unknown) =>
    String(chunk).includes('Iframe page loading is disabled') ? true : write(chunk),
  );
  document.head.innerHTML = '';
  load();
  showInFrame(FILE_ROW);
  send = vi.fn(async () => reply());
  openFeedback = vi.fn();
  closeFeedback = vi.fn();
});
afterEach(() => {
  view.stop();
  vi.useRealTimers();
});

describe('the own submission', () => {
  it('hides the files frame and shows the instructions and the files beside the comments', async () => {
    start();
    await settle();
    expect(send).toHaveBeenCalledWith({
      type: 'assignment:details',
      courseId: '12',
      assignmentId: '101',
    });
    const children = [...container().children];
    expect(children.map((child) => child.className || child.id)).toEqual([
      'submission-details-frame',
      'av-submission-details',
      'submission-details-comments',
    ]);
    expect(document.head.textContent).toContain(
      '.submission-details-container>.submission-details-frame{display:none!important}',
    );
    expect(root()?.querySelector('.av-instructions')?.textContent).toContain(
      'Choose one industry.',
    );
    expect(root()?.querySelector('.av-instructions h3')?.textContent).toBe('Instructions');
    expect(root()?.querySelector('.av-files h3')?.textContent).toBe('Your files');
    const link = root()!.querySelector<HTMLAnchorElement>('.av-file')!;
    expect(link.textContent).toBe('essay.pdf');
    expect(link.getAttribute('href')).toBe(`${ORIGIN}${PAGE}?download=501`);
    expect(root()?.querySelector('.av-size')?.textContent).toBe('118 KB');
    const button = root()!.querySelector<HTMLButtonElement>('[data-action=feedback]')!;
    expect(button.firstChild?.textContent).toBe('View Feedback');
    expect(button.querySelector('.av-unread')).not.toBeNull();
    expect(host()?.hasAttribute('data-weekrow-panel')).toBe(true);
  });

  it('leaves every Canvas node as it was, and gives the page back when turned off', async () => {
    const before = container().outerHTML;
    const header = document.querySelector('.submission-details-header')!.outerHTML;
    const action = document.querySelector('.ic-Action-header')!.outerHTML;
    start();
    await settle();
    expect(container().outerHTML).not.toBe(before);
    expect(document.querySelector('.submission-details-header')!.outerHTML).toBe(header);
    expect(document.querySelector('.ic-Action-header')!.outerHTML).toBe(action);
    view.setActive(false);
    expect(container().outerHTML).toBe(before);
    expect(document.querySelector('[data-av-own]')).toBeNull();
    expect(closeFeedback).toHaveBeenCalled();
  });

  it('never opens the feedback for a click that a page script made', async () => {
    start();
    await settle();
    root()!.querySelector<HTMLButtonElement>('[data-action=feedback]')!.click();
    expect(openFeedback).not.toHaveBeenCalled();
  });

  it('opens the feedback with the checked session address for a trusted click', async () => {
    start();
    await settle();
    const button = root()!.querySelector<HTMLButtonElement>('[data-action=feedback]')!;
    // A page script cannot make a trusted event, so the test hands the handler one.
    const event = new MouseEvent('click', { bubbles: true, composed: true });
    Object.defineProperty(event, 'isTrusted', { value: true });
    button.dispatchEvent(event);
    expect(openFeedback).toHaveBeenCalledWith({
      title: 'essay.pdf',
      url: `${ORIGIN}${SESSION_PATH}`,
    });
    // The unread dot goes, as it does in Canvas after a click.
    expect(button.querySelector('.av-unread')).toBeNull();
    expect(button.hasAttribute('title')).toBe(false);
  });

  it('keeps the session address out of the page', async () => {
    start();
    await settle();
    expect(document.documentElement.outerHTML).not.toContain('canvadoc_session');
    expect(root()?.innerHTML).not.toContain('canvadoc_session');
    expect(root()?.innerHTML).not.toContain('hmac');
  });

  it('shows the files of the details with no feedback when the frame cannot be read', async () => {
    Object.defineProperty(document.querySelector('#preview_frame'), 'contentDocument', {
      get() {
        throw new Error('blocked');
      },
      configurable: true,
    });
    start();
    await settle();
    expect(root()?.querySelector('.av-file')?.textContent).toBe('essay.pdf');
    expect(root()?.querySelector('.av-size')?.textContent).toBe('118 KB');
    expect(root()?.querySelector('[data-action=feedback]')).toBeNull();
  });

  it('reads the rows again when the frame loads', async () => {
    document.querySelector('#preview_frame')!.remove();
    load();
    const frame = document.querySelector<HTMLIFrameElement>('#preview_frame')!;
    Object.defineProperty(frame, 'contentDocument', { value: null, configurable: true });
    start();
    await settle();
    expect(root()?.querySelector('[data-action=feedback]')).toBeNull();
    showInFrame(FILE_ROW);
    frame.dispatchEvent(new Event('load'));
    expect(root()?.querySelector('[data-action=feedback]')).not.toBeNull();
  });

  it('shows no "Your files" heading for a submission with no file', async () => {
    send.mockResolvedValue(
      reply((details) => {
        details.submission.submission_type = null;
        details.submission.attachments = [];
      }),
    );
    showInFrame('<div style="font-weight:bold">No Submission</div>');
    start();
    await settle();
    expect(root()?.querySelector('.av-instructions')).not.toBeNull();
    expect(root()?.querySelector('.av-files')).toBeNull();
    expect(root()?.textContent).not.toContain('Your files');
  });

  it('shows the text of a text entry as "Your submission", sanitized', async () => {
    send.mockResolvedValue(
      reply((details) => {
        details.submission.submission_type = 'online_text_entry';
        details.submission.body =
          '<p>My <b>essay</b></p><script>window.x=1</script><img src=x onerror=alert(1)>';
        details.submission.attachments = [];
      }),
    );
    start();
    await settle();
    const section = root()!.querySelector('.av-submission')!;
    expect(section.querySelector('h3')?.textContent).toBe('Your submission');
    expect(section.textContent).toContain('My essay');
    expect(section.querySelector('script, [onerror]')).toBeNull();
    expect(root()?.querySelector('.av-files')).toBeNull();
  });

  it('shows the address of a URL submission as a safe link, and plain text for another scheme', async () => {
    send.mockResolvedValue(
      reply((details) => {
        details.submission.submission_type = 'online_url';
        details.submission.url = 'https://example.com/work';
        details.submission.attachments = [];
      }),
    );
    start();
    await settle();
    const link = root()!.querySelector<HTMLAnchorElement>('.av-submission a')!;
    expect(link.getAttribute('href')).toBe('https://example.com/work');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
    expect(link.getAttribute('target')).toBe('_blank');
    view.setActive(false);
    send.mockResolvedValue(
      reply((details) => {
        details.submission.submission_type = 'online_url';
        details.submission.url = 'javascript:alert(1)';
        details.submission.attachments = [];
      }),
    );
    view.setActive(true);
    await settle();
    expect(root()?.querySelector('.av-submission a')).toBeNull();
    expect(root()?.querySelector('.av-submission')?.textContent).toContain('javascript:alert(1)');
  });

  it('draws a hostile description as inert content', async () => {
    send.mockResolvedValue(
      reply((details) => {
        details.assignment.description =
          '<img src=x onerror="alert(1)"><script>alert(2)</script><a href="javascript:alert(3)">x</a><iframe src="https://evil.example"></iframe><p>ok</p>';
      }),
    );
    start();
    await settle();
    expect(root()?.querySelector('script, iframe, [onerror], [href^="javascript"]')).toBeNull();
    expect(root()?.querySelector('.av-instructions')?.textContent).toContain('ok');
  });
});

describe('every page that is not the own submission', () => {
  const untouched = async (): Promise<void> => {
    await settle();
    expect(host()).toBeNull();
    expect(document.querySelector('[data-av-own]')).toBeNull();
    expect(document.head.querySelector('style')).toBeNull();
  };

  it('leaves the page of a teacher or another student as it is', async () => {
    send.mockResolvedValue(
      reply((details) => {
        details.submission.user_id = '9001';
      }),
    );
    start();
    await untouched();
  });

  it('compares ids with the shard rules', async () => {
    send.mockResolvedValue(
      reply((details) => {
        details.submission.user_id = '20000000000042';
      }),
    );
    start('2~42');
    await settle();
    expect(host()).not.toBeNull();
  });

  it('leaves the page as it is when the background refuses', async () => {
    send.mockResolvedValue({ kind: 'no_submission_access' });
    start();
    await untouched();
  });

  it('leaves the page as it is when the read fails or answers for another assignment', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    send.mockRejectedValue(new Error('down'));
    start();
    await untouched();
    view.stop();
    send.mockResolvedValue(
      reply((details) => {
        details.assignment.id = '999';
      }),
    );
    start();
    await untouched();
  });

  it('leaves the page as it is when an anchor is missing, and asks for nothing', async () => {
    document.querySelector('.submission-details-comments')!.remove();
    start();
    await untouched();
    expect(send).not.toHaveBeenCalled();
  });

  it('does not hide the frame while the read runs', async () => {
    let answer!: (value: unknown) => void;
    send.mockImplementation(() => new Promise((resolve) => (answer = resolve)));
    start();
    await settle();
    expect(document.head.querySelector('style')).toBeNull();
    answer(reply());
    await settle();
    expect(document.head.querySelector('style')).not.toBeNull();
  });

  it('ignores an answer that arrives after the view was turned off', async () => {
    let answer!: (value: unknown) => void;
    send.mockImplementation(() => new Promise((resolve) => (answer = resolve)));
    start();
    view.setActive(false);
    answer(reply());
    await settle();
    expect(host()).toBeNull();
  });
});

describe('a submission type that the view cannot show in full', () => {
  it.each([
    'media_recording',
    'online_quiz',
    'basic_lti_launch',
    'student_annotation',
    'discussion_topic',
  ])(
    'keeps the frame of Canvas and adds only the instructions above it, for type %s',
    async (type) => {
      send.mockResolvedValue(
        reply((details) => {
          details.submission.submission_type = type;
        }),
      );
      const frameBox = document.querySelector('.submission-details-frame')!;
      const frameBefore = frameBox.outerHTML;
      const commentsBefore = document.querySelector('.submission-details-comments')!.outerHTML;
      const contentBefore = document.getElementById('content')?.outerHTML;
      start();
      await settle();
      // The host sits right before the content area, so it is above the frame.
      expect(host()?.nextElementSibling).toBe(container());
      expect(document.head.querySelector('style')).toBeNull();
      expect(frameBox.outerHTML).toBe(frameBefore);
      expect(document.querySelector('.submission-details-comments')!.outerHTML).toBe(
        commentsBefore,
      );
      expect(root()?.querySelector('.av-instructions h3')?.textContent).toBe('Instructions');
      expect(root()?.querySelector('.av-instructions')?.textContent).toContain(
        'Choose one industry.',
      );
      expect(root()?.querySelector('.av-files, .av-submission, [data-action=feedback]')).toBeNull();
      view.setActive(false);
      expect(host()).toBeNull();
      expect(document.getElementById('content')?.outerHTML).toBe(contentBefore);
    },
  );

  it('keeps the same rule for the "Show more" fold', async () => {
    send.mockResolvedValue(
      reply((details) => {
        details.submission.submission_type = 'media_recording';
      }),
    );
    start();
    await settle();
    expect(
      root()?.querySelector('.av-instructions .av-body')?.hasAttribute('data-av-clamped'),
    ).toBe(true);
  });
});

describe('a change of student', () => {
  it('starts over and reads again after the reset', async () => {
    start();
    await settle();
    view.resetStudent();
    expect(host()).toBeNull();
    send.mockResolvedValue(
      reply((details) => {
        details.submission.user_id = '9001';
      }),
    );
    view.setActive(true);
    await settle();
    expect(host()).toBeNull();
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('follows the theme', async () => {
    start();
    await settle();
    expect(host()?.getAttribute('data-theme')).toBe('light');
  });
});
