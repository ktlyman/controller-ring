# CLAUDE.md

## Commands

- MUST run build before committing: `npm run build`
- MUST type-check before committing: `npx tsc --noEmit`
- MUST run tests before committing: `npm test`
- SHOULD lint before committing: `npm run lint`
- SHOULD use test watch during development: `npm run test:watch`
- MAY use dev mode for iterative work: `npm run dev`
- MAY start MCP server for agent integration: `npm run start:mcp`

## Architecture

This is a TypeScript MCP server that wraps `ring-client-api` to expose Ring smart home devices to AI agents.

- `src/client/` — Ring API wrapper and config loader; `RingClient` handles auth token persistence and refresh
- `src/devices/` — `DeviceManager` enumerates and controls cameras, doorbells, alarm, lights, sensors
- `src/events/` — `EventLogger` persists events via `EventStore`; `RealtimeMonitor` subscribes to live Ring push notifications (cameras, doorbells, alarm sensors) via RxJS; `CloudHistory` queries Ring's cloud-stored events and video recordings with optional `CloudCache`
- `src/logging/` — `RoutineLogger` records an audit trail of every command via `RoutineStore`
- `src/storage/` — SQLite persistence layer; `RingDatabase` manages the connection and schema migrations; `EventStore`, `RoutineStore`, and `CloudCache` provide table-specific read/write operations backed by `better-sqlite3`
- `src/tools/` — `RingEcosystemTool` orchestrates all modules into a single agent-facing interface
- `src/types/` — shared TypeScript type definitions
- `src/mcp-server.ts` — MCP server entry point exposing 15 tools over stdio
- `src/index.ts` — library exports and standalone CLI entry point
- `tests/` — Vitest unit tests covering storage (database, event-store, routine-store, cloud-cache), loggers, and real-time monitoring; `tests/helpers/test-db.ts` provides in-memory database factories

## Standards

### TypeScript

- MUST use ES module syntax (`import`/`export`); the project uses `"type": "module"` in package.json
- MUST use `.js` extensions in relative import paths (Node16 module resolution)
- MUST pass `npx tsc --noEmit` with zero errors before committing
- SHOULD keep strict mode enabled; instead of weakening `tsconfig.json`, fix the underlying type errors
- SHOULD use `type` imports (`import type { ... }`) for type-only references

### Code Organization

- MUST keep each module in its designated directory (`client/`, `devices/`, `events/`, `logging/`, `storage/`, `tools/`, `types/`)
- SHOULD add new MCP tools in `src/mcp-server.ts` using the `server.tool()` registration pattern
- SHOULD route device commands through `RingEcosystemTool` instead of calling `DeviceManager` directly, so that routine logging is preserved

### Style

- MUST NOT use `any` type; instead use `unknown` with type narrowing or define explicit interfaces
- SHOULD prefer `const` over `let`; instead of `var`, always use block-scoped declarations
- SHOULD NOT add inline comments for self-explanatory code; instead use JSDoc on public method signatures

### Error Handling

- MUST wrap MCP tool handler bodies in try/catch and return `{ isError: true }` on failure; instead of letting exceptions propagate, catch and format them
- MUST NOT expose raw stack traces in MCP tool responses; instead use the `errorMessage()` helper in `src/mcp-server.ts`
- SHOULD log routine failures via `RoutineLogger` before re-throwing from `RingEcosystemTool`

## Security

### Secrets and Credentials

- MUST NOT commit `.env` files or any file containing Ring refresh tokens; instead use `.env.example` as the template
- MUST NOT log or return refresh tokens in MCP tool responses or console output; instead redact sensitive fields before returning
- MUST NOT hardcode API keys, secrets, or passwords anywhere in the source code; instead load them from environment variables at runtime
- MUST store Ring credentials only via environment variables or the auto-managed token file (which is gitignored)

### Authentication

- MUST use OAuth2 refresh token flow for Ring API authentication; instead of storing passwords, use `npm run auth` to generate a token
- SHOULD rotate refresh tokens regularly; the `RingClient` persists new tokens automatically when Ring issues them

### Input Validation

- MUST validate and sanitize all user-supplied parameters in MCP tool handlers before passing them to the Ring API
- SHOULD treat Ring API responses as untrusted; instead of interpolating raw device data into shell commands, use structured data only

### Environment Configuration

- SHOULD reference `.env.example` for expected environment variable names; instead of hardcoding defaults, leave token values blank

## Testing

- MUST run `npm test` and confirm all tests pass before committing
- MUST add tests for new logic in `EventLogger`, `RoutineLogger`, or the storage layer (`EventStore`, `RoutineStore`, `CloudCache`)
- SHOULD place test files in `tests/` following the `<module>.test.ts` naming convention
- SHOULD use `createTestDatabase()` and the related helpers from `tests/helpers/test-db.ts` to create in-memory SQLite databases for tests
- MAY skip integration tests that require a live Ring account; instead mock the Ring API in unit tests
