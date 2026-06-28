# Contributing

### Building from source

#### Requirements

- [npm](https://www.npmjs.com/get-npm)
- [fgvm](https://fgvm.dev) — Godot version manager (for engine-in-the-loop tests)
- A Godot installation (via fgvm or manual) for running the extension against

#### Process

1. Open a command prompt/terminal and browse to the location of this repository on your local filesystem.
2. Download dependencies by using the command `npm install`
3. When done, package a VSIX file by using the command `npm run package`.
4. Install it by opening Visual Studio Code, opening the Extensions tab, clicking on the More actions (**...**) button in the top right, and choose **Install from VSIX...** and find the compiled VSIX file.

When developing for the extension, you can open this project in Visual Studio Code and debug the extension by using the **Run Extension** launch configuration instead of going through steps 3 and 4. It will launch a new instance of Visual Studio Code that has the extension running. You can then open a Godot project folder and debug the extension or GDScript debugger.

Additionally, if you create a `workspace.code-workspace` file, you can use the **Run Extension with workspace file** launch configuration to quickly change what folder your Extension Host is running in, and quickly change the settings passed to the debug environment

An example `workspace.code-workspace` file:
```jsonc
{
	"folders": [
		{
			// "path": "."
			"path": "P:/project1"
			// "path": "P:/project2"
			// "path": "P:/folder/project3"
		}
	],
    "settings": {
		"godotTools.editorPath.godot3": "godot3.dev.exe",
		"godotTools.editorPath.godot4": "godot4.dev.exe",
		// "godotTools.editorPath.godot4": "godot4.custom.exe"
		// "godotTools.editorPath.godot4": "Godot_v4.1.1-stable_win64.exe",
		"godotTools.lsp.headless": false
	}
}
```

### Testing

#### Unit tests (no engine required)

Formatter snapshot tests and pure TypeScript unit tests run without a Godot installation:

```bash
npm test
```

This launches a VS Code test instance and runs all tests in `out/**/*.test.js`. The formatter tests and utility tests don't need Godot, but the debugger integration tests do.

#### Engine-in-the-loop tests

Debugger integration tests launch a real Godot instance, set breakpoints, and inspect variables through the custom debug protocol. These require a Godot binary managed by [fgvm](https://fgvm.dev).

Install fgvm (see [fgvm.dev](https://fgvm.dev) for installation instructions), then install a Godot version:

```bash
fgvm install 4.7
```

Run the test suite against a specific Godot version:

```bash
npm run test:engine -- 4.7
```

Run only tests matching a name pattern:

```bash
npm run test:engine -- 4.7 "typed dict"
npm run test:engine -- 4.7 "built-in types"
```

Run against Godot 3:

```bash
fgvm install 3.6.2
npm run test:engine -- 3.6.2 --godot3
```

The test runner (`tools/run_tests.ts`) resolves the Godot binary from fgvm's installation directory, writes the correct `editorPath` setting into the test project, compiles the extension, and runs the test suite.

#### CI

CI runs a matrix of OS × Godot version (currently Ubuntu and Windows, against Godot 4.7 and 4.5.1). Godot installations are cached across runs using `actions/cache`. Adding a new engine version to CI is just adding a string to the `godot_version` matrix in `.github/workflows/ci.yml`.

### Development debug server

When the extension is running in debug mode (`VSCODE_DEBUG_MODE=true`, which the dev launch profiles set automatically), a development HTTP server starts on port 7331. This provides runtime inspection of the extension's internal state:

- `GET /state` — dump of major subsystem states (LSP, debugger, scene preview, formatter)
- `GET /debugger` — debugger subsystem state (session, controller, variables manager)
- `GET /debugger/scene-tree` — parsed scene tree
- `GET /debugger/inspector` — inspector state
- `POST /eval` — eval arbitrary code in extension context (`{"code": "globals.debug.constructor.name"}`)
- `POST /reload` — reload the VS Code window (picks up recompiled code)

This is a development tool, not a production feature. It's gated behind the debug flag and excluded from linting. See `src/dev/debug_server.ts`.