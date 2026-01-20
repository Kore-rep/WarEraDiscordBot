---
globs:
alwaysApply: false
---

# API Client Usage Rules

## Singleton Pattern - CRITICAL

**ALWAYS use the singleton API clients from `ApiService`:**

- **Standard client**: Use `apiService.getClient()` for single, non-batched requests
- **Batch client**: Use `apiService.getBatchClient()` for batch operations (NOT `createBatchClient()`)

**Why singletons matter:**
- **Cache sharing**: Both clients share the same `InMemoryCacheProvider` instance, ensuring cache hits across all operations
- **Rate limit tracking**: Rate limits are tracked correctly across all batch operations when using the singleton
- **Consistency**: Single source of truth for API client configuration (baseUrl, apiKey, rate limits)

**NEVER create new API clients** using `createAPI()` directly. Always access through `ApiService` methods.

## Batch Optimization Rules

### When to Use Batch Client

Use the batch client (`getBatchClient()`) when:
1. Making **multiple independent API requests** that don't depend on each other's results
2. Making **2 or more sequential requests** where request 2+ doesn't depend on request 1
3. Processing **arrays of items** that require individual API calls (e.g., fetching details for multiple countries, companies, users)

### Batch Rate Limit Benefits

**Key optimization**: A batched request with up to 100 requests counts as **only 1 request** toward the rate limit.

**Examples:**
- Fetching 50 countries individually = 50 rate limit requests
- Fetching 50 countries in a batch = 1 rate limit request (98% reduction!)
- Fetching 200 countries = 2 batch requests (instead of 200 individual requests)

### Batch Implementation Pattern

```typescript
// ✅ CORRECT: Use singleton batch client
const batchClient = apiService.getBatchClient();

// Queue all requests (they return promises)
const promises = items.map(item => 
  batchClient.someEndpoint.getData(item.id)
);

// Execute batch (all queued requests count as 1 rate limit request)
await batchClient.runBatch();

// Process results
const results = await Promise.all(promises);
```

### Batching Large Collections

When processing large collections (e.g., 200+ items):
- **Chunk into batches of up to 100** items per batch
- Each chunk counts as 1 rate limit request
- Process chunks sequentially or in parallel as needed

```typescript
const BATCH_SIZE = 100;
for (let i = 0; i < items.length; i += BATCH_SIZE) {
  const chunk = items.slice(i, i + BATCH_SIZE);
  const batchClient = apiService.getBatchClient();
  
  const promises = chunk.map(item => batchClient.endpoint.getData(item.id));
  await batchClient.runBatch();
  const results = await Promise.all(promises);
  // Process results...
}
```

## Independent Request Batching

**Always batch independent requests together:**

If you have:
```typescript
const battles = await client.battle.getBattles();  // Request 1
const regions = await client.region.getRegionsObject();  // Request 2 (independent)
```

**Optimize to:**
```typescript
const batchClient = apiService.getBatchClient();
const battlesPromise = batchClient.battle.getBattles();
const regionsPromise = batchClient.region.getRegionsObject();
await batchClient.runBatch();  // Both count as 1 request!
const [battles, regions] = await Promise.all([battlesPromise, regionsPromise]);
```

## Sequential vs Parallel Requests

**Sequential (dependent)**: Request 2 needs result from Request 1
- Use standard client: `apiService.getClient()`
- Cannot batch these together

**Parallel (independent)**: Requests don't depend on each other
- Use batch client: `apiService.getBatchClient()`
- Always batch these together to save rate limit requests

## Cache Considerations

- Both singleton clients share the same cache provider
- Cache TTL can be specified per request: `{ cache: { ttl: 86400 } }`
- Cache hits benefit all operations using the singleton clients
- Never create new clients as it breaks cache sharing

## Rate Limit Configuration

Current rate limit settings (in `ApiService`):
- `maxRequests: 200` per `windowMs: 60000` (1 minute)
- `backoffThreshold: 0.85` (85% capacity)
- `maxBackoffMs: 3000` (max 3 second backoff)

These settings apply to both singleton clients and are tracked correctly when using singletons.

## Anti-Patterns to Avoid

❌ **DON'T**: Create new batch clients
```typescript
const batchClient = createAPI({ batch: true, ... });  // WRONG!
```

❌ **DON'T**: Use `createBatchClient()` method (deprecated/removed)
```typescript
const batchClient = apiService.createBatchClient();  // WRONG!
```

❌ **DON'T**: Make sequential independent requests without batching
```typescript
const data1 = await client.endpoint1.get();  // Request 1
const data2 = await client.endpoint2.get();  // Request 2 (independent - should batch!)
```

✅ **DO**: Always use singleton clients
```typescript
const client = apiService.getClient();  // For single requests
const batchClient = apiService.getBatchClient();  // For batch operations
```

## Summary

1. **Always** use `apiService.getClient()` or `apiService.getBatchClient()` - never create new clients
2. **Always** batch independent requests together (saves rate limit usage)
3. **Always** batch multiple items (up to 100 per batch = 1 rate limit request)
4. **Never** create new API clients directly
5. **Never** make sequential independent requests without batching
