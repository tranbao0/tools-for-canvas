import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { hasAccess, onAccessChanged, requestAccess } from './permissions';
import { installFakePermissions, type FakePermissions } from './testing/fakes';

let permissions: FakePermissions;

beforeEach(() => {
  fakeBrowser.reset();
  permissions = installFakePermissions(['https://*/*']);
});

describe('hasAccess', () => {
  it.each(['https://school.instructure.com', 'https://canvas.school.edu'])(
    'is true for %s under the access to all https sites',
    async (origin) => {
      expect(await hasAccess(origin)).toBe(true);
    },
  );

  it('asks the browser about the pattern of the origin', async () => {
    await hasAccess('https://canvas.school.edu:8443');
    expect(permissions.contains).toHaveBeenCalledWith({
      origins: ['https://canvas.school.edu/*'],
    });
  });

  it('is false when the browser withholds the access, and true when it is given back', async () => {
    permissions.revoke('https://*/*');
    expect(await hasAccess('https://canvas.school.edu')).toBe(false);
    permissions.grant('https://canvas.school.edu/*');
    expect(await hasAccess('https://canvas.school.edu')).toBe(true);
    expect(await hasAccess('https://other.school.edu')).toBe(false);
  });

  it('is false for text that is not an origin, without asking the browser', async () => {
    expect(await hasAccess('not an origin')).toBe(false);
    expect(permissions.contains).not.toHaveBeenCalled();
  });
});

describe('requestAccess', () => {
  it('calls permissions.request synchronously, before the function returns', () => {
    const pending = requestAccess('https://canvas.school.edu');

    expect(permissions.request).toHaveBeenCalledTimes(1);
    expect(permissions.request).toHaveBeenCalledWith({ origins: ['https://canvas.school.edu/*'] });
    return expect(pending).resolves.toBe(true);
  });

  it('returns the browser promise', async () => {
    permissions.request.mockResolvedValueOnce(false);
    expect(await requestAccess('https://canvas.school.edu')).toBe(false);
  });

  it('resolves to false for text that is not an origin', async () => {
    expect(await requestAccess('nope')).toBe(false);
    expect(permissions.request).not.toHaveBeenCalled();
  });
});

describe('onAccessChanged', () => {
  it('reports added and removed permissions until it is stopped', () => {
    const listener = vi.fn();
    const stop = onAccessChanged(listener);

    permissions.grant('https://canvas.school.edu/*');
    permissions.revoke('https://canvas.school.edu/*');
    permissions.onAdded.trigger({ permissions: ['cookies'] });

    expect(listener).toHaveBeenCalledTimes(3);

    stop();
    permissions.grant('https://other.school.edu/*');
    expect(listener).toHaveBeenCalledTimes(3);
    expect(permissions.onAdded.hasListeners()).toBe(false);
    expect(permissions.onRemoved.hasListeners()).toBe(false);
  });
});
