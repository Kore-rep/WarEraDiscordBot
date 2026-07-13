import { computeNickname } from '../../../src/services/autorole/nickname';

describe('computeNickname', () => {
  it('formats username with MU name', () => {
    expect(computeNickname('Player', 'Assegai')).toBe('Player (Assegai)');
  });

  it('uses TBD when there is no MU', () => {
    expect(computeNickname('Player', undefined)).toBe('Player (TBD)');
  });

  it('clamps to the 32-character Discord limit', () => {
    const nick = computeNickname('AVeryLongWarEraUsernameIndeed', 'SomeLongUnitName');
    expect(nick.length).toBe(32);
    expect(nick).toBe('AVeryLongWarEraUsernameIndeed (S');
  });
});
