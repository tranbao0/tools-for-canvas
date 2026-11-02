/**
 * Inline SVG icons. They draw with `currentColor`, take their size from the font size (1em), and
 * are hidden from screen readers.
 *
 * Every icon except the app mark is an Instructure UI icon from `@instructure/ui-icons` 11.6.0
 * (MIT license, see THIRD_PARTY_NOTICES.md), the set that Canvas uses. The paths are the package
 * paths scaled from the 1920 grid to a 120 grid and rounded to whole numbers, which keeps them
 * small and changes no visible pixel at icon sizes. A coarser grid (48 or 60) changes the coverage of
 * edge pixels by up to a third at 16 to 20 px, and a finer one (24, with decimals) is larger.
 */
function Icon({ d, class: extra }: { d: string | string[]; class?: string }) {
  return (
    <svg
      class={extra ? `wr-icon ${extra}` : 'wr-icon'}
      width="1em"
      height="1em"
      viewBox="0 0 120 120"
      fill="currentColor"
      fill-rule="evenodd"
      aria-hidden="true"
      focusable="false"
    >
      {(Array.isArray(d) ? d : [d]).map((path) => (
        <path key={path} d={path} />
      ))}
    </svg>
  );
}

const DISCUSSION =
  'm42 1v21h7V8h64v49H99v17L83 57h-5V29H0v64h21v26l26-26h31V65h2l26 26V65h14V1H42zM21 57h35v-7H21v7zm0 15h21v-7H21v7zM7 36h64v50H44l-16 16V86H7V36z';

/** The type icon paths by item kind, as in Canvas's To Do list and planner. */
const TYPE_ICONS = {
  assignment:
    'm92 0v35h-7V7H7v106h78V99h7v21H0V0h92zm8 36c1-1 3-1 5 0l14 14c1 2 1 4 0 5L77 98c-1 0-2 1-3 1H60c-2 0-4-2-4-4V81c0-1 1-2 2-2zM90 56 64 83v9h9l26-27-9-9zM42 78v7H21v-7h21zm14-14v7H21v-7h35zm46-20-7 7 9 9 7-7-9-9zM71 21v28H21V21h50zm-7 7H28v14h36V28z',
  quiz: [
    'm47 92 5 5-16 15-5-5 16-15zM36 81l5 5-20 21-5-5 20-21zM26 71l5 5-26 26-5-5 26-26zm44-54C92-6 115 5 116 6h1v1c0 0 11 23-11 46l-9 9v41l-14 14-21-20-36-36L5 40 19 26h42zm20 52-23 23 16 15 7-7V69zm21-58c-4-1-20-6-36 11L36 61 62 87l39-39c16-16 12-32 10-37zM54 33H22l-7 7 16 15 23-22z',
    'm96 23c-3 0-8 1-13 6l-3 3 11 11 2-3c6-5 6-10 6-13v-4h-3z',
  ],
  discussion: DISCUSSION,
  checkpoint: DISCUSSION,
  page: 'm107 113H22V7h56v28h29v78zM85 9l20 19H85V9zm26 15L90 3c-2-2-5-3-7-3H15v120h99V31c0-3-1-5-3-7zM36 78h49v-7H36v7zm0-29h57v-7H36v7zm0 43h28v-7H36v7zm0-28h42v-8H36v8zm0-29h28v-7H36v7z',
  peer_review:
    'm80 92c-7 5-21 12-40 11-14 0-26-6-33-11V82c0-8 5-15 12-16 7-2 14-3 21-3 10 0 19 1 28 3 7 1 12 8 12 16v10zM27 40v-1c3 0 4-2 6-3 1-2 3-3 5-3 2 0 3 1 5 3 2 1 4 4 9 4 4 0 6-1 8-3v3c0 9-7 17-17 17-9 0-16-8-16-17zm16-23c8 0 15 5 16 12 0 1-1 1-2 2-1 1-2 2-5 2-2 0-3-1-5-2-2-2-4-4-9-4-5 0-8 2-10 4 0 0-1 1-1 1 0-9 8-15 16-15zm26 42c-3 0-7-1-10-1 5-5 8-11 8-18v-7c0-13-11-23-24-23-12 0-23 10-23 23v7c0 7 3 13 8 18-3 0-7 1-11 1C7 61 0 71 0 82v13l1 1c8 6 22 13 39 14 1 0 2 0 3 0 20 0 35-9 42-14l2-1V82c0-11-8-21-18-23zm25-16h-7v-7l14-14 7 7-14 14zm25-21-11-11c-2-1-5-1-6 0L81 32c0 0-1 2-1 3v15h15c1 0 3-1 3-1l21-21c1-1 1-4 0-6z',
  note: 'm111 92-19 19V92h19zM78 71v7H21v-7h57zm21-22v7H21v-7h78zM39 0c6 0 10 5 10 11 0 1 0 3-1 4l14 14-4 5-15-14c-1 1-3 1-4 1-6 0-11-5-11-10 0-6 5-11 11-11zm25 14v7h49v64H85v28H7V21h14v-7H0v106h89c3 0 5-1 7-3l21-21c2-2 3-4 3-7V14H64z',
} satisfies Record<string, string | string[]>;

/** The item kinds that have a type icon. */
export type TypeIconKind = keyof typeof TYPE_ICONS;
export const TypeIcon = ({ kind }: { kind: TypeIconKind }) => (
  <Icon d={TYPE_ICONS[kind]} class="wr-type" />
);

export const GearIcon = () => (
  <Icon d="m109 81-7 11-15-5-1 2c-5 3-10 6-15 8l-2 1-3 15H52l-3-15-2-1c-5-2-10-5-15-8l-1-2-15 5-7-11 12-10-1-3c0-2-1-5-1-8 0-3 1-6 1-8l1-3L9 39l7-11 15 5 1-2c5-3 10-6 15-8l2-1 3-15h14l3 15 2 1c5 2 10 5 15 8l1 2 15-5 7 11-12 10v3c1 2 1 5 1 8 0 3 0 6-1 8v3l12 10zm-4-21c0-3 0-5 0-8l13-11-13-22-16 6c-4-4-9-6-14-8L71 0H46l-3 17c-5 2-10 4-14 8l-17-6L0 41 13 52c0 3-1 5-1 8 0 3 1 5 1 8L0 79l12 22 17-6c4 4 9 6 14 8l3 17h25l4-17c5-2 10-4 14-8l16 6 13-22-13-11c0-3 0-5 0-8zM59 35c-14 0-25 11-25 25 0 14 11 25 25 25 14 0 25-11 25-25 0-14-11-25-25-25m0 43c-10 0-18-8-18-18s8-18 18-18 18 8 18 18-8 18-18 18" />
);

/** The announcement megaphone, for the Announcements tab in narrow layouts. */
export const AnnouncementIcon = () => (
  <Icon d="M99.2 2c0.7-1.5 2.3-2.2 4-1.9 1.6 0.4 2.7 1.8 2.7 3.4V35.7C113.9 37.3 120 44.4 120 52.9c0 8.5-6.1 15.7-14.1 17.3v32.1c0 1.6-1.1 3.1-2.7 3.4a3.6 3.6 0 0 1-0.8 0.1c-1.3 0-2.5-0.7-3.2-1.9C86.2 78 60.3 77.6 60 77.6H35.3v35.3h5.5c-0.7-5.6-1.1-15.4 4-21.9 3.3-4.2 8.1-6.3 14.4-6.3v7.1c-4 0-6.9 1.2-8.8 3.6-4.3 5.5-2.8 16.5-1.9 20.3 0.3 1.1 0 2.2-0.6 3-0.7 0.9-1.7 1.4-2.8 1.4H31.8c-1.9 0-3.5-1.6-3.5-3.5v-38.8h-3.5c-9.7 0-17.6-7.9-17.6-17.6v-3.5h-3.5C1.6 56.5 0 54.9 0 52.9c0-1.9 1.6-3.5 3.5-3.5h3.5v-3.5c0-9.7 7.9-17.6 17.6-17.6h35.3c1.1 0 26.3-0.4 39.2-26.3Zm-0.4 13.7c-12.2 15.1-28.3 18.6-35.3 19.4v35.8c7 0.8 23.1 4.3 35.3 19.4ZM56.5 35.3H24.7c-5.8 0-10.6 4.8-10.6 10.6v14.1c0 5.8 4.8 10.6 10.6 10.6H56.5V35.3Zm49.4 7.7v19.9c4.1-1.5 7.1-5.3 7.1-9.9 0-4.6-3-8.5-7.1-9.9Z" />
);

/** The minus sign of the minimize button. */
export const MinusIcon = () => <Icon d="m13 57h94v6H13z" />;

export const PlusIcon = () => <Icon d="m57 13v44H13v6h44v44h6V63h44v-6H63V13z" />;

const CHEVRON = 'm33 0-6 6 54 54-54 54 6 6 60-60z';

export const ChevronRightIcon = () => <Icon d={CHEVRON} />;

/** The right chevron, mirrored by CSS. */
export const ChevronLeftIcon = () => <Icon d={CHEVRON} class="wr-flip" />;

/** The solid disclosure arrow. CSS turns it to point right while its section is closed. */
export const ChevronDownIcon = () => (
  <Icon d="m0 36 11-12 49 49 49-49 11 12-60 60z" class="wr-chevron" />
);

export const CloseIcon = () => (
  <Icon d="m60 52-33-33-8 8 33 33-33 33 8 8 33-33 33 33 8-8-33-33 33-33-8-8z" />
);

export const CheckIcon = () => <Icon d="m109 17-65 64-33-33L0 59l44 44 76-75z" />;

/**
 * The app mark: a progress ring over a row of seven days, with today in white. The settings and
 * welcome pages show it in their page heading.
 */
export function AppMark({ size = 32 }: { size?: number }) {
  return (
    <svg
      class="wr-mark"
      width={size}
      height={size}
      viewBox="8 8 112 112"
      aria-hidden="true"
      focusable="false"
    >
      <rect x="8" y="8" width="112" height="112" rx="26" fill="#2948c9" />
      <circle
        cx="64"
        cy="55"
        r="24"
        fill="none"
        stroke="#fff"
        stroke-opacity=".3"
        stroke-width="11"
      />
      <path
        d="M64 31a24 24 0 1 1-22.83 16.58"
        fill="none"
        stroke="#fff"
        stroke-width="11"
        stroke-linecap="round"
      />
      <g fill="#fff">
        {[28, 40, 52, 64, 76, 88, 100].map((x) => (
          <circle
            key={x}
            cx={x}
            cy="98"
            r={x === 64 ? 5.75 : 4.25}
            fill-opacity={x < 64 ? 0.8 : x > 64 ? 0.4 : 1}
          />
        ))}
      </g>
    </svg>
  );
}

/**
 * The file type icons of the file viewer, and the Download and Open in Canvas icons. They are
 * Instructure UI line icons from the same package, scaled from the 1920 grid to a 120 grid like
 * the icons above, but rounded to one decimal, because the glyphs of a page and an image need it.
 */
const FILE_ICONS = {
  pdf: [
    'M78.2 0c2.8 0 5.5 1.1 7.5 3.1l20.6 20.6c2 2 3.1 4.7 3.1 7.5V120H10.6V0Zm-4.1 7.1H17.6V112.9h84.7V35.3H74.1V7.1Zm7.1 1.5v19.7h19.7L81.2 8.5Z',
    'M56.3 42.4c1.7 0 3.1 0.8 4.2 2.4 2.6 3.7 2.4 7.6 1.5 12.9 -0.3 1.8 0 3.7 1 5.2 1.4 2.2 3.5 5.2 5.5 7.7 1.5 1.9 3.8 2.9 6.1 2.6 1.5 -0.2 3.3 -0.4 5.1 -0.4 8.2 0 7.6 2.9 8.3 5.6 0.4 1.6 0.2 3 -0.6 4.1 -1 1.4 -3.2 2.2 -6.3 2.2 -3.5 0 -4.6 -0.6 -7.7 -1.6 -1.7 -0.6 -3.5 -0.7 -5.2 -0.2 -3.5 0.9 -9.2 2.3 -14 2.9 -2.5 0.4 -4.9 1.7 -6.4 3.8 -3.5 4.8 -6.7 9.3 -11.8 9.3 -1.3 0 -2.5 -0.5 -3.5 -1.4 -1.5 -1.5 -2.1 -3.1 -1.8 -5 0.9 -5.8 8 -9 12.3 -11.4 1 -0.6 1.8 -1.4 2.3 -2.5l6.7 -14.6c0.5 -1 0.6 -2.2 0.5 -3.3 -0.8 -4.9 -1.9 -13.2 1.2 -17 0.7 -0.8 1.6 -1.3 2.7 -1.3Zm1.3 21.2c-2.7 7.9 -7.5 16.5 -8.1 17.5 5.8 -2.7 17.2 -4.1 17.2 -4.1 -5.8 -5.6 -9.1 -13.4 -9.1 -13.4Z',
  ],
  image:
    'M120 7.1v105.9H0V7.1h120Zm-7.1 7.1H7.1V105.9h105.9V14.1ZM58.5 66.2c11.4 -16.2 20.8 -17.9 26.7 -16.6 10 2.3 17 15.1 20.7 38.1l0.7 4.1H13l1.3 -4.5c5.3 -19.1 10.8 -28.6 17.7 -30.6 6.4 -1.9 11.6 2.7 16.2 6.8 2.7 2.4 5.7 5.1 7.7 4.9 1 -0.1 2 -1.3 2.7 -2.3Zm25.1 -9.7c-5.2 -1.2 -12.3 3.8 -19.3 13.8 -2.2 3.1 -4.8 4.9 -7.6 5.2 -4.8 0.6 -8.6 -2.7 -12.4 -6l-0.2 -0.2c-0.2 -0.1 -0.3 -0.3 -0.5 -0.4 -3.4 -3 -6.9 -6.1 -9.5 -5.3 -2.2 0.6 -6.4 4.3 -11.6 21.3h75.8c-3.2 -16.6 -8.4 -26.8 -14.6 -28.2ZM42.4 21.2c7.8 0 14.1 6.3 14.1 14.1 0 7.8 -6.3 14.1 -14.1 14.1S28.2 43.1 28.2 35.3s6.3 -14.1 14.1 -14.1Zm0 7.1c-3.9 0 -7.1 3.2 -7.1 7.1 0 3.9 3.2 7.1 7.1 7.1 3.9 0 7.1 -3.2 7.1 -7.1 0 -3.9 -3.2 -7.1 -7.1 -7.1Z',
  audio:
    'M70.6 7.1v105.9H58.5l-28.2 -28.2h-19.7C4.8 84.7 0 80 0 74.1V45.9c0 -5.8 4.8 -10.6 10.6 -10.6h19.7L58.5 7.1h12Zm-7.1 7.1h-2.1l-26.2 26.2v39.4l26.2 26.2h2.1V14.1Zm41 8.4C114.5 32.6 120 45.9 120 60c0 14.1 -5.5 27.4 -15.5 37.4l-5 -5c8.7 -8.7 13.4 -20.2 13.4 -32.4 0 -12.3 -4.8 -23.8 -13.4 -32.4Zm-14.9 15c6 6.1 9.3 14 9.3 22.5s-3.3 16.4 -9.3 22.5l-5 -5c4.7 -4.7 7.2 -10.9 7.2 -17.5 0 -6.6 -2.6 -12.8 -7.2 -17.5Zm-61.3 4.8H10.6c-1.9 0 -3.5 1.6 -3.5 3.5v28.2c0 1.9 1.6 3.5 3.5 3.5h17.6V42.4Z',
  video:
    'M113.3 97.3c-34.9 7.9 -71.8 7.9 -106.7 0V29.3c34.9 -7.9 71.8 -7.9 106.7 0v68ZM117.4 23.4c-37.5 -9 -77.4 -9 -114.9 0L0 24v78.6l2.6 0.6c18.8 4.5 38.1 6.8 57.4 6.8 19.4 0 38.7 -2.3 57.4 -6.8l2.6 -0.6V24l-2.6 -0.6ZM53.3 49.2l23.5 14.1 -23.5 14.1V49.2Zm-6.7 40 43.1 -25.9 -43.1 -25.9v51.8Z',
  word: [
    'M78.2 0c2.8 0 5.5 1.1 7.5 3.1l20.6 20.6c2 2 3.1 4.7 3.1 7.5V120H10.6V0Zm-4.1 7.1H17.6V112.9h84.7V35.3H74.1V7.1Zm7.1 1.5v19.7h19.7L81.2 8.5Z',
    'M60 21.2v28.2H31.7V21.2h28.2zm-7.1 7.1H38.8v14.1h14.1V28.2zm-21.2 35.3h56.5V56.5h-56.5zm0 28.2h49.4v-7.1H31.7zm0 -14.1h42.4v-7.1H31.7z',
  ],
  powerpoint:
    'M88.8 83.9c1.9 -2.8 3 -6.2 3 -9.8 0 -8.5 -6.1 -15.6 -14.1 -17.3v16.3l11.2 10.8Zm-32.3 -9.8c0 9.7 7.9 17.6 17.6 17.6 3.6 0 6.9 -1.1 9.7 -2.9l-13.2 -12.7V56.8c-8 1.6 -14.1 8.8 -14.1 17.3Zm17.6 -24.7c13.6 0 24.7 11.1 24.7 24.7 0 13.6 -11.1 24.7 -24.7 24.7 -13.6 0 -24.7 -11.1 -24.7 -24.7 0 -13.6 11.1 -24.7 24.7 -24.7Zm10.6 -35.3v28.2h28.2v63.5H7.1V14.1h77.6ZM42.4 42.4H21.2v7.1h21.2V42.4Zm21.2 -14.1v7.1H21.2v-7.1h42.4Zm28.2 -12.7 19.7 19.7h-19.7V15.6Zm25.1 15.2L96.3 10.2c-2 -2 -4.7 -3.1 -7.5 -3.1H0v105.9h120V38.2c0 -2.8 -1.1 -5.5 -3.1 -7.5Z',
  excel:
    'M49.4 60h14.1V45.9H49.4v14.1Zm21.2 21.2h14.1v-14.1h-14.1v14.1Zm-21.2 0h14.1v-14.1H49.4v14.1Zm-21.2 0h14.1v-14.1H28.2v14.1Zm0 -21.2h14.1V45.9H28.2v14.1Zm56.5 -42.4v28.2h28.2v56.5H7.1V17.6h77.6Zm7.1 1.5 19.7 19.7h-19.7V19.1Zm25.1 15.2L96.3 13.7c-2 -2 -4.7 -3.1 -7.5 -3.1H0v98.8h120V41.7c0 -2.8 -1.1 -5.5 -3.1 -7.5Z',
  document:
    'M106.6 112.9H21.9V7.1h56.5v28.2h28.2v77.6Zm-21.2 -104.4 19.7 19.7h-19.7V8.5Zm25.1 15.2L90 3.1C88 1.1 85.4 0 82.5 0H14.9v120h98.8V31.2c0 -2.8 -1.1 -5.5 -3.1 -7.5ZM36.1 77.6h49.4v-7.1H36.1v7.1Zm0 -28.2h56.5V42.4h-56.5v7.1Zm0 42.4h28.2v-7.1H36.1v7.1Zm0 -28.2h42.4V56.5H36.1v7.1Zm0 -28.2h28.2V28.2H36.1v7.1Z',
} satisfies Record<string, string | string[]>;

/** The kinds of file that have an icon. */
export type FileIconKind = keyof typeof FILE_ICONS;
export const FileIcon = ({ kind }: { kind: FileIconKind }) => (
  <Icon d={FILE_ICONS[kind]} class="wr-file-icon" />
);

export const DownloadIcon = () => (
  <Icon d="m112.9 92.7 5 5 -22.2 22.2H22.2L0 97.7l5 -5 20.1 20.1H92.8l20.1 -20.1ZM62.4 0v72.9l22.2 -22.2 5 5 -30.7 30.7L28.1 55.7l5 -5 22.2 22.2V0h7.1Z" />
);

export const ExternalLinkIcon = () => (
  <Icon d="M76.7 16.7c5.5 0 10 4.5 10 10v26.7H80v-10H6.7v50C6.7 95.2 8.2 96.7 10 96.7h66.7c1.8 0 3.3 -1.5 3.3 -3.3v-13.3h6.7v13.3c0 5.5 -4.5 10 -10 10H10c-5.5 0 -10 -4.5 -10 -10V26.7c0 -5.5 4.5 -10 10 -10Zm22.4 27.6 20 20c1.3 1.3 1.3 3.4 0 4.7l-20 20 -4.7 -4.7 14.3 -14.3H56.7V63.4h52L94.3 49l4.7 -4.7Zm-22.4 -21H10c-1.8 0 -3.3 1.5 -3.3 3.3v10H80V26.7c0 -1.8 -1.5 -3.3 -3.3 -3.3Z" />
);
