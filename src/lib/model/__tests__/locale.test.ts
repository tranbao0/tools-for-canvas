import { describe, expect, it } from 'vitest';
import { hourCycleFor, localeCandidates, resolveLocale, resolveWeekStartDay } from '../locale';

describe('resolveWeekStartDay', () => {
  it.each([
    ['en', 7],
    ['en-US', 7],
    ['en-CA', 7],
    ['en-GB', 1],
    ['en-AU', 1],
    ['en-GB-x-ukhe', 1],
    ['de', 1],
    ['de_AT', 1],
    ['fr', 1],
    ['fr-CA', 7],
    ['pt', 1],
    ['pt-BR', 7],
    ['es-ES', 1],
    ['sv-x-k12', 1],
    ['zh-Hans', 1],
    ['zh-Hant', 1],
    ['zh-TW', 7],
    ['zh-CN', 7],
    ['ja', 7],
    ['ko', 7],
    ['ar', 6],
    ['fa', 6],
    ['xx', 7],
    ['', 7],
  ] as const)('maps the Canvas locale %s to ISO day %i', (locale, expected) => {
    expect(resolveWeekStartDay('auto', locale)).toBe(expected);
  });

  it('uses the setting when it is not automatic', () => {
    expect(resolveWeekStartDay(1, 'en')).toBe(1);
    expect(resolveWeekStartDay(6, 'en-GB')).toBe(6);
    expect(resolveWeekStartDay(7, 'ar')).toBe(7);
  });
});

describe('hourCycleFor', () => {
  it.each([
    ['en', 'h12'],
    ['en-US', 'h12'],
    ['en-CA', 'h12'],
    ['en-GB', 'h23'],
    ['en-AU', 'h23'],
    ['de', 'h23'],
    ['fr-CA', 'h23'],
    ['ar', 'h23'],
    ['fa', 'h12'],
    ['ko', 'h12'],
    ['ja', 'h23'],
  ] as const)('uses the Canvas clock for %s', (locale, expected) => {
    expect(hourCycleFor(locale)).toBe(expected);
  });

  it('falls back to the locale data for a language that Canvas does not list', () => {
    expect(hourCycleFor('bg')).toBe('h23');
    expect(hourCycleFor('zh-TW')).toBe('h12');
    expect(hourCycleFor('ta')).toBe('h12');
  });

  it('uses the 12-hour clock for an invalid tag', () => {
    expect(hourCycleFor('not a locale!')).toBe('h12');
  });
});

describe('resolveLocale', () => {
  it('prefers effective_locale, then locale, then the browser language', () => {
    expect(resolveLocale({ effective_locale: 'en-GB', locale: 'de' }, 'fr')).toBe('en-GB');
    expect(resolveLocale({ effective_locale: '', locale: 'de' }, 'fr')).toBe('de');
    expect(resolveLocale({ effective_locale: '', locale: null }, 'fr')).toBe('fr');
    expect(resolveLocale({ effective_locale: '', locale: null })).toBe('en');
  });
});

describe('localeCandidates', () => {
  it('lists the tag from most to least specific', () => {
    expect(localeCandidates('en-GB-x-ukhe')).toEqual(['en-gb-x-ukhe', 'en-gb-x', 'en-gb', 'en']);
    expect(localeCandidates('pt_BR')).toEqual(['pt-br', 'pt']);
  });
});
