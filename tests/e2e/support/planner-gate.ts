import type { RecordedRequest } from './fake-canvas';

/** The range a planner request asks for, as instants. */
export interface PlannerRange {
  start: number;
  end: number;
}

/** The range of a planner request, or `null` for any other request. */
export function plannerRangeOf(request: RecordedRequest): PlannerRange | null {
  const url = new URL(request.url);
  if (url.pathname !== '/api/v1/planner/items') return null;
  return {
    start: Date.parse(url.searchParams.get('start_date') ?? ''),
    end: Date.parse(url.searchParams.get('end_date') ?? ''),
  };
}

export interface PlannerGate {
  /** Pass this as the `plannerGate` of the scenario. */
  hold(request: RecordedRequest): Promise<void> | undefined;
  /** Answers every held request and every later one. */
  release(): void;
  /** The planner requests held so far. */
  readonly held: readonly PlannerRange[];
}

/**
 * Holds the planner requests that `match` selects until `release`. Requests for other ranges
 * answer at once, so a test controls which part of a long span has loaded.
 */
export function holdPlanner(match: (range: PlannerRange) => boolean): PlannerGate {
  let open = false;
  let release = (): void => undefined;
  const opened = new Promise<void>((resolve) => {
    release = resolve;
  });
  const held: PlannerRange[] = [];
  return {
    hold(request) {
      const range = plannerRangeOf(request);
      if (open || range === null || !match(range)) return undefined;
      held.push(range);
      return opened;
    },
    release() {
      open = true;
      release();
    },
    held,
  };
}
