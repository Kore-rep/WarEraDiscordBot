/**
 * Cache TTL for the /scanfor country builds user sweep. The command and its
 * pagination/summary buttons re-fetch the same country's entire user set on
 * every click; ten minutes keeps clicks nearly free (cached batches consume no
 * rate limit) while the underlying analysis stays reasonably fresh.
 */
export const BUILDS_SWEEP_CACHE_TTL_MS = 10 * 60 * 1000;
