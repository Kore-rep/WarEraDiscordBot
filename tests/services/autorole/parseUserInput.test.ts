import { parseUserInput } from '../../../src/services/autorole/parseUserInput';

describe('parseUserInput', () => {
  it('returns null for empty input', () => {
    expect(parseUserInput('')).toBeNull();
    expect(parseUserInput('   ')).toBeNull();
  });

  it('recognizes 24-char hex ids', () => {
    expect(parseUserInput('6873d0ea1758b40e712b5f59')).toEqual({
      kind: 'id',
      value: '6873d0ea1758b40e712b5f59',
    });
  });

  it('recognizes numeric ids', () => {
    expect(parseUserInput('123456')).toEqual({ kind: 'id', value: '123456' });
  });

  it('extracts the id from profile URLs', () => {
    expect(parseUserInput('https://app.warera.io/user/6873d0ea1758b40e712b5f59')).toEqual({
      kind: 'id',
      value: '6873d0ea1758b40e712b5f59',
    });
  });

  it('extracts the id from locale-prefixed profile URLs', () => {
    expect(parseUserInput('https://warera.io/en/user/6873d0ea1758b40e712b5f59')).toEqual({
      kind: 'id',
      value: '6873d0ea1758b40e712b5f59',
    });
  });

  it('strips Discord <...> link wrapping', () => {
    expect(parseUserInput('<https://app.warera.io/user/abc123abc123abc123abc123>')).toEqual({
      kind: 'id',
      value: 'abc123abc123abc123abc123',
    });
  });

  it('treats URLs on other hosts as usernames', () => {
    expect(parseUserInput('https://example.com/user/abc')).toEqual({
      kind: 'username',
      value: 'https://example.com/user/abc',
    });
  });

  it('falls back to username', () => {
    expect(parseUserInput('SomePlayer')).toEqual({ kind: 'username', value: 'SomePlayer' });
  });
});
