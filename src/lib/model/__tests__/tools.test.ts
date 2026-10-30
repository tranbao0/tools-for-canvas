import { describe, expect, it } from 'vitest';
import { classifyHandIn } from '../../../features/weekly-list/model/handin';
import { registrableLabel, toolNameFromUrl } from '../../../features/weekly-list/model/tools';

describe('toolNameFromUrl', () => {
  it.each([
    ['https://www.gradescope.com/auth/lti1p3/launch', 'Gradescope'],
    ['https://connect.mheducation.com/lti/launch', 'McGraw Hill Connect'],
    ['https://lti.mheducation.com/x', 'McGraw Hill Connect'],
    ['https://mylabmastering.pearson.com/lti', 'Pearson'],
    ['https://www.pearsoned.com/x', 'Pearson'],
    ['https://www.mathxl.com/x', 'Pearson'],
    ['https://lti.cengage.com/launch', 'Cengage'],
    ['https://www.webassign.net/v4cgi/lti', 'WebAssign'],
    ['https://learn.zybooks.com/lti', 'zyBooks'],
    ['https://education.wiley.com/lti', 'Wiley'],
    ['https://www.wileyplus.com/lti', 'Wiley'],
    ['https://achieve.macmillanlearning.com/lti', 'Macmillan Achieve'],
    ['https://api.turnitin.com/lti/1p3', 'Turnitin'],
    ['https://lti.turnitinuk.com/x', 'Turnitin'],
  ])('names %s as %s', (url, name) => {
    expect(toolNameFromUrl(url)).toBe(name);
  });

  it('makes a readable name from an unknown host', () => {
    expect(toolNameFromUrl('https://app.perusall.com/lti/launch')).toBe('Perusall');
    expect(toolNameFromUrl('https://lti.top-hat.co.uk/launch')).toBe('Top Hat');
    expect(toolNameFromUrl('https://edpuzzle.com')).toBe('Edpuzzle');
  });

  it('returns null for a missing, relative or non-web URL', () => {
    expect(toolNameFromUrl(null)).toBeNull();
    expect(toolNameFromUrl(undefined)).toBeNull();
    expect(toolNameFromUrl('')).toBeNull();
    expect(toolNameFromUrl('/courses/1/external_tools/2')).toBeNull();
    expect(toolNameFromUrl('javascript:alert(1)')).toBeNull();
    expect(toolNameFromUrl('https://10.0.0.1/launch')).toBeNull();
  });

  it('finds the site label under two-part suffixes', () => {
    expect(registrableLabel('lti.example.co.uk')).toBe('example');
    expect(registrableLabel('example.com')).toBe('example');
    expect(registrableLabel('localhost')).toBe('localhost');
  });
});

describe('classifyHandIn', () => {
  const base = { is_quiz_lti_assignment: false, external_tool_tag_attributes: null };

  it.each([
    [['online_upload'], 'canvas'],
    [['online_text_entry', 'online_url'], 'canvas'],
    [['media_recording'], 'canvas'],
    [['student_annotation'], 'canvas'],
    [['online_quiz'], 'canvas'],
    [['discussion_topic'], 'canvas'],
    [['external_tool'], 'outside'],
    [['on_paper'], 'outside'],
    [['none'], 'none'],
    [['not_graded'], 'none'],
    [['attendance'], 'none'],
    [['wiki_page'], 'none'],
    [[], 'canvas'],
  ] as const)('classifies %j as %s', (types, handIn) => {
    expect(classifyHandIn({ ...base, submission_types: [...types] }).handIn).toBe(handIn);
  });

  it('counts a New Quiz as On Canvas', () => {
    const info = classifyHandIn({
      submission_types: ['external_tool'],
      is_quiz_lti_assignment: true,
      external_tool_tag_attributes: {
        url: 'https://school.quiz-lti-iad-prod.instructure.com/lti/launch',
      },
    });
    expect(info).toEqual({ handIn: 'canvas', toolName: null, onPaper: false });
  });

  it('names the tool of external tool work', () => {
    const info = classifyHandIn({
      submission_types: ['external_tool'],
      is_quiz_lti_assignment: false,
      external_tool_tag_attributes: { url: 'https://www.gradescope.com/lti' },
    });
    expect(info).toEqual({ handIn: 'outside', toolName: 'Gradescope', onPaper: false });
  });

  it('marks on-paper work', () => {
    expect(classifyHandIn({ ...base, submission_types: ['on_paper'] })).toEqual({
      handIn: 'outside',
      toolName: null,
      onPaper: true,
    });
  });

  it('prefers On Canvas when types mix methods', () => {
    expect(
      classifyHandIn({ ...base, submission_types: ['on_paper', 'online_upload'] }).handIn,
    ).toBe('canvas');
    expect(classifyHandIn({ ...base, submission_types: ['none', 'on_paper'] }).handIn).toBe(
      'outside',
    );
  });
});
