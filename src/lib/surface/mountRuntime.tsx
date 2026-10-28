/** Renders a surface runtime into an extension page. */
import { render, type VNode } from 'preact';
import type { SurfaceState } from '../model/types';
import type { InPlaceSettings, SurfaceRuntime } from './runtime';

/** Renders the runtime state and its settings on every change, and starts the runtime. */
export function mountRuntime(
  root: HTMLElement,
  runtime: SurfaceRuntime,
  view: (state: SurfaceState, settings: InPlaceSettings | undefined) => VNode,
): () => void {
  const draw = (): void => render(view(runtime.state(), runtime.settings()), root);
  runtime.subscribe(draw);
  draw();
  runtime.start();
  return draw;
}
