/**
 * The view gallery. It renders every surface state from mock data at several widths.
 * `?theme=dark` renders the in-page surfaces with a dark host; extension pages follow
 * `prefers-color-scheme`, which the screenshot script emulates. Scenes named `theme-*` force a
 * theme with `data-theme`, so they look the same in both runs.
 * `?scene=<name>` renders one scene only.
 *
 * In-page scenes get Canvas's default brand custom properties, as a Canvas page has. When the
 * Canvas fonts are in the local test cache (see vite.config.ts), the gallery loads them, so the
 * text renders in Canvas's Lato as on a Canvas page.
 */
import { render, type ComponentChildren, type VNode } from 'preact';
import { useEffect, useLayoutEffect, useRef } from 'preact/hooks';
import { App } from '../../src/lib/ui/App';
import { SettingsView } from '../../src/lib/ui/SettingsView';
import { PAGE_LAYOUT_CSS } from '../../src/lib/ui/pageLayout';
import { APP_CSS, installStyles } from '../../src/lib/ui/styles';
import { WelcomeView } from '../../src/lib/ui/WelcomeView';
import type { AppProps, SurfaceKind } from '../../src/lib/ui/contract';
import { attachShadowMount, type ShadowMount } from '../../src/lib/surface/shadowMount';
import {
  allDoneView,
  checkedButMissing,
  COURSES,
  currentWeekGroups,
  eightCoursesView,
  et,
  hiddenCourseView,
  limitedFilteredView,
  mkGroup,
  mkItem,
  mkView,
  noopActions,
  nonReadyStates,
  nothingDueView,
  ORIGIN,
  OTHER_OFFER,
  pastWeekView,
  readyState,
} from '../../src/lib/ui/testing/mocks';
import type { Settings } from '../../src/lib/model/types';

/** The folder with Canvas's Lato fonts, or an empty string when the cache is missing. */
declare const __CANVAS_FONTS__: string;

const params = new URLSearchParams(location.search);
const theme = params.get('theme') === 'dark' ? 'dark' : 'light';
const only = params.get('scene');
const actions = noopActions((name, args) => console.info('action', name, ...args));

const PANEL_WIDTHS = [170, 240, 360, 480];

interface Scene {
  name: string;
  widths: number[];
  /** Fixed frame height, so sticky parts show as in a real panel. */
  height?: number;
  /** In-page scenes render inside a shadow root with a themed host. */
  shadow?: boolean;
  /** Forces `data-theme` on the frame, whatever the run's theme. */
  forceTheme?: 'light' | 'dark';
  render(): VNode;
  /** Runs after the first render, such as clicks that open groups. */
  setup?(root: ParentNode): Promise<void>;
}

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

async function clickAll(root: ParentNode, selector: string): Promise<void> {
  for (let pass = 0; pass < 4; pass += 1) {
    const targets = Array.from(root.querySelectorAll<HTMLElement>(selector));
    if (targets.length === 0) return;
    targets.forEach((el) => el.click());
    await tick();
  }
}

function app(
  surface: SurfaceKind,
  state: AppProps['state'],
  options: Pick<AppProps, 'settings'> = {},
) {
  return () => <App surface={surface} state={state} actions={actions} {...options} />;
}

/** A busy week for the in-page list: groups longer than its row limit. */
function busyWeekView() {
  const base = currentWeekGroups();
  const pastDue = base.find((group) => group.kind === 'past_due');
  const extraPastDue = ['Lab 6 prelab questions', 'Reading notes: chapter 8'].map((title, index) =>
    mkItem({
      title,
      course: index === 0 ? 'bio' : 'hist',
      due: et('2026-10-24', '09:00'),
      canSkip: true,
    }),
  );
  const today = mkGroup({
    kind: 'today',
    date: '2026-10-27',
    items: [
      ['Quiz 7: Integration by parts', 'math', '09:00'],
      ['Lab 6: Thin-layer chromatography', 'chem', '13:00'],
      ['Discussion: Columbian exchange', 'hist', '17:00'],
      ['Essay draft 2', 'engl', '20:00'],
      ['Problem Set 7', 'math', '23:59'],
      ['Reading quiz 9', 'bio', '23:59'],
    ].map(([title, course, time]) =>
      mkItem({
        title: title ?? '',
        course: course as 'math' | 'chem' | 'hist' | 'engl' | 'bio',
        due: et('2026-10-27', time ?? '23:59'),
      }),
    ),
  });
  return mkView({
    groups: base.flatMap((group) => {
      if (group.kind === 'past_due')
        return [{ ...group, items: [...(pastDue?.items ?? []), ...extraPastDue] }];
      if (group.kind === 'today') return [today];
      return [group];
    }),
  });
}

const settings: Settings = {
  weekStart: 'auto',
  hiddenCourseIds: [COURSES.psyc.id],
  showRings: true,
  showOnCanvasPages: true,
  theme: 'auto',
};

const settingsData: AppProps['settings'] = {
  value: settings,
  courses: Object.values(COURSES).map(({ id, name }) => ({ id, name })),
};

/** Opens the settings in place with the gear. */
async function openGear(root: ParentNode): Promise<void> {
  root.querySelector<HTMLElement>('[data-opener="gear"]')?.click();
  await tick();
}

/** A week with one checked item that Canvas still marks missing, in Past due and on a day. */
function checkedMissingView() {
  return mkView({
    groups: [
      mkGroup({
        kind: 'past_due',
        items: [
          checkedButMissing(),
          mkItem({
            title: 'Lab 5 report',
            course: 'bio',
            due: et('2026-10-23', '17:00'),
            chip: { kind: 'missing' },
            availability: { kind: 'closed' },
            canSkip: true,
          }),
        ],
      }),
      mkGroup({
        kind: 'today',
        date: '2026-10-27',
        items: [
          mkItem({ title: 'Quiz 7', course: 'math', kind: 'quiz', due: et('2026-10-27', '23:59') }),
        ],
      }),
    ],
    rings: mkView().rings.filter(
      (r) => r.courseId === COURSES.chem.id || r.courseId === COURSES.bio.id,
    ),
    hiddenCourseCount: 0,
  });
}

const scenes: Scene[] = [
  { name: 'ready', widths: PANEL_WIDTHS, render: app('panel', readyState()) },
  {
    name: 'ready-expanded',
    widths: PANEL_WIDTHS,
    render: app('panel', readyState()),
    async setup(root) {
      await clickAll(root, '[aria-expanded="false"]:not(.wr-chip):not(.wr-marker)');
      const tip = root.querySelectorAll<HTMLElement>('button.wr-chip');
      tip.forEach((el, index) => {
        if (index % 4 === 0) el.click();
      });
      await tick();
    },
  },
  {
    name: 'ready-notices',
    widths: PANEL_WIDTHS,
    render: app(
      'panel',
      readyState({
        stale: { since: '2026-10-27T19:05:00Z', offline: true },
        refreshing: true,
        offer: { origin: 'https://canvas.state.edu' },
        undo: { kind: 'done', count: 1 },
        seenNotes: { firstDone: false, firstSkip: false },
      }),
    ),
    async setup(root) {
      root.querySelector<HTMLElement>('.wr-check-input:not(:checked):not(:disabled)')?.click();
      root.querySelector<HTMLElement>('[data-part="skip"]')?.click();
      await tick();
    },
  },
  {
    name: 'ready-viewport',
    widths: [240, 360],
    height: 560,
    render: app('panel', readyState({ undo: { kind: 'skipped_all', count: 3 } })),
  },
  {
    name: 'ready-past-week',
    widths: PANEL_WIDTHS,
    render: app('panel', readyState({ view: pastWeekView() })),
  },
  {
    name: 'ready-nothing-due',
    widths: PANEL_WIDTHS,
    render: app('panel', readyState({ view: nothingDueView() })),
  },
  {
    name: 'ready-eight-courses',
    widths: [240, 360],
    render: app('panel', readyState({ view: eightCoursesView() })),
  },
  {
    name: 'ready-all-done',
    widths: [240, 360],
    render: app('panel', readyState({ view: allDoneView() })),
  },
  {
    name: 'ready-limited-filter',
    widths: PANEL_WIDTHS,
    render: app(
      'panel',
      readyState({ view: limitedFilteredView(), undo: { kind: 'deleted', count: 1 } }),
    ),
  },
  {
    // Canvas course codes can be long; they wrap to two lines under the ring.
    name: 'ready-long-codes',
    widths: [170, 240],
    render: app(
      'panel',
      readyState({
        view: mkView({
          rings: mkView().rings.map((ring) => {
            if (ring.courseId === COURSES.bio.id)
              return { ...ring, shortLabel: 'FA26-BIOL-1010-001' };
            if (ring.courseId === COURSES.chem.id) return { ...ring, shortLabel: 'CHEM 210 L02' };
            return ring;
          }),
        }),
      }),
    ),
  },
  {
    name: 'ready-skipped-courses',
    widths: PANEL_WIDTHS,
    render: app(
      'panel',
      readyState({
        skippedCourses: [
          { id: COURSES.bio.id, name: 'BIO 201' },
          { id: COURSES.chem.id, name: 'CHEM 210' },
        ],
      }),
    ),
  },
  {
    name: 'ready-skipped-stale',
    widths: [240, 360],
    render: app(
      'panel',
      readyState({
        skippedCourses: [{ id: COURSES.bio.id, name: 'BIO 201' }],
        stale: { since: '2026-10-27T19:05:00Z', offline: false },
      }),
    ),
  },
  {
    name: 'ready-filter-no-rings',
    widths: [240, 360],
    render: app(
      'panel',
      readyState({ view: mkView({ rings: [], courseFilter: COURSES.math.id }) }),
    ),
  },
  {
    name: 'ready-no-rings',
    widths: [240, 360],
    render: app(
      'panel',
      readyState({
        view: mkView({ rings: [], hiddenCourseCount: 0, browserTimeZoneDiffers: false }),
      }),
    ),
  },
  {
    name: 'form-new',
    widths: PANEL_WIDTHS,
    render: app('panel', readyState()),
    async setup(root) {
      root.querySelector<HTMLElement>('.wr-add')?.click();
      await tick();
    },
  },
  {
    name: 'form-edit-error',
    widths: PANEL_WIDTHS,
    render: app('panel', readyState()),
    async setup(root) {
      root.querySelector<HTMLElement>('button.wr-title')?.click();
      await tick();
      const title = root.querySelector<HTMLInputElement>('input[type="text"]');
      if (title) {
        title.value = '';
        title.dispatchEvent(new Event('input', { bubbles: true }));
      }
      await tick();
      root.querySelector<HTMLElement>('button[type="submit"]')?.click();
      await tick();
    },
  },
  ...nonReadyStates().map((entry): Scene => ({
    name: `state-${entry.name}`,
    widths: PANEL_WIDTHS,
    render: app('panel', entry.state),
  })),
  {
    name: 'state-cant-load-offer',
    widths: [240, 360],
    render: app('panel', {
      kind: 'cant_load',
      origin: ORIGIN,
      offline: false,
      offer: OTHER_OFFER,
    }),
  },
  {
    name: 'ready-note',
    widths: PANEL_WIDTHS,
    render: app('panel', readyState({ seenNotes: { firstDone: false, firstSkip: true } })),
    async setup(root) {
      root.querySelector<HTMLElement>('.wr-check-input:not(:checked):not(:disabled)')?.click();
      await tick();
    },
  },
  {
    name: 'ready-undo',
    widths: PANEL_WIDTHS,
    height: 520,
    render: app('panel', readyState({ undo: { kind: 'deleted', count: 1 } })),
  },
  { name: 'inpage-ready', widths: [240], shadow: true, render: app('inpage', readyState()) },
  {
    name: 'inpage-four',
    widths: [240],
    shadow: true,
    render: app(
      'inpage',
      readyState({
        view: mkView({
          groups: [
            mkGroup({
              kind: 'today',
              date: '2026-10-27',
              items: ['Debate 2', 'Participation: Week 9', 'Quiz 3', 'Return library books'].map(
                (title) => mkItem({ title, course: 'hist', due: et('2026-10-27', '23:59') }),
              ),
            }),
          ],
        }),
        offer: OTHER_OFFER,
        undo: { kind: 'done', count: 1 },
      }),
    ),
  },
  {
    name: 'inpage-busy',
    widths: [240],
    shadow: true,
    render: app('inpage', readyState({ view: busyWeekView() })),
  },
  {
    name: 'inpage-glance',
    widths: [170, 240],
    shadow: true,
    render: app('inpage', readyState({ view: busyWeekView() })),
  },
  {
    // Past due and the rest of the week open in place.
    name: 'inpage-glance-open',
    widths: [170, 240],
    shadow: true,
    render: app('inpage', readyState({ view: busyWeekView() })),
    async setup(root) {
      root.querySelector<HTMLElement>('[data-group="past_due"] .wr-group-toggle')?.click();
      root.querySelector<HTMLElement>('.wr-list > .wr-subline .wr-sub-toggle')?.click();
      await tick();
    },
  },
  {
    name: 'inpage-eight-courses',
    widths: [170, 240],
    shadow: true,
    render: app('inpage', readyState({ view: eightCoursesView() })),
  },
  {
    name: 'inpage-nothing-due',
    widths: [170, 240],
    shadow: true,
    render: app('inpage', readyState({ view: nothingDueView() })),
  },
  {
    name: 'inpage-all-done',
    widths: [170, 240],
    shadow: true,
    render: app('inpage', readyState({ view: allDoneView() })),
  },
  {
    name: 'inpage-busy-expanded',
    widths: [240],
    shadow: true,
    render: app('inpage', readyState({ view: busyWeekView() })),
    async setup(root) {
      root.querySelector<HTMLElement>('.wr-more')?.click();
      await tick();
    },
  },
  {
    name: 'inpage-course-home',
    widths: [240],
    shadow: true,
    render: app(
      'inpage',
      readyState({
        view: mkView({
          ...limitedFilteredView(),
          limited: false,
          courseFilter: undefined,
          scopeCourseId: COURSES.math.id,
          hourCycle: 'h12',
          hiddenCourseCount: 0,
          rings: mkView().rings.filter((r) => r.courseId === COURSES.math.id),
        }),
      }),
    ),
  },
  {
    name: 'inpage-loading',
    widths: [240],
    shadow: true,
    render: app('inpage', { kind: 'loading' }),
  },
  {
    name: 'inpage-checked-missing',
    widths: [240],
    shadow: true,
    render: app('inpage', readyState({ view: checkedMissingView() })),
  },
  {
    name: 'ready-checked-missing',
    widths: [170, 360],
    render: app('panel', readyState({ view: checkedMissingView() })),
  },
  {
    name: 'settings-in-place',
    widths: [240, 360],
    render: app('panel', readyState(), { settings: settingsData }),
    setup: openGear,
  },
  {
    name: 'settings-in-place-narrow',
    widths: [170],
    render: app('panel', readyState(), { settings: settingsData }),
    setup: openGear,
  },
  {
    name: 'settings-in-place-loading',
    widths: [240],
    render: app('panel', readyState()),
    setup: openGear,
  },
  {
    name: 'inpage-settings',
    widths: [240],
    shadow: true,
    render: app('inpage', readyState(), { settings: settingsData }),
    setup: openGear,
  },
  {
    name: 'theme-forced-dark',
    widths: [240, 360],
    forceTheme: 'dark',
    render: app('panel', readyState()),
  },
  {
    name: 'theme-forced-light',
    widths: [240, 360],
    forceTheme: 'light',
    render: app('panel', readyState()),
  },
  {
    name: 'theme-forced-dark-inpage',
    widths: [240],
    shadow: true,
    forceTheme: 'dark',
    render: app('inpage', readyState({ view: busyWeekView() })),
  },
  {
    name: 'theme-forced-light-inpage',
    widths: [240],
    shadow: true,
    forceTheme: 'light',
    render: app('inpage', readyState({ view: busyWeekView() })),
  },
  {
    name: 'inpage-hidden-course',
    widths: [240],
    shadow: true,
    render: app('inpage', readyState({ view: hiddenCourseView() })),
  },
  {
    name: 'inpage-signed-out',
    widths: [240],
    shadow: true,
    render: app('inpage', { kind: 'signed_out', origin: ORIGIN, isFirefox: false, offer: null }),
  },
  {
    name: 'settings',
    widths: [360, 640],
    render: () => (
      <SettingsView
        settings={settings}
        courses={Object.values(COURSES).map(({ id, name }) => ({ id, name }))}
        origin={ORIGIN}
        onChange={(next) => console.info('settings', next)}
      />
    ),
  },
  {
    name: 'welcome-chrome',
    widths: [360, 720],
    render: () => (
      <WelcomeView
        browser="chrome"
        shortcut="Alt+Shift+W"
        state={{ kind: 'not_set_up', offer: null }}
        actions={actions}
      />
    ),
  },
  {
    name: 'welcome-offer',
    widths: [360, 720],
    render: () => (
      <WelcomeView
        browser="chrome"
        shortcut="Alt+Shift+W"
        state={{ kind: 'not_set_up', offer: { origin: 'https://canvas.school.edu' } }}
        actions={actions}
      />
    ),
  },
  {
    name: 'welcome-edge-ready',
    widths: [720],
    render: () => (
      <WelcomeView browser="edge" shortcut={null} state={readyState()} actions={actions} />
    ),
  },
];

/** Renders `children` into the same shadow mount that the in-page content script uses. */
function ShadowFrame(props: {
  children: ComponentChildren;
  width: number;
  theme: 'light' | 'dark';
}) {
  const parentRef = useRef<HTMLDivElement>(null);
  const mountRef = useRef<ShadowMount | null>(null);
  useLayoutEffect(() => {
    const parent = parentRef.current;
    if (!parent) return;
    mountRef.current ??= attachShadowMount(parent, { css: APP_CSS, theme: props.theme });
    render(<>{props.children}</>, mountRef.current.root);
  });
  return <div ref={parentRef} class="frame-host" style={{ width: `${props.width}px` }} />;
}

function SceneView({ scene }: { scene: Scene }) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const section = ref.current;
    if (!section) return;
    const roots: ParentNode[] = [];
    section.querySelectorAll<HTMLElement>('.frame').forEach((frame) => {
      const host = frame.querySelector<HTMLElement>('weekrow-list');
      roots.push(host?.shadowRoot ?? frame);
    });
    const run = scene.setup
      ? Promise.all(roots.map((root) => scene.setup?.(root)))
      : Promise.resolve();
    void run.then(() => section.setAttribute('data-done', ''));
  }, [scene]);
  return (
    <section ref={ref} class="scene" data-scene={scene.name}>
      <h2 class="scene-name">{scene.name}</h2>
      <div class="frames">
        {scene.widths.map((width) => (
          <div key={width} class="frame-wrap">
            <div class="frame-label">{width} px</div>
            <div
              class={[
                'frame',
                scene.height ? 'is-fixed' : '',
                scene.shadow ? 'is-canvas' : '',
                scene.shadow && (scene.forceTheme !== undefined || theme === 'light')
                  ? 'is-light-page'
                  : '',
              ]
                .filter(Boolean)
                .join(' ')}
              data-theme={scene.shadow ? undefined : scene.forceTheme}
              style={{
                // A Canvas frame is the right column: the list's width plus 24 px at each side.
                width: `${scene.shadow ? width + 48 : width}px`,
                height: scene.height ? `${scene.height}px` : undefined,
              }}
            >
              {scene.shadow ? (
                <ShadowFrame width={width} theme={scene.forceTheme ?? theme}>
                  {scene.render()}
                </ShadowFrame>
              ) : (
                scene.render()
              )}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

const GALLERY_CSS = `
  body { margin: 0; padding: 24px; font: 13px system-ui, sans-serif; background: light-dark(#e9ebef, #0d0e10); color: light-dark(#333, #ccc); color-scheme: light dark; }
  .scene { margin: 0 0 40px; padding: 16px; width: max-content; background: light-dark(#dfe2e7, #050607); border-radius: 12px; }
  .scene-name { margin: 0 0 12px; font-size: 14px; font-weight: 600; }
  .frames { display: flex; align-items: flex-start; gap: 24px; }
  .frame-label { margin-bottom: 6px; font-size: 11px; opacity: .7; }
  .frame { box-sizing: border-box; box-shadow: 0 0 0 1px light-dark(#c8ccd3, #2a2d33); background: light-dark(#fff, #17181b); }
  .frame.is-fixed { overflow: auto; }
  .frame > .wr[data-surface='panel'] { min-height: 0; }
  .frame:not(.is-fixed) .wr-header, .frame:not(.is-fixed) .wr-dock { position: relative; }
  .frame.is-fixed > .wr[data-surface='panel'] { min-height: 100%; }
  .frame[data-theme='dark'] { background: #1b2330; color-scheme: dark; }
  .frame[data-theme='light'] { background: #fff; color-scheme: light; }
  .frame.is-canvas { padding: 24px; background: #181a1b; --ic-brand-primary: #2B7ABC; --ic-brand-font-color-dark: #273540; --ic-link-color: #0E68B3; --ic-link-color-darkened-10: #0D5EA2; --ic-brand-button--primary-bgd: var(--ic-brand-primary); --ic-brand-button--primary-text: #fff; }
  .frame.is-canvas.is-light-page { background: #fff; }
`;

/** Canvas's Lato, from the local test cache, as a Canvas page declares it. */
function canvasFontsCss(dir: string): string {
  const faces: [string, string, string][] = [
    ['400', 'normal', 'Lato-Regular-bd03a2cc27.woff2'],
    ['400', 'italic', 'Lato-Italic-4eb103b4d1.woff2'],
    ['700', 'normal', 'Lato-Bold-cccb897485.woff2'],
  ];
  return faces
    .map(
      ([weight, style, file]) =>
        `@font-face{font-family:"Lato Extended";font-weight:${weight};font-style:${style};src:url("/@fs${dir}/${file}") format("woff2")}`,
    )
    .join('');
}

function Gallery() {
  const shown = only ? scenes.filter((scene) => scene.name === only) : scenes;
  return (
    <>
      <style>{GALLERY_CSS + (__CANVAS_FONTS__ ? canvasFontsCss(__CANVAS_FONTS__) : '')}</style>
      {shown.map((scene) => (
        <SceneView key={scene.name} scene={scene} />
      ))}
    </>
  );
}

installStyles(document, PAGE_LAYOUT_CSS);
const root = document.getElementById('gallery');
if (root) render(<Gallery />, root);
