# AGENTS.md - Agent Coding Guidelines

This document provides guidelines for agents operating in this repository.

## Project Overview

- **Name**: mmx-cli
- **Type**: Node.js CLI tool (ESM, Bun-native)
- **Engine**: Node.js 18+
- **Language**: TypeScript (strict mode)

## Commands

### Build, Lint, Test

```bash
# Build for production
bun run build

# Build for development (faster, non-minified)
bun run build:dev

# Run development (direct execution)
bun run dev

# Lint (ESLint + TypeScript-eslint)
bun run lint

# Type check (TypeScript)
bun run typecheck

# Run all tests
bun test

# Run tests in watch mode
bun test --watch

# Run a single test file
bun test test/commands/auth/login.test.ts

# Run tests matching a pattern
bun test --grep "auth login"
```

### Publishing

- Releases are tag-driven; see `docs/releasing.md`.
- Do not change `package.json` from its `0.0.0-dev` development version for a release.

## Code Style

### TypeScript

- **Strict mode**: Always enabled (`strict: true` in tsconfig.json)
- **No explicit `any`**: Avoid `any`; use `unknown` if type is truly unknown
- **Unused variables**: Prefix with `_` if intentionally unused (e.g., `_unused: string`)

### Imports

- Use ES modules (`import ... from '...'`)
- Order: external → internal → relative
- Group by: imports → types → constants → logic

```typescript
// 1. External imports
import { foo } from 'external-package';
import type { SomeType } from 'external-package';

// 2. Internal absolute imports
import { registry } from './registry';
import type { Config } from './config/schema';

// 3. Relative imports (if any)
```

### File Naming

- **Files**: `kebab-case.ts`
- **Directories**: `kebab-case/`
- **Test files**: `*.test.ts` (co-located with source or in `test/`)

### Function/Variable Naming

- **Functions**: `camelCase` (e.g., `loadConfig`, `checkForUpdate`)
- **Constants**: `SCREAMING_SNAKE_CASE` (e.g., `REGIONS`, `CLI_VERSION`)
- **Interfaces/Types**: `PascalCase` (e.g., `Command`, `Config`, `GlobalFlags`)
- **Enums**: `PascalCase` for both enum and members

### Error Handling

- Use custom error hierarchy: `src/errors/` (base.ts, api.ts, codes.ts, handler.ts)
- Always catch and handle errors appropriately
- Use `handleError` for CLI exit scenarios

```typescript
// Preferred pattern
async function myCommand(config: Config, flags: GlobalFlags): Promise<void> {
  try {
    await doSomething();
  } catch (error) {
    if (error instanceof ApiError) {
      // Handle API error
    }
    throw error;
  }
}
```

### Async/Await

- Always `await` promises; never use `.then()` chain
- Handle async errors with try/catch in async functions

### Configuration

- Use Zod for config schema validation (see `src/config/schema.ts`)
- Define options with `OptionDef` interface (see `src/command.ts`)

### Output

- Use provided output utilities: `src/output/` (text.ts, json.ts, progress.ts, etc.)
- Respect `--output` flag for format selection
- Use `--quiet` to suppress non-essential output

### Testing

- Use Bun's built-in test runner (`bun test`)
- Co-locate tests in `test/` directory
- Use descriptive test names: `it('should do X when Y')`
- Mock external dependencies as needed

```typescript
import { describe, it, expect, mock } from 'bun:test';

describe('auth/login', () => {
  it('should login successfully', () => {
    expect(true).toBe(true);
  });
});
```

### Git Conventions

- Commit message format: `<type>: <description>`
- Types: `feat`, `fix`, `refactor`, `test`, `docs`, `chore`
- Keep commits atomic and focused

### Blind Review

- After implementation, send the full diff to two independent reviewers. Give them only the requirements, acceptance criteria, and task boundaries; do not reveal the implementation intent or the other reviewer's findings.
- Fix confirmed issues with scoped changes, then repeat the two independent reviews.
- Once reviews converge and only small corrections remain, use one blind reviewer.
- If review and fixes stop converging, pause patching and reconsider the design as a whole. Stop and report the unresolved issue if redesign does not resolve it.

## Project Structure

```
src/
├── auth/           # Authentication (login, oauth, refresh, credentials)
├── client/         # HTTP client, endpoints, streaming
├── command.ts      # Command interface and definitions
├── commands/       # Command implementations (auth/, config/, video/, etc.)
├── config/         # Config loading, schema, region detection
├── errors/         # Error handling (base, api, codes, handler)
├── output/         # Output formatters (text, json, progress, audio, etc.)
├── polling/        # Long-polling utilities
├── types/          # Type definitions (api, commands, flags)
├── utils/          # Utilities (fs, token, env, prompt, schema)
├── update/         # Self-update checker
├── args.ts         # Argument parsing
├── main.ts         # CLI entry point
└── registry.ts     # Command registry
```

## Key Patterns

### Defining a Command

```typescript
import type { CommandSpec } from './command';

export const myCommand: CommandSpec = {
  name: 'my-command',
  description: 'Does something useful',
  options: [
    { flag: '--option <value>', description: 'An option', type: 'string' },
  ],
  run: async (config, flags) => {
    // Implementation
  },
};
```

### API Calls

```typescript
import { http } from '../client/http';

const response = await http.request('/endpoint', {
  method: 'POST',
  body: JSON.stringify(payload),
  headers: { 'Content-Type': 'application/json' },
});
```

## Common Tasks

- **Add a new command**: Create `src/commands/<category>/<command>.ts`, register in `src/registry.ts`
- **Add config option**: Update `src/config/schema.ts` and `src/command.ts`
- **Add API endpoint**: Update `src/client/endpoints.ts`
- **Add error code**: Update `src/errors/codes.ts`
