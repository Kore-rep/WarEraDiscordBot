import {
  resolveEthicLabel,
  ETHIC_SLASH_CHOICES,
} from '../../../src/commands/scanFor/country/partyEthicsMapping';

describe('resolveEthicLabel', () => {
  it('resolves an axis label to an axis target', () => {
    expect(resolveEthicLabel('Fanatic Industrialist')).toEqual({
      kind: 'axis',
      axis: 'industrialism',
      value: 2,
    });
    expect(resolveEthicLabel('Pacifist')).toEqual({
      kind: 'axis',
      axis: 'militarism',
      value: -1,
    });
  });

  it('resolves the unethical/ethical labels to a boolean target', () => {
    expect(resolveEthicLabel('Unethical')).toEqual({ kind: 'unethical', value: true });
    expect(resolveEthicLabel('Ethical')).toEqual({ kind: 'unethical', value: false });
  });

  it('returns undefined for unknown labels', () => {
    expect(resolveEthicLabel('Nonsense')).toBeUndefined();
  });
});

describe('ETHIC_SLASH_CHOICES', () => {
  it('includes the axis labels plus Unethical/Ethical and stays within Discord\'s 25-choice limit', () => {
    const names = ETHIC_SLASH_CHOICES.map(c => c.name);
    expect(names).toContain('Unethical');
    expect(names).toContain('Ethical');
    expect(names).toContain('Fanatic Industrialist');
    expect(ETHIC_SLASH_CHOICES.length).toBe(18);
    expect(ETHIC_SLASH_CHOICES.length).toBeLessThanOrEqual(25);
  });

  it('is sorted alphabetically', () => {
    const names = ETHIC_SLASH_CHOICES.map(c => c.name);
    expect([...names].sort((a, b) => a.localeCompare(b))).toEqual(names);
  });
});
