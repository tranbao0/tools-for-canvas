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
