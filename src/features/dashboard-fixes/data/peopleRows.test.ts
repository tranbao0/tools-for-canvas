import { describe, expect, it } from 'vitest';
import type { PeoplePageNode } from '../../../shared/canvas/types';
import { MAX_ENROLLMENTS, rowFromPerson } from './peopleRows';

const ORIGIN = 'https://school.instructure.com';
const WANTED = new Set(['101', '102']);

function person(patch: Partial<PeoplePageNode> = {}): PeoplePageNode {
  return {
    id: '7001',
    name: 'Dr. Maya Okafor',
    avatarUrl: null,
    enrollments: [{ courseId: '101', courseName: 'BIO 110', type: 'TeacherEnrollment' }],
    ...patch,
  };
}

describe('rowFromPerson', () => {
  it('keeps the id, the name, the avatar and each enrollment with its role', () => {
    const row = rowFromPerson(
      person({
        avatarUrl: 'https://cdn.example.org/a.png',
        enrollments: [
          { courseId: '101', courseName: 'BIO 110', type: 'TeacherEnrollment' },
          { courseId: '102', courseName: 'MATH 221', type: 'TaEnrollment' },
        ],
      }),
      WANTED,
      ORIGIN,
    );
    expect(row).toEqual({
      id: '7001',
      name: 'Dr. Maya Okafor',
      avatarUrl: 'https://cdn.example.org/a.png',
      enrollments: [
        { courseId: '101', courseName: 'BIO 110', role: 'teacher' },
        { courseId: '102', courseName: 'MATH 221', role: 'ta' },
      ],
    });
  });

  it('limits every text', () => {
    const row = rowFromPerson(
      person({
        name: 'n'.repeat(5_000),
        enrollments: [
          { courseId: '101', courseName: 'c'.repeat(5_000), type: 'TeacherEnrollment' },
        ],
      }),
      WANTED,
      ORIGIN,
    );
    expect(row?.name).toBe('n'.repeat(300));
    expect(row?.enrollments[0]?.courseName).toBe('c'.repeat(300));
  });

  it('applies the avatar rule: only a file or asset of Canvas, or another host', () => {
    expect(rowFromPerson(person({ avatarUrl: '/images/a.png' }), WANTED, ORIGIN)?.avatarUrl).toBe(
      `${ORIGIN}/images/a.png`,
    );
    for (const bad of [
      'javascript:alert(1)',
      'data:image/png;base64,AAAA',
      `${ORIGIN}/courses/101/discussion_topics/1`,
      '/users/self',
    ]) {
      expect(rowFromPerson(person({ avatarUrl: bad }), WANTED, ORIGIN)?.avatarUrl, bad).toBeNull();
    }
  });

  it('drops a row with no Canvas id and a row with no usable enrollment', () => {
    for (const bad of ['', '7/1', '../users/self']) {
      expect(rowFromPerson(person({ id: bad }), WANTED, ORIGIN), bad).toBeNull();
    }
    expect(rowFromPerson(person({ enrollments: [] }), WANTED, ORIGIN)).toBeNull();
    expect(
      rowFromPerson(
        person({ enrollments: [{ courseId: '101', courseName: 'x', type: 'StudentEnrollment' }] }),
        WANTED,
        ORIGIN,
      ),
    ).toBeNull();
  });

  it('drops an enrollment of a course that the session does not hold or with a bad id', () => {
    const row = rowFromPerson(
      person({
        enrollments: [
          { courseId: '999', courseName: 'Other', type: 'TeacherEnrollment' },
          { courseId: '1/2', courseName: 'Bad', type: 'TeacherEnrollment' },
          { courseId: '102', courseName: 'MATH 221', type: 'TeacherEnrollment' },
        ],
      }),
      WANTED,
      ORIGIN,
    );
    expect(row?.enrollments.map((enrollment) => enrollment.courseId)).toEqual(['102']);
  });

  it('reads at most the first enrollments of a person', () => {
    const many = Array.from({ length: MAX_ENROLLMENTS + 20 }, () => ({
      courseId: '101',
      courseName: 'BIO 110',
      type: 'TeacherEnrollment',
    }));
    expect(rowFromPerson(person({ enrollments: many }), WANTED, ORIGIN)?.enrollments).toHaveLength(
      MAX_ENROLLMENTS,
    );
  });
});
