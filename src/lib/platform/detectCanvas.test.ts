// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { isCanvasDocument } from './detectCanvas';

const HEAD_SCRIPT = `
  INST = {"environment":"production","allowMediaComments":true};
  ENV = {"current_user_id":"1","DOMAIN_ROOT_ACCOUNT_ID":"1"};
  BRANDABLE_CSS_HANDLEBARS_INDEX = [];
`;

function page(head: string, body: string): Document {
  const doc = document.implementation.createHTMLDocument('page');
  doc.head.innerHTML = head;
  doc.body.innerHTML = body;
  return doc;
}

afterEach(() => {
  document.head.innerHTML = '';
  document.body.innerHTML = '';
});

describe('isCanvasDocument', () => {
  it('finds the Canvas application root', () => {
    expect(isCanvasDocument(page('', '<div id="application" class="ic-app"></div>'))).toBe(true);
  });

  it('finds the head script that assigns INST and ENV, as on the bare layout', () => {
    expect(isCanvasDocument(page(`<script>${HEAD_SCRIPT}</script>`, '<div id="main"></div>'))).toBe(
      true,
    );
  });

  it('does not accept the ENV script alone, or the _csrf_token cookie', () => {
    document.head.innerHTML = '<script>ENV = {"LOGIN": true};</script>';
    document.cookie = '_csrf_token=abc%2Bdef; path=/';
    expect(isCanvasDocument(document)).toBe(false);
    document.cookie = '_csrf_token=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/';
  });

  it('rejects ordinary pages', () => {
    expect(isCanvasDocument(page('<title>News</title>', '<div id="application"></div>'))).toBe(
      false,
    );
    expect(isCanvasDocument(page('<script>window.ENV = window.ENV || {};</script>', ''))).toBe(
      false,
    );
    expect(isCanvasDocument(page('<script>var MY_INST = 1; var NOT_ENV = 2;</script>', ''))).toBe(
      false,
    );
  });

  it('checks the global document when called with no argument', () => {
    document.body.innerHTML = '<div id="application" class="ic-app"></div>';
    expect(isCanvasDocument()).toBe(true);
  });

  it('still works after the browser serializes it for scripting.executeScript', () => {
    const injected = new Function(`return (${isCanvasDocument.toString()});`)() as () => boolean;

    document.head.innerHTML = `<script>${HEAD_SCRIPT}</script>`;
    expect(injected()).toBe(true);
    document.head.innerHTML = '';
    expect(injected()).toBe(false);
  });
});
