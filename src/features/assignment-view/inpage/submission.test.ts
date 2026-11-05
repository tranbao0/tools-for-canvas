// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ASSIGNMENT_DETAILS } from '../../../../tests/fixtures/assignment-view';
import {
  SESSION_PATH,
  TURNITIN_SCORE,
  turnitinScores,
  frameRows,
} from '../../../../tests/fixtures/submission-frame';
import { submissionDetailsPage } from '../../../../tests/fixtures/submission-page';
import type { AssignmentDetailsMessage, RubricReadMessage } from '../protocol';
import type { FeedbackRequest } from './feedbackPane';
import { removeStaleView } from './rows';
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
function showInFrame(
  html: string,
  href = `${ORIGIN}${PAGE}?preview=1&rand=1`,
  readyState = 'complete',
): HTMLIFrameElement {
  const frame = document.querySelector<HTMLIFrameElement>('#preview_frame')!;
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  Object.defineProperty(doc, 'readyState', { value: readyState, configurable: true });
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

let send: ReturnType<
  typeof vi.fn<(message: AssignmentDetailsMessage | RubricReadMessage) => Promise<unknown>>
>;
let view: SubmissionView;
let openFeedback: ReturnType<typeof vi.fn<(request: FeedbackRequest) => void>>;
let closeFeedback: ReturnType<typeof vi.fn<() => void>>;

function load(html = submissionDetailsPage()): void {
  // The test gives the frame its document itself, so the frame loads no address.
  document.body.innerHTML = /<body[^>]*>([\s\S]*)<\/body>/
    .exec(html)![1]!
    .replace(/(<iframe id="preview_frame") src="[^"]*"/, '$1');
}

function start(user = '42', assignment = '101', course = '12'): SubmissionView {
  view = createSubmissionView({
    doc: document,
    origin: ORIGIN,
    pathname: `/courses/${course}/assignments/${assignment}/submissions/${user}`,
    courseId: course,
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
const boxHost = () => document.getElementById('av-submission-box');
const boxRoot = () => boxHost()?.shadowRoot;
const container = () => document.querySelector('.submission-details-container')!;
const CANVAS_BUTTON = '.ic-Action-header__Secondary>a[href$="#submit"]';
const ownLinks = () => [...document.querySelectorAll('a[data-av-own]')];
/** The rules of the view's style element in the head. */
const rules = () => document.head.querySelector('style[data-av-own]')?.textContent ?? '';
const HIDE_RULE =
  '.ic-Action-header__Secondary>a.Button--primary[href$="#submit"]{display:none!important}';

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
  it('hides the files frame, shows the instructions in the content area and the box in the right column', async () => {
    start();
    await settle();
    expect(send).toHaveBeenCalledWith({
      type: 'assignment:details',
      courseId: '12',
      assignmentId: '101',
    });
    // The comments column moved to the box and left a mark, so the container holds the frame and
    // the host of the instructions.
    const children = [...container().children];
    expect(children.map((child) => child.className || child.id)).toEqual([
      'submission-details-frame',
      'av-submission-details',
    ]);
    expect(document.head.textContent).toContain(
      '.submission-details-container>.submission-details-frame{display:none!important}',
    );
    expect(root()?.querySelector('.av-instructions')?.textContent).toContain(
      'Choose one industry.',
    );
    expect(root()?.querySelector('.av-instructions h3')?.textContent).toBe('Instructions');
    expect(root()?.querySelector('.av-sub')?.getAttribute('aria-label')).toBe('Instructions');
    expect(root()?.querySelector('.av-files, .av-file, .av-feedback')).toBeNull();
    expect(host()?.hasAttribute('data-weekrow-panel')).toBe(true);
    // The box is in the right column, a region named "Submission".
    expect(boxHost()?.parentElement?.id).toBe('right-side');
    expect(boxHost()?.hasAttribute('data-av-own')).toBe(true);
    expect(boxHost()?.hasAttribute('data-weekrow-panel')).toBe(true);
    expect(boxRoot()?.querySelector('[role=region]')?.getAttribute('aria-label')).toBe(
      'Submission',
    );
    expect(boxRoot()?.querySelector('.av-box-title')?.textContent).toBe('Submission');
    const link = boxRoot()!.querySelector<HTMLAnchorElement>('.av-file')!;
    expect(link.textContent).toBe('View essay.pdf');
    expect(link.getAttribute('href')).toBe(`${ORIGIN}${PAGE}?download=501`);
    expect(boxRoot()?.querySelector('.av-size')?.textContent).toBe('118 KB');
    const button = boxRoot()!.querySelector<HTMLButtonElement>('[data-action=feedback]')!;
    expect(button.firstChild?.textContent).toBe('View Feedback');
    expect(button.querySelector('.av-unread')).not.toBeNull();
    expect(boxRoot()?.querySelector('.av-box-subtitle')?.textContent).toBe('Comments:');
    expect(boxRoot()?.querySelector('slot')).not.toBeNull();
    // The box has no link to this page.
    expect(boxRoot()?.textContent).not.toContain('Submission Details');
  });

  it('leaves every Canvas node as it was, and gives the page back when turned off', async () => {
    const before = container().outerHTML;
    const header = document.querySelector('.submission-details-header')!.outerHTML;
    const action = document.querySelector('.ic-Action-header')!.outerHTML;
    const canvasButton = document.querySelector(CANVAS_BUTTON)!.outerHTML;
    start();
    await settle();
    expect(container().outerHTML).not.toBe(before);
    // The view adds a link beside Canvas's button and changes no node of Canvas.
    expect(document.querySelector(CANVAS_BUTTON)!.outerHTML).toBe(canvasButton);
    view.setActive(false);
    expect(container().outerHTML).toBe(before);
    expect(document.querySelector('.submission-details-header')!.outerHTML).toBe(header);
    expect(document.querySelector('.ic-Action-header')!.outerHTML).toBe(action);
    expect(document.querySelector('[data-av-own]')).toBeNull();
    expect(closeFeedback).toHaveBeenCalled();
  });

  it('never opens the feedback for a click that a page script made', async () => {
    start();
    await settle();
    boxRoot()!.querySelector<HTMLButtonElement>('[data-action=feedback]')!.click();
    expect(openFeedback).not.toHaveBeenCalled();
  });

  it('opens the feedback with the checked session address for a trusted click', async () => {
    start();
    await settle();
    const button = boxRoot()!.querySelector<HTMLButtonElement>('[data-action=feedback]')!;
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

  it('keeps the unread dot off after View Feedback, through the re-reads of the frame', async () => {
    const frame = showInFrame(FILE_ROW);
    start();
    await settle();
    const button = boxRoot()!.querySelector<HTMLButtonElement>('[data-action=feedback]')!;
    const event = new MouseEvent('click', { bubbles: true, composed: true });
    Object.defineProperty(event, 'isTrusted', { value: true });
    button.dispatchEvent(event);
    expect(boxRoot()?.querySelector('.av-unread')).toBeNull();
    // Canvas still marks the file unread in its frame, and the frame loads or changes again.
    frame.dispatchEvent(new Event('load'));
    await vi.advanceTimersByTimeAsync(200);
    const cell = frame.contentDocument!.querySelector('td.file-upload-submission-turnitin')!;
    cell.innerHTML = '';
    await vi.advanceTimersByTimeAsync(200);
    expect(boxRoot()?.querySelector('.av-unread')).toBeNull();
    expect(boxRoot()?.querySelector('[data-action=feedback]')?.hasAttribute('title')).toBe(false);
  });

  it('does not draw the files again when a re-read finds the same files, so the focus stays', async () => {
    const frame = showInFrame(FILE_ROW);
    start();
    await settle();
    const list = boxRoot()!.querySelector('.av-box-files')!;
    const link = boxRoot()!.querySelector<HTMLAnchorElement>('.av-file')!;
    link.focus();
    expect(boxRoot()!.activeElement).toBe(link);
    frame.dispatchEvent(new Event('load'));
    await vi.advanceTimersByTimeAsync(200);
    expect(boxRoot()!.querySelector('.av-box-files')).toBe(list);
    expect(boxRoot()!.querySelector('.av-file')).toBe(link);
    expect(boxRoot()!.activeElement).toBe(link);
  });

  it('draws the files again when they changed', async () => {
    const frame = showInFrame(FILE_ROW);
    start();
    await settle();
    const list = boxRoot()!.querySelector('.av-box-files')!;
    showInFrame(
      frameRows(PAGE, [
        { fileId: '501', name: 'essay.pdf', size: '119 KB', button: 'View Feedback', unread: true },
      ]),
    );
    frame.dispatchEvent(new Event('load'));
    expect(boxRoot()!.querySelector('.av-box-files')).toBe(list);
    expect(boxRoot()!.querySelector('.av-file')).not.toBeNull();
    expect(boxRoot()!.querySelector('.av-size')?.textContent).toBe('119 KB');
  });

  it('keeps the session address out of the page', async () => {
    start();
    await settle();
    expect(document.documentElement.outerHTML).not.toContain('canvadoc_session');
    expect(boxRoot()?.innerHTML).not.toContain('canvadoc_session');
    expect(boxRoot()?.innerHTML).not.toContain('hmac');
  });

  it('shows the files of the details until the frame has loaded, then reads its rows', async () => {
    const frame = showInFrame(FILE_ROW, 'about:blank', 'loading');
    start();
    await settle();
    // The frame is hidden, and the details give the file with no button.
    expect(boxRoot()?.querySelector('.av-file')?.textContent).toBe('View essay.pdf');
    expect(boxRoot()?.querySelector('.av-size')?.textContent).toBe('118 KB');
    expect(boxRoot()?.querySelector('[data-action=feedback]')).toBeNull();
    expect(document.head.querySelector('style')).not.toBeNull();
    showInFrame(FILE_ROW);
    frame.dispatchEvent(new Event('load'));
    expect(boxRoot()?.querySelector('[data-action=feedback]')).not.toBeNull();
    expect(boxRoot()?.querySelector('.av-size')?.textContent).toBe('118 KB');
  });

  it('shows View Feedback for a shard student whose frame writes the ids in full', async () => {
    const long = '/courses/20000000000012/assignments/20000000000101/submissions/20000000000123';
    load(submissionDetailsPage({ course: '2~12', assignment: '2~101', user: '2~123' }));
    showInFrame(
      frameRows(long, [
        { fileId: '501', name: 'essay.pdf', size: '118 KB', button: 'View Feedback' },
      ]),
      `${ORIGIN}${long}?preview=1&rand=1`,
    );
    send.mockResolvedValue(
      reply((details) => {
        details.assignment.id = '20000000000101';
        details.submission.user_id = '20000000000123';
      }),
    );
    start('2~123', '2~101', '2~12');
    await settle();
    expect(boxRoot()?.querySelector('[data-action=feedback]')).not.toBeNull();
    expect(document.head.querySelector('style')).not.toBeNull();
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
    expect(boxRoot()?.querySelector('.av-files')).toBeNull();
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
    expect(boxRoot()?.querySelector('.av-files')).toBeNull();
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

describe('the button of the title row', () => {
  const OWN_ADDRESS = `${ORIGIN}/courses/12/assignments/101`;

  function expectOwnLink(): void {
    const links = ownLinks();
    expect(links).toHaveLength(1);
    const link = links[0] as HTMLAnchorElement;
    expect(link.textContent).toBe('Go to assignment');
    expect(link.className).toBe('Button Button--primary');
    expect(link.getAttribute('href')).toBe(OWN_ADDRESS);
    expect(link.hasAttribute('disabled')).toBe(false);
    // The link sits right after Canvas's button, in Canvas's container.
    expect(link.previousElementSibling).toBe(document.querySelector(CANVAS_BUTTON));
    expect(link.parentElement?.className).toContain('ic-Action-header__Secondary');
    expect(rules()).toContain(HIDE_RULE);
  }

  it('gets an own link in the replace mode, and Canvas keeps its button, hidden by a rule', async () => {
    start();
    await settle();
    expect(container().querySelector('.submission-details-frame')).not.toBeNull();
    expect(rules()).toContain('.submission-details-frame{display:none!important}');
    expectOwnLink();
    expect(document.querySelector(CANVAS_BUTTON)?.textContent).toBe('Re-submit Assignment');
    expect(document.querySelector(CANVAS_BUTTON)?.hasAttribute('data-av-own')).toBe(false);
  });

  it('gets an own link in the above mode, where the frame stays', async () => {
    send.mockResolvedValue(
      reply((details) => {
        details.submission.submission_type = 'media_recording';
      }),
    );
    start();
    await settle();
    expect(rules()).not.toContain('.submission-details-frame{display:none!important}');
    expectOwnLink();
  });

  it('points at the assignment page of a shard student, with the ids as the page writes them', async () => {
    document.body.innerHTML = '';
    load(submissionDetailsPage({ course: '2~12', assignment: '2~101', user: '2~123' }));
    send.mockResolvedValue(
      reply((details) => {
        details.assignment.id = '20000000000101';
        details.submission.user_id = '20000000000123';
        details.submission.submission_type = 'media_recording';
      }),
    );
    start('2~123', '2~101', '2~12');
    await settle();
    const [link] = ownLinks() as HTMLAnchorElement[];
    expect(link?.getAttribute('href')).toBe(`${ORIGIN}/courses/2~12/assignments/2~101`);
  });

  it('gives the page back with no link and no rule when turned off', async () => {
    const before = document.querySelector('.ic-Action-header__Secondary')!.outerHTML;
    start();
    await settle();
    view.setActive(false);
    expect(ownLinks()).toHaveLength(0);
    expect(document.head.querySelector('style')).toBeNull();
    expect(document.querySelector('.ic-Action-header__Secondary')!.outerHTML).toBe(before);
  });

  it('keeps the same own link, with its keyboard focus, when the mode changes', async () => {
    const frame = showInFrame(FILE_ROW);
    start();
    await settle();
    expectOwnLink();
    const link = ownLinks()[0] as HTMLAnchorElement;
    link.focus();
    expect(document.activeElement).toBe(link);
    // A similarity report shows after the load, so the view goes to the above mode.
    showInFrame(
      frameRows(PAGE, [
        {
          fileId: '501',
          name: 'essay.pdf',
          size: '118 KB',
          button: 'Preview',
          report: '<span>Processing</span>',
        },
      ]),
    );
    frame.dispatchEvent(new Event('load'));
    await vi.advanceTimersByTimeAsync(200);
    expect(rules()).not.toContain('.submission-details-frame{display:none!important}');
    expectOwnLink();
    expect(ownLinks()[0]).toBe(link);
    expect(document.activeElement).toBe(link);
    // The link goes back and forth with the mode, and the rule of Canvas's button stays once.
    showInFrame(FILE_ROW);
    frame.dispatchEvent(new Event('load'));
    await vi.advanceTimersByTimeAsync(200);
    expect(rules()).toContain('.submission-details-frame{display:none!important}');
    expect(ownLinks()[0]).toBe(link);
    expect(document.activeElement).toBe(link);
    expect(rules().split(HIDE_RULE)).toHaveLength(2);
  });

  it('leaves a newer copy with one link and one rule after the cleanup of a dead copy', async () => {
    document
      .querySelector('.ic-Action-header__Secondary')!
      .insertAdjacentHTML(
        'beforeend',
        '<a data-av-own href="/courses/12/assignments/101" class="Button Button--primary">Go to assignment</a>',
      );
    document.head.insertAdjacentHTML('beforeend', `<style data-av-own>${HIDE_RULE}</style>`);
    removeStaleView(document, PAGE);
    start();
    await settle();
    expectOwnLink();
    expect(document.head.querySelectorAll('style[data-av-own]')).toHaveLength(1);
    expect(rules().split(HIDE_RULE)).toHaveLength(2);
  });

  it('gives a working link when Canvas disabled its button for no attempts left', async () => {
    load(submissionDetailsPage({ noAttemptsLeft: true }));
    showInFrame(FILE_ROW);
    expect(document.querySelector(CANVAS_BUTTON)?.hasAttribute('disabled')).toBe(true);
    start();
    await settle();
    expectOwnLink();
  });

  it('adds nothing when Canvas draws no such button', async () => {
    load(submissionDetailsPage({ noButton: true }));
    showInFrame(FILE_ROW);
    start();
    await settle();
    expect(host()).not.toBeNull();
    expect(ownLinks()).toHaveLength(0);
    expect(rules()).not.toContain('#submit');
  });

  it('leaves the button of Canvas alone on the page of a teacher or another student', async () => {
    send.mockResolvedValue(
      reply((details) => {
        details.submission.user_id = '9001';
      }),
    );
    start();
    await settle();
    expect(ownLinks()).toHaveLength(0);
    expect(document.head.querySelector('style')).toBeNull();
  });

  it('leaves the button of Canvas alone when the read fails', async () => {
    send.mockRejectedValue(new Error('offline'));
    start();
    await settle();
    expect(ownLinks()).toHaveLength(0);
    expect(document.head.querySelector('style')).toBeNull();
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
      expect(rules()).not.toContain('.submission-details-frame');
      expect(frameBox.outerHTML).toBe(frameBefore);
      expect(document.querySelector('.submission-details-comments')!.outerHTML).toBe(
        commentsBefore,
      );
      expect(root()?.querySelector('.av-instructions h3')?.textContent).toBe('Instructions');
      expect(root()?.querySelector('.av-instructions')?.textContent).toContain(
        'Choose one industry.',
      );
      expect(
        boxRoot()?.querySelector('.av-files, .av-submission, [data-action=feedback]'),
      ).toBeNull();
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

describe('a frame that holds more than the view can show', () => {
  /** The frame stays, and the host holds only the instructions above the content area. */
  async function expectAbove(): Promise<void> {
    await settle();
    expect(host()?.nextElementSibling).toBe(container());
    expect(rules()).not.toContain('.submission-details-frame');
    expect(root()?.querySelector('.av-instructions')).not.toBeNull();
    expect(
      boxRoot()?.querySelector('.av-files, .av-submission, [data-action=feedback]'),
    ).toBeNull();
  }

  it('keeps the frame when a session address has an extra access token', async () => {
    const frameBefore = document.querySelector('.submission-details-frame')!.outerHTML;
    showInFrame(
      frameRows(PAGE, [
        {
          fileId: '501',
          name: 'essay.pdf',
          size: '118 KB',
          button: 'View Feedback',
          session: `${SESSION_PATH}&access_token=t`,
        },
      ]),
    );
    start();
    await expectAbove();
    expect(document.querySelector('.submission-details-frame')!.outerHTML).toBe(frameBefore);
  });

  it('keeps the frame when its file rows do not match the page', async () => {
    showInFrame(
      frameRows('/courses/12/assignments/101/submissions/43', [
        { fileId: '501', name: 'essay.pdf', size: '118 KB', button: 'View Feedback' },
      ]),
    );
    start();
    await expectAbove();
  });

  it('keeps the frame when the markup of the rows changed', async () => {
    showInFrame('<ul class="files"><li><a href="#">essay.pdf</a></li></ul>');
    start();
    await expectAbove();
  });

  it('keeps the frame when a row shows a similarity score with an address that fails the check', async () => {
    showInFrame(
      frameRows(PAGE, [
        {
          fileId: '501',
          name: 'essay.pdf',
          size: '118 KB',
          button: 'View Feedback',
          score: TURNITIN_SCORE.replace(
            /href="[^"]*"/,
            'href="/courses/12/assignments/101/submissions/43/turnitin/a"',
          ),
        },
      ]),
    );
    start();
    await expectAbove();
  });

  it('keeps the frame when the score is in a cell that has no readable content', async () => {
    showInFrame(
      frameRows(PAGE, [
        {
          fileId: '501',
          name: 'essay.pdf',
          size: '118 KB',
          button: 'View Feedback',
          score: '<span class="turnitin_score_container tooltip"><i class="icon-clock"></i></span>',
        },
      ]),
    );
    start();
    await expectAbove();
  });

  it('keeps the frame when the report of a text entry shows outside a file row', async () => {
    send.mockResolvedValue(
      reply((details) => {
        details.submission.submission_type = 'online_text_entry';
        details.submission.body = '<p>My essay</p>';
        details.submission.attachments = [];
      }),
    );
    showInFrame(
      `<div>${TURNITIN_SCORE}</div><div id="submission_preview" class="paper user_content"><p>My essay</p></div>`,
    );
    start();
    await expectAbove();
  });

  it('keeps the frame when a report status shows only after the load', async () => {
    const frame = showInFrame(FILE_ROW);
    start();
    await settle();
    expect(boxRoot()?.querySelector('[data-action=feedback]')).not.toBeNull();
    const cell = frame.contentDocument!.querySelector('td.asset-report-status-container')!;
    cell.innerHTML = '<div><a href="#">Similarity report</a></div>';
    await vi.advanceTimersByTimeAsync(200);
    await expectAbove();
  });

  it('keeps the frame when it cannot be read once it has loaded', async () => {
    Object.defineProperty(document.querySelector('#preview_frame'), 'contentDocument', {
      get() {
        throw new Error('blocked');
      },
      configurable: true,
    });
    start();
    await expectAbove();
  });

  it('keeps the frame when it never shows the preview page', async () => {
    showInFrame(FILE_ROW, 'about:blank', 'loading');
    start();
    await settle();
    expect(document.head.querySelector('style')).not.toBeNull();
    await vi.advanceTimersByTimeAsync(10_000);
    await expectAbove();
  });

  it('keeps the frame of a URL submission that has a snapshot image', async () => {
    send.mockResolvedValue(
      reply((details) => {
        details.submission.submission_type = 'online_url';
        details.submission.url = 'https://example.com/work';
        details.submission.attachments = [];
      }),
    );
    showInFrame('<div><img src="/snapshot.png" alt="URL Preview"></div>');
    start();
    await expectAbove();
  });

  it('keeps the frame when the details list files that the frame does not show', async () => {
    showInFrame('<div class="file-upload-submission">No files were uploaded</div>');
    start();
    await expectAbove();
  });

  it('gives the page back exactly when turned off, and shows the view again when it is turned on', async () => {
    showInFrame(
      frameRows(PAGE, [
        {
          fileId: '501',
          name: 'essay.pdf',
          size: '118 KB',
          button: 'Preview',
          report: '<span>Processing</span>',
        },
      ]),
    );
    const before = document.getElementById('content')!.outerHTML;
    start();
    await expectAbove();
    view.setActive(false);
    expect(document.getElementById('content')!.outerHTML).toBe(before);
    view.setActive(true);
    await expectAbove();
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

describe('the rubric comments read mark', () => {
  let intersect: ((entries: { isIntersecting: boolean }[]) => void) | null = null;
  let visibility = 'visible';
  let observers: { disconnect: ReturnType<typeof vi.fn> }[] = [];
  const readMessages = () =>
    send.mock.calls.filter(([message]) => message.type === 'assignment:rubric-read');
  const dot = () => document.querySelector<HTMLElement>('.rubric_comment.unread_indicator');

  beforeEach(() => {
    intersect = null;
    visibility = 'visible';
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => visibility,
    });
    observers = [];
    class FakeObserver {
      disconnect = vi.fn();
      constructor(callback: (entries: { isIntersecting: boolean }[]) => void) {
        intersect = callback;
        observers.push(this);
      }
      observe = vi.fn();
    }
    Object.defineProperty(window, 'IntersectionObserver', {
      configurable: true,
      value: FakeObserver,
    });
    load(submissionDetailsPage({ rubric: true, rubricUnread: true }));
    showInFrame(FILE_ROW);
    // Canvas's script has set the page up, and the holder is in the layout once it is placed.
    container().setAttribute('data-hide_from_rubric', 'true');
    document.getElementById('rubric_holder')!.getClientRects = () => [{}] as unknown as DOMRectList;
    send = vi.fn(async (message: AssignmentDetailsMessage | RubricReadMessage) =>
      message.type === 'assignment:rubric-read' ? { ok: true } : reply(),
    );
  });
  afterEach(() => {
    Reflect.deleteProperty(document, 'visibilityState');
    Reflect.deleteProperty(window, 'IntersectionObserver');
  });

  it('sends one request when the rubric is in view, and clears the mark after the answer', async () => {
    start();
    await settle();
    expect(readMessages()).toHaveLength(0);
    intersect!([{ isIntersecting: true }]);
    await settle();
    expect(readMessages()).toEqual([
      [{ type: 'assignment:rubric-read', courseId: '12', assignmentId: '101', userId: '42' }],
    ]);
    expect(dot()!.style.display).toBe('none');
    expect(document.querySelector('.assess_submission_link')!.getAttribute('title')).toBe('');
  });

  it('sends nothing while the rubric is out of view or the page is hidden', async () => {
    visibility = 'hidden';
    start();
    await settle();
    intersect!([{ isIntersecting: true }]);
    await settle();
    expect(readMessages()).toHaveLength(0);
    visibility = 'visible';
    document.dispatchEvent(new Event('visibilitychange'));
    await settle();
    expect(readMessages()).toHaveLength(1);
  });

  it('sends nothing when Canvas already hid the mark, and nothing from a copy that starts later', async () => {
    start();
    await settle();
    intersect!([{ isIntersecting: true }]);
    await settle();
    expect(readMessages()).toHaveLength(1);
    view.stop();
    start();
    await settle();
    intersect?.([{ isIntersecting: true }]);
    await settle();
    expect(readMessages()).toHaveLength(1);
  });

  it('sends nothing when the mark goes while the rubric waits for the screen', async () => {
    start();
    await settle();
    dot()!.style.display = 'none';
    intersect!([{ isIntersecting: true }]);
    await settle();
    expect(readMessages()).toHaveLength(0);
  });

  it('leaves the mark and sends no second request when the request fails', async () => {
    send = vi.fn(async (message: AssignmentDetailsMessage | RubricReadMessage) => {
      if (message.type === 'assignment:rubric-read') throw new Error('offline');
      return reply();
    });
    start();
    await settle();
    intersect!([{ isIntersecting: true }]);
    await settle();
    intersect!([{ isIntersecting: true }]);
    await settle();
    expect(readMessages()).toHaveLength(1);
    expect(dot()!.style.display).toBe('');
  });

  describe('watching the screen', () => {
    const visibilityListeners = (spy: { mock: { calls: unknown[][] } }) =>
      spy.mock.calls.filter((call) => call[0] === 'visibilitychange').length;

    it.each([
      ['the switch is turned off', () => view.setActive(false)],
      ['the student changes', () => view.resetStudent()],
      ['the view stops', () => view.stop()],
    ])('disconnects the observer and removes the listener when %s', async (_name, leave) => {
      const added = vi.spyOn(document, 'addEventListener');
      const removed = vi.spyOn(document, 'removeEventListener');
      start();
      await settle();
      expect(observers).toHaveLength(1);
      expect(observers[0]!.disconnect).not.toHaveBeenCalled();
      expect(visibilityListeners(added)).toBe(1);
      leave();
      expect(observers[0]!.disconnect).toHaveBeenCalled();
      expect(visibilityListeners(removed)).toBe(1);
    });

    it('disconnects the observer and removes the listener once the request went out', async () => {
      const removed = vi.spyOn(document, 'removeEventListener');
      start();
      await settle();
      intersect!([{ isIntersecting: true }]);
      await settle();
      expect(observers[0]!.disconnect).toHaveBeenCalled();
      expect(visibilityListeners(removed)).toBe(1);
    });

    it('disconnects the observer of a placement that a change of mode takes away', async () => {
      showInFrame(
        frameRows(PAGE, [
          {
            fileId: '501',
            name: 'essay.pdf',
            size: '118 KB',
            button: 'View Feedback',
            report: '<span>Processing</span>',
          },
        ]),
      );
      const removed = vi.spyOn(document, 'removeEventListener');
      start();
      await settle();
      // The first placement was under the files, the second is under the frame.
      expect(observers.length).toBeGreaterThanOrEqual(2);
      expect(observers[0]!.disconnect).toHaveBeenCalled();
      expect(observers[observers.length - 1]!.disconnect).not.toHaveBeenCalled();
      expect(visibilityListeners(removed)).toBe(observers.length - 1);
    });
  });
});

describe('the right column', () => {
  const COLUMN_RULES =
    '#right-side-wrapper{display:block!important}body:not(.full-width):not(.outcomes):not(.body--login-confirmation):not(.content-only) .ic-Layout-wrapper{max-width:1654px!important}';

  it('shows the column and raises the width cap by its width, in the replace mode', async () => {
    start();
    await settle();
    expect(rules()).toContain(COLUMN_RULES);
    expect(document.body.className).toBe('');
    expect(document.getElementById('right-side-wrapper')!.hasAttribute('style')).toBe(false);
  });

  it('does the same in the above mode, where the box holds only the status line and the date', async () => {
    send.mockResolvedValue(
      reply((details) => {
        details.submission.submission_type = 'media_recording';
        details.submission.submitted_at = '2026-10-16T03:59:00Z';
      }),
    );
    start();
    await settle();
    expect(rules()).toContain(COLUMN_RULES);
    expect(boxHost()?.parentElement?.id).toBe('right-side');
    expect(boxRoot()?.querySelector('.av-status')?.textContent).toBe('Submitted!');
    expect(boxRoot()?.querySelector('.av-date')?.textContent).toBe('Oct 15 at 11:59pm');
    expect(boxRoot()?.querySelector('.av-box-files, .av-box-comments, slot')).toBeNull();
    // Canvas's comments column stays where it is.
    expect(container().querySelector(':scope > .submission-details-comments')).not.toBeNull();
    expect(document.getElementById('av-comments')).toBeNull();
  });

  it('leaves the page as Canvas drew it when the column is missing', async () => {
    document.getElementById('right-side-wrapper')!.remove();
    const before = document.documentElement.outerHTML;
    start();
    await settle();
    expect(send).not.toHaveBeenCalled();
    expect(document.documentElement.outerHTML).toBe(before);
  });
});

describe('the status line and the date of the box', () => {
  it('shows "Not Submitted!" with an x for a student who handed in nothing', async () => {
    send.mockResolvedValue(
      reply((details) => {
        details.submission.submission_type = null;
        details.submission.submitted_at = null;
        details.submission.attachments = [];
      }),
    );
    showInFrame('<div style="font-weight:bold">No Submission</div>');
    start();
    await settle();
    expect(boxRoot()?.querySelector('.av-status')?.textContent).toBe('Not Submitted!');
    expect(boxRoot()?.querySelector('.av-status svg')).not.toBeNull();
    expect(boxRoot()?.querySelector('.av-date')).toBeNull();
    expect(boxRoot()?.querySelector('.av-box-files')?.childElementCount).toBe(0);
  });

  it('shows the date in Canvas\'s form, in the time zone of the reply, with "(late)"', async () => {
    send.mockResolvedValue(
      reply((details) => {
        details.submission.submitted_at = '2026-10-16T03:59:00Z';
        details.submission.late = true;
      }),
    );
    start();
    await settle();
    expect(boxRoot()?.querySelector('.av-status')?.textContent).toBe('Submitted!');
    expect(boxRoot()?.querySelector('.av-status svg')).not.toBeNull();
    expect(boxRoot()?.querySelector('.av-date')?.textContent).toBe('Oct 15 at 11:59pm (late)');
  });

  it('shows "Excused!" and no status line for an assignment that takes no submission', async () => {
    send.mockResolvedValue(
      reply((details) => {
        details.submission.excused = true;
      }),
    );
    start();
    await settle();
    expect(boxRoot()?.querySelector('.av-status')?.textContent).toBe('Excused!');
    view.setActive(false);
    send.mockResolvedValue(
      reply((details) => {
        details.assignment.submission_types = ['on_paper'];
        details.submission.submission_type = null;
        details.submission.submitted_at = null;
      }),
    );
    view.setActive(true);
    await settle();
    expect(boxRoot()?.querySelector('.av-status')).toBeNull();
  });
});

describe('the similarity score in the box', () => {
  const rowWith = (score: string) =>
    frameRows(PAGE, [
      { fileId: '501', name: 'essay.pdf', size: '118 KB', button: 'View Feedback', score },
    ]);

  it('replaces the frame also when a file has a score, and shows the score with its address and color', async () => {
    showInFrame(rowWith(TURNITIN_SCORE));
    start();
    await settle();
    expect(rules()).toContain('.submission-details-frame{display:none!important}');
    const score = boxRoot()!.querySelector<HTMLAnchorElement>('a.av-score')!;
    expect(score.textContent).toBe('5.0%');
    expect(score.dataset['state']).toBe('acceptable');
    expect(score.getAttribute('href')).toBe(`${ORIGIN}${PAGE}/turnitin/attachment_1`);
    expect(score.getAttribute('target')).toBe('_blank');
    expect(score.getAttribute('rel')).toBe('noopener noreferrer');
    expect(score.getAttribute('title')).toBe('Similarity score');
    // The score sits on the line of the size and the button, under the file link.
    const meta = score.parentElement!;
    expect(meta.className).toBe('av-box-file-meta');
    expect([...meta.children].map((child) => child.className)).toEqual([
      'av-size',
      'av-score',
      'av-feedback',
    ]);
  });

  it('shows a score with no address as a span with no link, and no state as gray', async () => {
    showInFrame(rowWith(turnitinScores(PAGE).updatedNoAddress));
    start();
    await settle();
    expect(boxRoot()!.querySelector('a.av-score')).toBeNull();
    const score = boxRoot()!.querySelector<HTMLElement>('span.av-score')!;
    expect(score.textContent).toBe('7.0%');
    expect(score.hasAttribute('data-state')).toBe(false);
    expect(score.hasAttribute('href')).toBe(false);
  });

  it('draws the score again when it appears after the load', async () => {
    const frame = showInFrame(FILE_ROW);
    start();
    await settle();
    expect(boxRoot()!.querySelector('.av-score')).toBeNull();
    frame.contentDocument!.querySelector('td.file-upload-submission-turnitin')!.innerHTML =
      TURNITIN_SCORE;
    await vi.advanceTimersByTimeAsync(200);
    expect(boxRoot()!.querySelector('a.av-score')?.textContent).toBe('5.0%');
    expect(rules()).toContain('.submission-details-frame{display:none!important}');
  });
});

describe('the File viewer switch', () => {
  const labels = () => [...boxRoot()!.querySelectorAll('.av-file')].map((link) => link.textContent);

  it('reads "View NAME" with the switch on and "Download NAME" with it off, without a redraw', async () => {
    start();
    view.setFileViewer(true);
    await settle();
    expect(labels()).toEqual(['View essay.pdf']);
    const link = boxRoot()!.querySelector('.av-file')!;
    view.setFileViewer(false);
    expect(labels()).toEqual(['Download essay.pdf']);
    expect(boxRoot()!.querySelector('.av-file')).toBe(link);
    // The address of the link stays, so Canvas downloads the file when the pane cannot take it.
    expect(link.getAttribute('href')).toBe(`${ORIGIN}${PAGE}?download=501`);
    view.setFileViewer(true);
    expect(labels()).toEqual(['View essay.pdf']);
  });

  it('says "Download NAME" from the start when the switch was off before the box was drawn', async () => {
    start();
    view.setFileViewer(false);
    await settle();
    expect(labels()).toEqual(['Download essay.pdf']);
    // A new frame read draws nothing again, and the label stays.
    showInFrame(FILE_ROW).dispatchEvent(new Event('load'));
    expect(labels()).toEqual(['Download essay.pdf']);
  });
});

describe('the comments column', () => {
  const column = () => document.querySelector<HTMLElement>('.submission-details-comments')!;
  const wrapper = () => document.getElementById('av-comments');
  const marks = () =>
    [...container().childNodes].filter((node) => node.nodeValue === 'av-comments-home');

  it("moves Canvas's own node into the box, leaves a mark, and puts the same node back", async () => {
    const before = container().outerHTML;
    const node = column();
    start();
    await settle();
    expect(column()).toBe(node);
    expect(wrapper()?.parentElement).toBe(boxHost());
    expect(node.parentElement).toBe(wrapper());
    expect(wrapper()?.hasAttribute('data-av-own')).toBe(true);
    expect(marks()).toHaveLength(1);
    // The node is in the light DOM, never in the shadow tree, and it has no new attribute.
    expect(boxRoot()?.contains(node)).toBe(false);
    expect(node.hasAttribute('data-av-own')).toBe(false);
    expect(rules()).toContain('#av-comments .comments{height:auto!important');
    expect(rules()).toContain(':has(.comment_list .comment)>.av-no-comments{display:none}');
    view.setActive(false);
    expect(container().outerHTML).toBe(before);
    expect(column()).toBe(node);
    expect(wrapper()).toBeNull();
  });

  it('keeps what the student typed through a change to the above mode and back', async () => {
    const frame = showInFrame(FILE_ROW);
    start();
    await settle();
    const area = document.querySelector<HTMLTextAreaElement>('textarea.grading_comment')!;
    area.value = 'Thank you for the notes';
    area.focus();
    expect(document.activeElement).toBe(area);
    // A report status that the view cannot show comes after the load: the 'above' mode.
    showInFrame(
      frameRows(PAGE, [
        {
          fileId: '501',
          name: 'essay.pdf',
          size: '118 KB',
          button: 'View Feedback',
          report: '<span>Processing</span>',
        },
      ]),
    );
    frame.dispatchEvent(new Event('load'));
    await vi.advanceTimersByTimeAsync(200);
    expect(wrapper()).toBeNull();
    expect(container().querySelector(':scope > .submission-details-comments')).not.toBeNull();
    expect(document.querySelector('textarea.grading_comment')).toBe(area);
    expect(area.value).toBe('Thank you for the notes');
    expect(document.activeElement).toBe(area);
    showInFrame(FILE_ROW);
    frame.dispatchEvent(new Event('load'));
    await vi.advanceTimersByTimeAsync(200);
    expect(wrapper()?.contains(area)).toBe(true);
    expect(area.value).toBe('Thank you for the notes');
    expect(document.activeElement).toBe(area);
    // Switching off keeps the text too.
    view.setActive(false);
    expect(document.querySelector('textarea.grading_comment')).toBe(area);
    expect(area.value).toBe('Thank you for the notes');
    expect(document.activeElement).toBe(area);
  });

  it('adds one line "No Comments" of its own to the wrapper, before the node', async () => {
    start();
    await settle();
    const none = wrapper()!.querySelector('.av-no-comments')!;
    expect(none.textContent).toBe('No Comments');
    expect(wrapper()!.firstElementChild).toBe(none);
  });

  it("keeps Canvas's handler of the Save button: the click reaches the node that moved", async () => {
    let saved = 0;
    document.querySelector('.save_comment_button')!.addEventListener('click', () => (saved += 1));
    start();
    await settle();
    document.querySelector<HTMLButtonElement>('.save_comment_button')!.click();
    expect(saved).toBe(1);
  });

  it('leaves the column alone in the above mode', async () => {
    const before = container().outerHTML;
    send.mockResolvedValue(
      reply((details) => {
        details.submission.submission_type = 'media_recording';
      }),
    );
    start();
    await settle();
    expect(wrapper()).toBeNull();
    expect(marks()).toHaveLength(0);
    expect(rules()).not.toContain('#av-comments');
    view.setActive(false);
    expect(container().outerHTML).toBe(before);
  });

  it('does not touch the rubric: the holder moves as before, and goes home with the comments', async () => {
    load(submissionDetailsPage({ rubric: true }));
    showInFrame(FILE_ROW);
    // Canvas's script has set the page up: the siblings of the holder are marked.
    container().setAttribute('data-hide_from_rubric', 'true');
    const holder = document.getElementById('rubric_holder')!;
    const homeParent = holder.parentElement;
    const style = holder.getAttribute('style');
    start();
    await settle();
    expect(holder.parentElement?.id).toBe('av-rubric');
    expect(wrapper()).not.toBeNull();
    view.setActive(false);
    expect(holder.parentElement).toBe(homeParent);
    expect(holder.getAttribute('style')).toBe(style);
    expect(wrapper()).toBeNull();
  });
});

describe('the cleanup of a dead copy', () => {
  it('puts the comments back before the sweep, and never reaches the marks of an author', async () => {
    start();
    await settle();
    // A comment of another author holds marks of the view, in its own markup.
    const comment = document.querySelector('.comment_list .comment')!;
    comment.insertAdjacentHTML(
      'beforeend',
      '<span data-av-own data-av-toggle id="author-mark">Mark of an author</span>',
    );
    const column = document.querySelector('.submission-details-comments')!;
    expect(document.getElementById('av-comments')?.contains(column)).toBe(true);
    // The dead copy cannot clean up itself: a newer copy removes its nodes.
    removeStaleView(document, PAGE);
    expect(document.getElementById('av-comments')).toBeNull();
    expect(document.getElementById('av-submission-box')).toBeNull();
    expect(document.getElementById('av-submission-details')).toBeNull();
    expect(document.head.querySelector('style[data-av-own]')).toBeNull();
    const survivor = document.getElementById('author-mark');
    expect(survivor).not.toBeNull();
    expect(survivor?.hasAttribute('data-av-own')).toBe(true);
    expect(survivor?.hasAttribute('data-av-toggle')).toBe(true);
    // The column is home at its mark, and the mark is gone.
    expect(container().querySelector(':scope > .submission-details-comments')).toBe(column);
    expect([...container().childNodes].some((node) => node.nodeType === Node.COMMENT_NODE)).toBe(
      false,
    );
  });

  it('removes a box that an earlier copy left in the right column', () => {
    document
      .getElementById('right-side')!
      .insertAdjacentHTML(
        'beforeend',
        '<div id="av-submission-box" data-av-own><div id="av-comments" data-av-own></div></div>',
      );
    removeStaleView(document, PAGE);
    expect(document.getElementById('av-submission-box')).toBeNull();
  });
});

describe('a comment that holds the markup of the page', () => {
  const FORGED_COLUMN = '<div id="right-side-wrapper"><div id="right-side">forged</div></div>';
  /** The right column that Canvas draws, which is outside the content area. */
  const realColumn = () =>
    [...document.querySelectorAll('#right-side')].find((node) => !node.closest('#content'))!;
  const unhandled: unknown[] = [];
  const record = (reason: unknown): void => void unhandled.push(reason);

  beforeEach(() => {
    unhandled.length = 0;
    process.on('unhandledRejection', record);
  });
  afterEach(() => {
    process.off('unhandledRejection', record);
  });

  function loadWith(commentHtml: string): void {
    load(submissionDetailsPage({ commentHtml }));
    showInFrame(FILE_ROW);
  }

  it('does not take the right column from a comment: the box and the comments are placed in the real column', async () => {
    loadWith(FORGED_COLUMN);
    const forged = document.querySelector('#content #right-side-wrapper')!;
    const forgedHtml = forged.outerHTML;
    start();
    await settle();
    expect(unhandled).toEqual([]);
    expect(boxHost()?.parentElement).toBe(realColumn());
    expect(
      document.getElementById('av-comments')?.querySelector('.submission-details-comments'),
    ).not.toBeNull();
    expect(document.head.textContent).toContain(
      '.submission-details-frame{display:none!important}',
    );
    // The comment has no mark and no attribute of the view.
    expect(forged.outerHTML).toBe(forgedHtml);
  });

  it('does not strip the marks of a comment in the cleanup, and still cleans the real column', async () => {
    loadWith(FORGED_COLUMN);
    const forged = document.querySelector<HTMLElement>('#content #right-side')!;
    forged.setAttribute('data-av-note', 'kept');
    forged.insertAdjacentHTML('beforeend', '<span data-av-own id="author-mark">kept</span>');
    realColumn().insertAdjacentHTML(
      'beforeend',
      '<div id="av-submission-box" data-av-own data-av-x><div id="av-comments" data-av-own></div></div>',
    );
    realColumn().setAttribute('data-av-room', '1');
    removeStaleView(document, PAGE);
    expect(forged.getAttribute('data-av-note')).toBe('kept');
    expect(document.getElementById('author-mark')).not.toBeNull();
    expect(document.getElementById('av-submission-box')).toBeNull();
    expect(realColumn().hasAttribute('data-av-room')).toBe(false);
  });

  it('keeps the frame and shows the instructions above it when the mount fails', async () => {
    const real = HTMLElement.prototype.attachShadow;
    let calls = 0;
    vi.spyOn(HTMLElement.prototype, 'attachShadow').mockImplementation(function (
      this: HTMLElement,
      init: ShadowRootInit,
    ) {
      calls += 1;
      // The second call builds the box, after the instructions host stands on the page.
      if (calls === 2) throw new Error('no shadow root');
      return real.call(this, init);
    });
    start();
    await settle();
    expect(unhandled).toEqual([]);
    expect(document.head.textContent).not.toContain('.submission-details-frame{display:none');
    // The comments column is home, and the instructions stand above the content area.
    expect(container().querySelector(':scope > .submission-details-comments')).not.toBeNull();
    expect(document.getElementById('av-comments')).toBeNull();
    expect(host()?.nextElementSibling).toBe(container());
    expect(root()?.querySelector('.av-instructions')).not.toBeNull();
    vi.restoreAllMocks();
  });

  it('keeps every node whose id the view uses when it sits in a comment', () => {
    loadWith(
      '<span id="av-submission-details" data-av-own>a</span><div id="tools-feedback" data-av-own>b</div><div id="tools-turn-in" data-av-own>c</div><div id="av-rubric" data-av-own>d</div>',
    );
    removeStaleView(document, PAGE);
    for (const id of ['av-submission-details', 'tools-feedback', 'tools-turn-in', 'av-rubric']) {
      expect(document.getElementById(id), id).not.toBeNull();
    }
  });

  it('still removes the host, the panes and the rubric wrapper at the places where the view puts them', () => {
    const frame = document.querySelector('.submission-details-frame')!;
    frame.insertAdjacentHTML('afterend', '<div id="av-submission-details" data-av-own></div>');
    frame.insertAdjacentHTML('beforeend', '<div id="av-rubric" data-av-own></div>');
    document.body.insertAdjacentHTML(
      'beforeend',
      '<div id="tools-feedback" data-av-own></div><div id="tools-turn-in" data-av-own></div>',
    );
    removeStaleView(document, PAGE);
    for (const id of ['av-submission-details', 'tools-feedback', 'tools-turn-in', 'av-rubric']) {
      expect(document.getElementById(id), id).toBeNull();
    }
  });

  it('gives the comments the direction and the language of the page', async () => {
    document.documentElement.setAttribute('dir', 'rtl');
    document.documentElement.setAttribute('lang', 'ar');
    try {
      start();
      await settle();
      const wrapper = document.getElementById('av-comments')!;
      expect(wrapper.getAttribute('dir')).toBe('rtl');
      expect(wrapper.getAttribute('lang')).toBe('ar');
      expect(wrapper.querySelector('.av-no-comments')?.getAttribute('lang')).toBe('en');
    } finally {
      document.documentElement.removeAttribute('dir');
      document.documentElement.removeAttribute('lang');
    }
  });
});
