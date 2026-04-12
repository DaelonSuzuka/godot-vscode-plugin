# Practices

## Code Style

- TypeScript with strict mode
- Biome for formatting (`biome.json`)
- Named exports preferred: `export class Foo {}` not `export { Foo }`
- Async/await preferred over raw promises

## Architecture Patterns

### Extension Singleton Pattern

The `globals` object in `extension.ts` serves as a simple dependency container:

```typescript
export const globals: Extension = {};

// In activate():
globals.lsp = new ClientConnectionManager(context);
globals.debug = new GodotDebugger(context);
```

All components access shared services via this singleton.

### Provider Pattern

Each language feature is implemented as a provider class:

```typescript
class GDHoverProvider implements vscode.HoverProvider {
  provideHover(doc, pos, token): vscode.Hover | undefined {
    // ...
  }
}
```

Providers are registered in `activate()` and subscribe via `context.subscriptions`.

### Godot Version Branching

The codebase handles Godot 3/4 differences by:

1. Separate directories under `src/debugger/godot3/` and `src/debugger/godot4/`
2. Runtime detection via `get_project_version()` reading `project.godot`
3. Conditional behavior based on major version

### LSP Communication

WebSocket-based communication with Godot editor:

```typescript
// Message flow
Client -> Server: Request (id, method, params)
Server -> Client: Response (id, result/error)
Server -> Client: Notification (method, params)
```

## Configuration

Settings are namespaced under `godotTools`:

```json
{
  "godotTools.editorPath.godot4": "godot",
  "godotTools.editorPath.godot3": "godot3",
  "godotTools.lsp.serverHost": "127.0.0.1",
  "godotTools.lsp.serverPort": 6008
}
```

## Testing

- Mocha test framework with `@vscode/test-electron`
- Test file naming: `*.test.ts`
- Snapshot testing for formatter in `src/formatter/snapshots/`

## Commands

Commands follow naming pattern: `godotTools.<category>.<action>`

Examples:
- `godotTools.openEditor` - Open Godot editor
- `godotTools.startLanguageServer` - Start LSP
- `godotTools.debugger.inspectNode` - Debug command