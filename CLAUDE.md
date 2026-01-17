# grokathon-london-2026 Development Rules

## Critical Rules (MUST Follow)

### Type Safety
- **No `any` or `unknown`** except with documented exceptions and biome-ignore comment
- Use `as const satisfies` for type-safe const arrays
- Infer types from Drizzle schemas: `typeof table.$inferSelect`, `typeof table.$inferInsert`
- Exhaustive switch with `never`:
  ```typescript
  default:
    const _exhaustive: never = value;
    throw new Error(`Unhandled case: ${_exhaustive}`);
  ```

### Validation
- **Always use Zod** for input validation - no exceptions
- Validate at API boundaries (tRPC input, REST body parsing)
- Use `z.enum()` for finite value sets, not string unions
- Infer TypeScript types from Zod: `z.infer<typeof schema>`

### Database Schema
Tables should have:
- `id` - UUID primary key (`uuid().defaultRandom().primaryKey()`)
- `createdAt` - timestamp, `defaultNow().notNull()`
- `updatedAt` - timestamp, `defaultNow().notNull().$onUpdate(() => new Date())`

### Adding Dependencies
Never add a dependency directly to any package.json:
- Run `pnpm add <package>`, or ask the user to run it

---

## Monorepo Structure
- Shared code in `packages/`
- Apps in `apps/` (server, web)
- Use workspace protocol: `"@margin-v2/api": "workspace:*"`
- Run commands from root: `pnpm --filter <package> <command>`

### Commands
```bash
pnpm check-types    # TypeScript type checking
pnpm run check      # Biome linter
pnpm dev            # Start dev servers
```

---

## Code Style

### Enums Over Booleans
**Never use boolean flags** - use string literal unions:

```typescript
// BAD
isAdmin: boolean

// GOOD
role: "admin" | "member" | "viewer"
status: "active" | "pending" | "suspended"
```

### Early Returns (Guard Clauses)
```typescript
// BAD - deep nesting
if (user) {
  if (user.isActive) {
    // do thing
  }
}

// GOOD - early returns
if (!user) return null;
if (!user.isActive) throw new Error("Inactive");
// do thing
```

### No Magic Strings/Numbers
```typescript
// BAD
setTimeout(fn, 604800000);

// GOOD
const SESSION_DURATION_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
```

### No Floating Promises
```typescript
// BAD
someAsyncFn();

// GOOD
await someAsyncFn();
void someAsyncFn(); // explicit fire-and-forget
```

---

## Styling

- Use shadcn/ui with **Base UI primitives** (not Radix)
- Use `cn()` helper for conditional classes (Tailwind)
- Support light AND dark mode - never break either
- Follow existing component patterns in `apps/web/src/components/ui/`
- Use `cva()` for variant-based styling

---

## Git & Workflow

- Conventional commits: `feat:`, `fix:`, `chore:`, `docs:`
- Run `pnpm check-types` before committing
