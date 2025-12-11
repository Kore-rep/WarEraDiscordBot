# WarEra Discord Bot - Test Suite

This directory contains comprehensive tests for the Discord bot.

## Test Structure

```
tests/
├── config/                     # Configuration tests
│   └── config.test.ts
├── services/
│   ├── battle/                 # Battle service tests
│   │   ├── BattleTracker.test.ts
│   │   └── BattleFormatter.test.ts
│   └── discord/                # Discord service tests
│       └── MessageTracker.test.ts
└── integration/                # Integration tests
    └── BattleService.integration.test.ts
```

## Running Tests

```bash
# Run all tests
npm test

# Run tests in watch mode
npm run test:watch

# Run tests with coverage
npm run test:coverage
```

## Test Coverage

The test suite covers:

### Unit Tests

#### BattleTracker
- ✅ Detect new battles
- ✅ Detect pool increases (NOT decreases)
- ✅ Detect bounty changes (increases and decreases)
- ✅ Maintain change history
- ✅ Identify old battles for cleanup
- ✅ Track battle count

#### BattleFormatter
- ✅ Format basic battle messages
- ✅ Include change indicators
- ✅ Include change history
- ✅ Stay under 2000 character limit
- ✅ Truncate long names
- ✅ Handle missing data
- ✅ Include damage and points bars

#### MessageTracker
- ✅ Store and retrieve message IDs
- ✅ Handle multiple servers
- ✅ Handle multiple battles per server
- ✅ Remove battle tracking
- ✅ Get tracked battles
- ✅ Clear server tracking

#### Config
- ✅ Load valid configuration
- ✅ Validate required environment variables
- ✅ Parse servers.json
- ✅ Handle invalid configurations

### Integration Tests

#### BattleService
- ✅ Process new battles and update Discord
- ✅ Don't update Discord when no changes detected
- ✅ Handle API errors gracefully
- ✅ Continue processing other servers if one fails
- ✅ Clean up old battle messages
- ✅ Track battle count

## Test Philosophy

- **Unit Tests**: Test individual components in isolation
- **Integration Tests**: Test how components work together
- **Mocking**: Mock external dependencies (Discord API, WarEra API, file system)
- **Coverage**: Aim for high coverage of critical paths

## Adding New Tests

When adding new features, please add corresponding tests:

1. Create a test file in the appropriate directory
2. Follow the existing naming convention (`*.test.ts`)
3. Mock external dependencies
4. Test both success and failure cases
5. Update this README with what's covered

## Notes

- Tests use Jest as the testing framework
- TypeScript support via ts-jest
- Tests are excluded from Docker builds (see `.dockerignore`)
- Coverage reports are generated in the `coverage/` directory

