import { describe, expect, it } from 'vitest';
import type { AnnouncementPageNode, AnnouncementTopic } from '../../../shared/canvas/types';
import { MAX_LIST_MESSAGE_CHARS, rowFromNode, rowFromTopic, webAddress } from './announcementRows';

const ORIGIN = 'https://school.instructure.com';

describe('webAddress', () => {
  it('gives an absolute http or https address, and resolves a path on Canvas', () => {
    expect(webAddress('https://cdn.example.org/a.png', ORIGIN)).toBe(
      'https://cdn.example.org/a.png',
    );
    expect(webAddress('http://cdn.example.org/a.png', ORIGIN)).toBe('http://cdn.example.org/a.png');
    expect(webAddress('/images/messages/avatar-50.png', ORIGIN)).toBe(
      `${ORIGIN}/images/messages/avatar-50.png`,
    );
  });

  it('drops another scheme, an empty or broken address and a very long one', () => {
    for (const bad of [
      'javascript:alert(1)',
      'data:image/png;base64,AAAA',
      'blob:https://school.instructure.com/x',
      'ftp://example.org/a.png',
      '',
      'http://',
      null,
      42,
      `https://example.org/${'a'.repeat(2_100)}`,
    ]) {
      expect(webAddress(bad, ORIGIN), String(bad)).toBeNull();
    }
  });

  it('drops a page of Canvas as an image, because a GET of a topic page marks it as read', () => {
    for (const page of [
      `${ORIGIN}/courses/101/discussion_topics/31901`,
      '/courses/101/discussion_topics/31901',
      `${ORIGIN}/api/v1/users/self`,
      `${ORIGIN}/`,
      `${ORIGIN}/courses/101/assignments/9`,
      `${ORIGIN}/images/../courses/101/discussion_topics/1`,
    ]) {
      expect(webAddress(page, ORIGIN), page).toBeNull();
    }
  });

  it('keeps a file, an equation image or an asset of Canvas', () => {
    for (const path of [
      '/images/thumbnails/12/abc',
      '/users/5/files/9/download?verifier=x',
      '/courses/101/files/9/preview',
      '/equation_images/x',
      '/dist/images/avatar.png',
    ]) {
      expect(webAddress(`${ORIGIN}${path}`, ORIGIN), path).toBe(`${ORIGIN}${path}`);
    }
  });

  it('does not apply the rule of Canvas to another host', () => {
    const other = 'https://cdn.example.org/courses/101/discussion_topics/31901';
    expect(webAddress(other, ORIGIN)).toBe(other);
  });
});

describe('the projection of a row', () => {
  const node: AnnouncementPageNode = {
    id: '1',
    courseId: '101',
    courseName: 'BIO 110',
    title: 'Title',
    createdAt: '2026-10-20T15:00:00Z',
    authorName: 'Dr. Rivera',
    avatarUrl: `${ORIGIN}/courses/101/discussion_topics/2`,
    message: 'm'.repeat(MAX_LIST_MESSAGE_CHARS + 10),
    read: false,
  };

  it('drops the avatar of a node that names a topic page, and cuts the message', () => {
    const row = rowFromNode(node, ORIGIN);
    expect(row?.avatarUrl).toBeNull();
    expect(row?.message).toHaveLength(MAX_LIST_MESSAGE_CHARS);
  });

  it('drops a node with an id that is no Canvas id', () => {
    expect(rowFromNode({ ...node, id: '1/read' }, ORIGIN)).toBeNull();
    expect(rowFromNode({ ...node, courseId: '../x' }, ORIGIN)).toBeNull();
  });

  it('drops the avatar of a REST topic that names a topic page, too', () => {
    const topic: AnnouncementTopic = {
      id: '5',
      title: 'T',
      message: null,
      posted_at: '2026-10-20T15:00:00Z',
      context_code: 'course_101',
      author: { display_name: 'A', avatar_image_url: `${ORIGIN}/courses/101/discussion_topics/9` },
    };
    const names = new Map([['101', 'BIO 110']]);
    expect(rowFromTopic(topic, names, ORIGIN)?.avatarUrl).toBeNull();
    expect(
      rowFromTopic(
        { ...topic, author: { avatar_image_url: `${ORIGIN}/images/thumbnails/1/a` } },
        names,
        ORIGIN,
      )?.avatarUrl,
    ).toBe(`${ORIGIN}/images/thumbnails/1/a`);
    expect(rowFromTopic({ ...topic, context_code: 'course_999' }, names, ORIGIN)).toBeNull();
  });
});
