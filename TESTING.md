# Testing Guide

## Overview

The WarEra Discord Bot includes a comprehensive test suite with **43 tests** covering all critical functionality. Tests are written using Jest and TypeScript.

## Running Tests

```bash
# Run all tests
npm test

# Run tests in watch mode (auto-rerun on changes)
npm run test:watch

# Run tests with coverage report
npm run test:coverage
```

## Test Results

```
✅ Test Suites: 5 passed, 5 total
✅ Tests:       43 passed, 43 total
✅ Snapshots:   0 total
```

## Test Coverage

### Unit Tests

#### 1. BattleTracker Tests (`tests/services/battle/BattleTracker.test.ts`)
Tests the battle state tracking and change detection logic:

- ✅ Detect new battles
- ✅ Detect pool increases (attacker and defender)
- ✅ **Do NOT detect pool decreases** (critical requirement)
- ✅ Detect bounty increases
- ✅ Detect bounty decreases
- ✅ Ignore when values stay the same
- ✅ Maintain change history across multiple updates
- ✅ Identify old battles for cleanup
- ✅ Track battle count
- ✅ Clear all tracked battles

**Key Test Cases:**
```typescript
// Pool increases are detected
battle.attacker.moneyPool = 150; // was 100
changes = tracker.detectChanges([battle]);
expect(changes[0].changeType).toBe('pool_increased');

// Pool decreases are NOT detected
battle.attacker.moneyPool = 50; // was 100
changes = tracker.detectChanges([battle]);
expect(changes).toHaveLength(0); // No change reported!
```

#### 2. BattleFormatter Tests (`tests/services/battle/BattleFormatter.test.ts`)
Tests the message formatting logic:

- ✅ Format basic battle messages
- ✅ Include change indicators (New Battle, Pool Increased, etc.)
- ✅ Include change history log
- ✅ Stay under 2000 character limit (with auto-trimming)
- ✅ Truncate long country/region names
- ✅ Handle missing country/region data
- ✅ Include damage and points bars with emojis

**Key Test Cases:**
```typescript
// Very long change history gets trimmed
const changeHistory = Array.from({ length: 100 }, ...);
const message = formatter.formatBattleMessage(battle, ..., changeHistory);
expect(message.length).toBeLessThanOrEqual(2000); // Always fits!
```

#### 3. MessageTracker Tests (`tests/services/discord/MessageTracker.test.ts`)
Tests the Discord message ID tracking:

- ✅ Store and retrieve message IDs
- ✅ Handle multiple servers
- ✅ Handle multiple battles per server
- ✅ Overwrite existing message IDs
- ✅ Remove battle tracking
- ✅ Get all tracked battles for a server
- ✅ Clear all tracking for a server

**Key Test Cases:**
```typescript
// Multi-server tracking
tracker.setMessageId('server1', 'battle1', 'message1');
tracker.setMessageId('server2', 'battle1', 'message2');
expect(tracker.getMessageId('server1', 'battle1')).toBe('message1');
expect(tracker.getMessageId('server2', 'battle1')).toBe('message2');
```

#### 4. Config Tests (`tests/config/config.test.ts`)
Tests the configuration loading and validation:

- ✅ Load valid configuration
- ✅ Validate required environment variables (DISCORD_TOKEN, POLLING_INTERVAL_MINUTES)
- ✅ Parse servers.json correctly
- ✅ Throw errors for missing/invalid configuration
- ✅ Handle servers with no role IDs

**Key Test Cases:**
```typescript
// Missing required env var
delete process.env.DISCORD_TOKEN;
expect(() => loadConfig()).toThrow('DISCORD_TOKEN environment variable is required');

// Invalid polling interval
process.env.POLLING_INTERVAL_MINUTES = 'invalid';
expect(() => loadConfig()).toThrow('POLLING_INTERVAL_MINUTES must be a positive number');
```

### Integration Tests

#### 5. BattleService Integration Tests (`tests/integration/BattleService.integration.test.ts`)
Tests how services work together:

- ✅ Process new battles and update Discord
- ✅ Don't update Discord when no changes detected
- ✅ Handle API errors gracefully
- ✅ Continue processing other servers if one fails
- ✅ Clean up old battle messages
- ✅ Handle cleanup errors gracefully
- ✅ Track battle count

**Key Test Cases:**
```typescript
// New battle triggers Discord update
await battleService.processBattles();
expect(mockDiscordService.updateBattleMessage).toHaveBeenCalledWith(
  'server1', ['role1'], '1', expect.any(String)
);

// No changes = no Discord updates
await battleService.processBattles(); // First call
await battleService.processBattles(); // Second call, no changes
expect(mockDiscordService.updateBattleMessage).not.toHaveBeenCalled();
```

## Test Philosophy

### Mocking Strategy
- **External APIs**: Discord API and WarEra API are mocked
- **File System**: fs module is mocked for config tests
- **Logger**: Logger is mocked to avoid console spam

### Test Isolation
- Each test suite is independent
- Tests use `beforeEach` to reset state
- Mocks are cleared between tests

### Coverage Goals
- High coverage of critical paths
- Focus on business logic and edge cases
- Integration tests verify service interactions

## Adding New Tests

When adding new features, follow this pattern:

1. **Create test file**: `tests/services/<category>/<ServiceName>.test.ts`
2. **Mock dependencies**: Use Jest mocks for external dependencies
3. **Test success cases**: Verify expected behavior
4. **Test failure cases**: Verify error handling
5. **Test edge cases**: Empty arrays, null values, etc.

### Example Test Template

```typescript
import { YourService } from '../../../src/services/your/YourService';

jest.mock('../../../src/utils/logger', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

describe('YourService', () => {
  let service: YourService;

  beforeEach(() => {
    service = new YourService();
  });

  describe('yourMethod', () => {
    it('should do something', () => {
      const result = service.yourMethod();
      expect(result).toBe(expectedValue);
    });

    it('should handle errors', () => {
      expect(() => service.yourMethod()).toThrow('Expected error');
    });
  });
});
```

## Continuous Integration

Tests should be run:
- ✅ Before committing code
- ✅ In CI/CD pipeline
- ✅ Before deploying to production

## Test Exclusion from Docker

Tests are excluded from Docker builds via `.dockerignore`:

```
tests
coverage
jest.config.js
*.test.ts
*.spec.ts
```

This keeps the Docker image small and focused on production code.

## Coverage Reports

Coverage reports are generated in the `coverage/` directory:

- `coverage/lcov-report/index.html` - HTML coverage report
- `coverage/lcov.info` - LCOV format for CI tools
- `coverage/` - Text summary in console

Open `coverage/lcov-report/index.html` in a browser to view detailed coverage.

## Troubleshooting Tests

### Tests fail with "Cannot find module"
- Run `npm install` to ensure all dependencies are installed
- Check that file paths in imports are correct

### Tests timeout
- Increase Jest timeout in test file: `jest.setTimeout(10000)`
- Check for unresolved promises

### Mocks not working
- Ensure mocks are defined before imports
- Use `jest.clearAllMocks()` in `beforeEach`
- Check mock implementation matches actual interface

