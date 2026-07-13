import {
  approveId,
  cancelVerifyId,
  denyId,
  LINK_MODAL_ID,
  LINK_START_ID,
  parseAutoroleCustomId,
  verifyDmId,
} from '../../../src/services/autorole/reviewMessages';

describe('autorole customId round-trip', () => {
  it('parses every builder output', () => {
    expect(parseAutoroleCustomId(LINK_START_ID)).toEqual({ action: 'linkstart' });
    expect(parseAutoroleCustomId(LINK_MODAL_ID)).toEqual({ action: 'linkmodal' });
    expect(parseAutoroleCustomId(verifyDmId('srv1'))).toEqual({ action: 'verifydm', arg: 'srv1' });
    expect(parseAutoroleCustomId(cancelVerifyId('srv1'))).toEqual({ action: 'cancelverify', arg: 'srv1' });
    expect(parseAutoroleCustomId(approveId('user1'))).toEqual({ action: 'approve', arg: 'user1' });
    expect(parseAutoroleCustomId(denyId('user1'))).toEqual({ action: 'deny', arg: 'user1' });
  });

  it('rejects foreign and malformed ids', () => {
    expect(parseAutoroleCustomId('countrygroup-x')).toBeNull();
    expect(parseAutoroleCustomId('autorole:unknown')).toBeNull();
    expect(parseAutoroleCustomId('autorole:approve:')).toBeNull();
  });
});
