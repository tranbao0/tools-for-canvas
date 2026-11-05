// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { createScrollKeeper } from './scrollKeeper';

/** A container whose first child holds an open shadow root with a day list inside. */
function list(): { container: HTMLElement; region: HTMLElement } {
  const container = document.createElement('div');
  const host = document.createElement('div');
  const root = host.attachShadow({ mode: 'open' });
  const region = document.createElement('div');
  region.className = 'wr-scroll';
  root.append(region);
  container.append(host);
  document.body.append(container);
  return { container, region };
}

describe('the scroll keeper', () => {
  it('records the live position when it is told to, with no scroll event yet', () => {
    const { container, region } = list();
    const keeper = createScrollKeeper(container);
    keeper.track();
    // The position is set, and the scroll event of it has not arrived.
    region.scrollTop = 200;
    keeper.capture();
    region.scrollTop = 0;
    keeper.restore();
    expect(region.scrollTop).toBe(200);
    keeper.stop();
  });

  it('records the position from a scroll event', () => {
    const { container, region } = list();
    const keeper = createScrollKeeper(container);
    keeper.track();
    region.scrollTop = 120;
    region.dispatchEvent(new Event('scroll'));
    region.scrollTop = 0;
    keeper.restore();
    expect(region.scrollTop).toBe(120);
    keeper.stop();
  });

  it('leaves a region that is hidden out of the capture', () => {
    const { container, region } = list();
    const keeper = createScrollKeeper(container);
    keeper.track();
    region.scrollTop = 90;
    keeper.capture();
    region.hidden = true;
    region.scrollTop = 0;
    keeper.capture();
    region.hidden = false;
    keeper.restore();
    expect(region.scrollTop).toBe(90);
    keeper.stop();
  });
});
