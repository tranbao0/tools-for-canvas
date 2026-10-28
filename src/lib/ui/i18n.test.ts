import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import messages from '../../public/_locales/en/messages.json';
import { formatMessage, resetI18nForTests, t, tp } from '../i18n';

afterEach(() => {
  resetI18nForTests();
});

describe('t', () => {
  it('reads the bundled English text when the browser API is not implemented', () => {
    expect(t('extName')).toBe('Tools for Canvas');
    expect(t('timesIn', 'ET')).toBe('Times in ET');
    expect(t('ringLabelPastDue', 'BIO 101', '3', '5', '1')).toBe(
      'BIO 101: 3 of 5 done this week, 1 past due',
    );
  });

  it('uses browser.i18n.getMessage when it works', () => {
    const getMessage = vi
      .spyOn(fakeBrowser.i18n, 'getMessage')
      .mockImplementation((name: string) =>
        name === 'extName' ? 'Tools for Canvas' : `native:${name}`,
      );
    resetI18nForTests();
    expect(t('thisWeek')).toBe('native:thisWeek');
    expect(getMessage).toHaveBeenCalledWith('thisWeek', []);
  });

  it('falls back to the bundle when the browser returns no text', () => {
    vi.spyOn(fakeBrowser.i18n, 'getMessage').mockImplementation((name: string) =>
      name === 'extName' ? 'Tools for Canvas' : '',
    );
    resetI18nForTests();
    expect(t('thisWeek')).toBe('This week');
  });
});

describe('tp', () => {
  it('picks the plural form with Intl.PluralRules', () => {
    expect(tp('hiddenCourses', 1)).toBe('1 course hidden');
    expect(tp('hiddenCourses', 2)).toBe('2 courses hidden');
    expect(tp('hiddenCourses', 0)).toBe('0 courses hidden');
    expect(tp('undoSkippedAll', 3)).toBe('Skipped 3 older items');
  });
});

describe('formatMessage', () => {
  it('resolves named placeholders, direct positions and a literal dollar sign', () => {
    const entry = {
      message: 'Pay $$5 to $WHO$ for $1',
      placeholders: { who: { content: '$2' } },
    };
    expect(formatMessage(entry, ['lunch', 'Sam'])).toBe('Pay $5 to Sam for lunch');
  });

  it('does not expand placeholders inside substituted text', () => {
    expect(formatMessage({ message: 'Hi $1' }, ['$2'])).toBe('Hi $2');
  });
});

describe('messages.json', () => {
  const entries = Object.entries(
    messages as Record<string, { message: string; placeholders?: object }>,
  );

  it('keeps the manifest keys', () => {
    expect(Object.keys(messages)).toEqual(
      expect.arrayContaining(['extName', 'extDescription', 'actionTitle']),
    );
  });

  it('defines every placeholder that a message uses', () => {
    for (const [key, entry] of entries) {
      const used = [...entry.message.matchAll(/\$([A-Za-z0-9_]+)\$/g)].map((m) =>
        (m[1] ?? '').toLowerCase(),
      );
      const defined = Object.keys(entry.placeholders ?? {});
      expect(defined.sort(), key).toEqual([...new Set(used)].sort());
    }
  });

  it('has an _other form for every _one form', () => {
    for (const [key] of entries) {
      if (key.endsWith('_one'))
        expect(Object.keys(messages), key).toContain(key.replace(/_one$/, '_other'));
    }
  });

  it('uses no em dash', () => {
    expect(JSON.stringify(messages)).not.toContain('\u2014');
  });
});
