import { describe, expect, it } from 'vitest';
import {
  canAutoSaveOrigin,
  isInstructureHost,
  isTestOrBetaHost,
  isUsableOrigin,
  originMatchPattern,
} from './address';

describe('isUsableOrigin', () => {
  it.each([
    ['https://canvas.school.edu'],
    ['https://school.instructure.com'],
    ['https://canvas.school.edu:8443'],
    ['https://xn--caf-dma.example.edu'],
  ])('accepts %j', (origin) => {
    expect(isUsableOrigin(origin)).toBe(true);
  });

  it.each([
    [''],
    ['canvas.school.edu'],
    ['http://canvas.school.edu'],
    ['https://canvas.school.edu/'],
    ['https://canvas.school.edu/courses/12'],
    ['https://canvas.school.edu?x=1'],
    ['https://user:secret@canvas.school.edu'],
    ['https://canvas.school.edu.'],
    ['https://canvas..school.edu'],
    ['ftp://canvas.school.edu'],
    ['file:///home/me/canvas.html'],
    ['javascript:alert(1)'],
    ['chrome-extension://abc'],
    ['https://localhost'],
    ['https://localhost:3000'],
    ['https://canvas'],
    ['https://192.168.1.20'],
    ['https://10.0.0.1'],
    ['https://[::1]'],
    ['https://[2001:db8::1]'],
    ['not an origin'],
  ])('rejects %j', (origin) => {
    expect(isUsableOrigin(origin)).toBe(false);
  });
});

describe('isTestOrBetaHost', () => {
  it.each([
    ['https://school.test.instructure.com', true],
    ['https://school.beta.instructure.com', true],
    ['https://school.instructure.com', false],
    ['https://test.instructure.com', false],
    ['https://canvas.test.school.edu', false],
    ['not an origin', false],
  ])('%s gives %s', (origin, expected) => {
    expect(isTestOrBetaHost(origin)).toBe(expected);
  });
});

describe('isInstructureHost', () => {
  it.each([
    ['https://school.instructure.com', true],
    ['https://school.test.instructure.com', true],
    ['https://instructure.com', true],
    ['https://canvas.school.edu', false],
    ['https://notinstructure.com', false],
    ['https://instructure.com.evil.example', false],
    ['https://evil.example/instructure.com', false],
    ['not an origin', false],
  ])('%s gives %s', (origin, expected) => {
    expect(isInstructureHost(origin)).toBe(expected);
  });
});

describe('canAutoSaveOrigin', () => {
  it.each([['https://school.instructure.com'], ['https://school.instructure.com:8443']])(
    'saves %s when no address is saved',
    (origin) => {
      expect(canAutoSaveOrigin(origin, null)).toBe(true);
    },
  );

  it.each([
    ['a custom domain', 'https://canvas.school.edu'],
    ['a custom domain with a port', 'https://canvas.school.edu:8443'],
    ['a look-alike host', 'https://instructure.com.evil.example'],
    ['a look-alike subdomain', 'https://school.instructure.com.evil.example'],
  ])('never saves %s without the click of the student', (_name, origin) => {
    expect(canAutoSaveOrigin(origin, null)).toBe(false);
  });

  it('saves nothing when an address is saved, not even the same one again', () => {
    expect(
      canAutoSaveOrigin('https://other.instructure.com', 'https://school.instructure.com'),
    ).toBe(false);
    expect(
      canAutoSaveOrigin('https://school.instructure.com', 'https://school.instructure.com'),
    ).toBe(false);
  });

  it.each([
    ['https://school.test.instructure.com'],
    ['https://school.beta.instructure.com'],
    ['http://school.instructure.com'],
    ['https://192.168.1.20'],
    ['https://canvas'],
    ['chrome-extension://abc'],
    ['null'],
  ])('never saves %s without asking', (origin) => {
    expect(canAutoSaveOrigin(origin, null)).toBe(false);
  });
});

describe('originMatchPattern', () => {
  it('matches every page of the origin', () => {
    expect(originMatchPattern('https://canvas.school.edu')).toBe('https://canvas.school.edu/*');
  });

  it('leaves out the port, which match patterns do not need', () => {
    expect(originMatchPattern('https://canvas.school.edu:8443')).toBe(
      'https://canvas.school.edu/*',
    );
  });

  it('gives null for text that is not an origin', () => {
    expect(originMatchPattern('nope')).toBeNull();
  });
});
