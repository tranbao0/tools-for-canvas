import { describe, expect, it, vi } from 'vitest';
import { createCatcherRequest } from './catcherRequest';

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function gate() {
  const answers: (() => void)[] = [];
  const ask = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        answers.push(resolve);
      }),
  );
  return { answers, ask };
}

describe('the request for the file catcher', () => {
  it('asks at once, and for one more after the answer when loads came meanwhile', async () => {
    const { answers, ask } = gate();
    const request = createCatcherRequest(ask, () => true);
    request();
    request();
    request();
    expect(ask).toHaveBeenCalledTimes(1);
    answers[0]!();
    await vi.waitFor(() => expect(ask).toHaveBeenCalledTimes(2));
    answers[1]!();
    await flush();
    expect(ask).toHaveBeenCalledTimes(2);
    request();
    expect(ask).toHaveBeenCalledTimes(3);
  });

  it('goes on after a refused ask, and asks for nothing while it is not live', async () => {
    let live = true;
    const ask = vi.fn().mockRejectedValueOnce(new Error('refused')).mockResolvedValue(undefined);
    const request = createCatcherRequest(ask, () => live);
    request();
    await flush();
    request();
    expect(ask).toHaveBeenCalledTimes(2);
    live = false;
    await flush();
    request();
    expect(ask).toHaveBeenCalledTimes(2);
  });
});
