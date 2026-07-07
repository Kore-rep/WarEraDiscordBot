import { ApiError } from 'warera-sdk';
import { formatErrorForLog } from '../../src/utils/formatError';

describe('formatErrorForLog', () => {
  it('formats ApiError with url, status, and response message', () => {
    const error = new ApiError(
      'Request failed with status code 400',
      400,
      { message: 'Invalid country id' },
      'https://api.example.com/country.getCountryById'
    );

    expect(formatErrorForLog(error)).toBe(
      'Invalid country id | status=400 | url=https://api.example.com/country.getCountryById'
    );
  });

  it('formats axios-style errors with url and response body', () => {
    const error = {
      message: 'Request failed with status code 400',
      config: { url: 'https://api.example.com/battle.getBattles' },
      response: {
        status: 400,
        data: { message: 'Invalid cursor' },
      },
    };

    expect(formatErrorForLog(error)).toBe(
      'Invalid cursor | status=400 | url=https://api.example.com/battle.getBattles'
    );
  });

  it('falls back to Error.message for generic errors', () => {
    expect(formatErrorForLog(new Error('Something broke'))).toBe('Something broke');
  });
});
