// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OFFER_ARM_MS, OfferBanner } from './Notices';

const SCHOOL = { origin: 'https://canvas.school.edu' };
const EVIL = { origin: 'https://evil.example' };

beforeEach(() => vi.useFakeTimers());

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function show(offer = SCHOOL, mode: 'use' | 'switch' = 'use') {
  const onAccept = vi.fn();
  const onDismiss = vi.fn();
  const view = render(
    <OfferBanner offer={offer} mode={mode} onAccept={onAccept} onDismiss={onDismiss} />,
  );
  const again = (next: typeof SCHOOL) =>
    view.rerender(
      <OfferBanner offer={next} mode={mode} onAccept={onAccept} onDismiss={onDismiss} />,
    );
  return { onAccept, onDismiss, again };
}

function wait(ms: number): void {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

function accept(): HTMLElement {
  return screen.getByRole('button', { name: /^(Use it|Switch)$/ });
}

describe('OfferBanner', () => {
  it.each([['use'], ['switch']] as const)(
    'keeps the accept button of the %s offer off for a second, visibly',
    (mode) => {
      const { onAccept } = show(SCHOOL, mode);

      expect(accept().getAttribute('aria-disabled')).toBe('true');
      fireEvent.click(accept());
      wait(OFFER_ARM_MS - 1);
      fireEvent.click(accept());
      expect(onAccept).not.toHaveBeenCalled();

      wait(1);
      expect(accept().getAttribute('aria-disabled')).toBe('false');
      fireEvent.click(accept());
      expect(onAccept).toHaveBeenCalledTimes(1);
      expect(onAccept).toHaveBeenCalledWith(SCHOOL.origin);
    },
  );

  it('turns the button off again when a page replaces the offer with another host', () => {
    const { onAccept, again } = show();
    wait(OFFER_ARM_MS);
    expect(accept().getAttribute('aria-disabled')).toBe('false');
    const first = accept();

    again(EVIL);

    // The host is a new element, the button is a new element, and it is off.
    expect(screen.getByRole('region', { name: 'Use evil.example as your Canvas?' })).toBeTruthy();
    expect(accept()).not.toBe(first);
    expect(accept().getAttribute('aria-disabled')).toBe('true');
    // A click that was aimed at the old host lands on the new button and does nothing.
    fireEvent.click(accept());
    wait(OFFER_ARM_MS - 1);
    fireEvent.click(accept());
    expect(onAccept).not.toHaveBeenCalled();

    wait(1);
    fireEvent.click(accept());
    expect(onAccept).toHaveBeenCalledWith(EVIL.origin);
  });

  it('keeps the button on when the same host shows again', () => {
    const { onAccept, again } = show();
    wait(OFFER_ARM_MS);
    const first = accept();

    again({ origin: SCHOOL.origin });

    expect(accept()).toBe(first);
    fireEvent.click(accept());
    expect(onAccept).toHaveBeenCalledTimes(1);
  });

  it('keeps "Not now" on at all times', () => {
    const { onDismiss } = show();

    fireEvent.click(screen.getByRole('button', { name: 'Not now' }));

    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('stops the timer when the banner goes away', () => {
    const { onAccept } = show();
    cleanup();

    expect(() => wait(OFFER_ARM_MS * 2)).not.toThrow();
    expect(onAccept).not.toHaveBeenCalled();
  });
});
