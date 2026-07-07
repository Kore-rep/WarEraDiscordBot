import { ApiError } from 'warera-sdk';

const MAX_RESPONSE_LENGTH = 500;

/**
 * Extract a human-readable message from an API error response body.
 */
function extractResponseMessage(data: unknown): string | undefined {
  if (data === null || data === undefined) {
    return undefined;
  }

  if (typeof data === 'string') {
    return truncate(data);
  }

  if (typeof data === 'object') {
    const record = data as Record<string, unknown>;

    if (typeof record.message === 'string' && record.message.length > 0) {
      return truncate(record.message);
    }

    const json = record.json;
    if (json !== null && json !== undefined && typeof json === 'object') {
      const nested = json as Record<string, unknown>;
      if (typeof nested.message === 'string' && nested.message.length > 0) {
        return truncate(nested.message);
      }
    }

    try {
      return truncate(JSON.stringify(data));
    } catch {
      return undefined;
    }
  }

  return truncate(String(data));
}

function truncate(value: string): string {
  if (value.length <= MAX_RESPONSE_LENGTH) {
    return value;
  }
  return `${value.slice(0, MAX_RESPONSE_LENGTH)}...`;
}

function isGenericHttpStatusMessage(message: string): boolean {
  return /request failed with status code \d+/i.test(message);
}

/**
 * Format an error for logging, including URL and response message when available.
 */
export function formatErrorForLog(error: unknown): string {
  if (error instanceof ApiError) {
    const responseMessage = extractResponseMessage(error.details);
    const message =
      responseMessage && isGenericHttpStatusMessage(error.message)
        ? responseMessage
        : responseMessage
          ? `${error.message}; ${responseMessage}`
          : error.message;

    const parts = [message];
    if (error.status !== undefined) {
      parts.push(`status=${error.status}`);
    }
    if (error.url) {
      parts.push(`url=${error.url}`);
    }
    return parts.join(' | ');
  }

  const axiosLike = error as {
    message?: string;
    config?: { url?: string };
    response?: { status?: number; data?: unknown };
  };

  if (axiosLike.response) {
    const responseMessage = extractResponseMessage(axiosLike.response.data);
    const baseMessage = axiosLike.message ?? 'Request failed';
    const message =
      responseMessage && isGenericHttpStatusMessage(baseMessage)
        ? responseMessage
        : responseMessage
          ? `${baseMessage}; ${responseMessage}`
          : baseMessage;

    const parts = [message];
    if (axiosLike.response.status !== undefined) {
      parts.push(`status=${axiosLike.response.status}`);
    }
    if (axiosLike.config?.url) {
      parts.push(`url=${axiosLike.config.url}`);
    }
    return parts.join(' | ');
  }

  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}
