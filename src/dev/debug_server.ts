import * as http from "node:http";
import * as vscode from "vscode";
import { globals } from "../extension";
import { is_debug_mode } from "../utils";

/**
 * Development-only HTTP server that exposes the extension's internal state
 * for inspection and scripting. Gated behind VSCODE_DEBUG_MODE=true.
 *
 * This is a dev/test tool, not a production feature. It runs inside the
 * extension host process and provides:
 *
 *   GET  /                     → server info + available endpoints
 *   GET  /state                → dump of major subsystem states
 *   GET  /debugger             → debugger subsystem state
 *   GET  /debugger/scene-tree  → parsed scene tree (if available)
 *   GET  /debugger/inspector   → inspector state (if available)
 *   GET  /debugger/variables?frame=0&scope=locals  → cached variable state
 *   POST /eval                 → eval arbitrary code in extension context
 *
 * The eval endpoint is the agent-friendly backdoor: it lets a test or
 * interactive dev session call any internal API directly.
 */

const DEFAULT_PORT = 7331;

let outputChannel: vscode.OutputChannel | undefined;

function get_log(): (msg: string) => void {
	if (!outputChannel) {
		outputChannel = vscode.window.createOutputChannel("Godot Tools Dev Server");
	}
	return (msg: string) => {
		const line = `[${new Date().toISOString()}] ${msg}`;
		outputChannel!.appendLine(line);
		console.log(`[dev/debug_server] ${msg}`);
	};
}

function get_port(): number {
	const env = process.env.GODOT_TOOLS_DEBUG_PORT;
	if (env) {
		const n = Number(env);
		if (Number.isInteger(n) && n > 0 && n < 65536) return n;
	}
	return DEFAULT_PORT;
}

function safe(fn: () => any): any {
	try {
		return fn();
	} catch (err) {
		return { error: err instanceof Error ? err.message : String(err) };
	}
}

function serialize(obj: any, depth = 0): any {
	if (depth > 5) return "[max depth]";
	if (obj === null || obj === undefined) return obj;
	if (typeof obj === "function") return `[Function: ${obj.name || "anonymous"}]`;
	if (typeof obj !== "object") return obj;

	// Avoid circular references
	if ((obj as any).__seen) return "[circular]";
	(obj as any).__seen = true;

	let result: any;
	if (Array.isArray(obj)) {
		result = obj.map((item) => serialize(item, depth + 1));
	} else {
		const ctor = obj.constructor?.name;
		result = { __type: ctor, ...Object.fromEntries(
			Object.entries(obj)
				.filter(([k]) => !k.startsWith("_") && k !== "__seen")
				.slice(0, 50)
				.map(([k, v]) => [k, serialize(v, depth + 1)])
		) };
	}

	delete (obj as any).__seen;
	return result;
}

export class DebugServer {
	private server?: http.Server;
	public port: number = 0;

	private log = get_log();

	public start(): Promise<number> {
		if (!is_debug_mode()) {
			return Promise.resolve(0);
		}

		const port = get_port();

		return new Promise((resolve, reject) => {
			this.server = http.createServer((req, res) => {
				this.handle(req, res);
			});

			this.server.on("error", (err: Error) => {
				this.log(`error on port ${port}: ${err.message}`);
				reject(err);
			});

			this.server.listen(port, "127.0.0.1", () => {
				this.port = port;
				this.log(`listening on http://127.0.0.1:${this.port}`);
				resolve(this.port);
			});
		});
	}

	public stop(): void {
		this.server?.close();
		this.server = undefined;
		this.log("stopped");
	}

	private handle(req: http.IncomingMessage, res: http.ServerResponse) {
		const url = req.url || "/";
		const [path, queryStr] = url.split("?");
		const query = new URLSearchParams(queryStr || "");

		this.log(`${req.method} ${path}`);

		try {
			if (path === "/" && req.method === "GET") {
				this.json(res, this.info());
			} else if (path === "/state" && req.method === "GET") {
				this.json(res, this.state());
			} else if (path === "/debugger" && req.method === "GET") {
				this.json(res, this.debugger_state());
			} else if (path === "/debugger/scene-tree" && req.method === "GET") {
				this.json(res, this.scene_tree());
			} else if (path === "/debugger/inspector" && req.method === "GET") {
				this.json(res, this.inspector());
			} else if (path === "/debugger/variables" && req.method === "GET") {
				this.json(res, this.variables(query));
			} else if (path === "/reload" && req.method === "POST") {
				this.reload(res);
			} else if (path === "/eval" && req.method === "POST") {
				this.eval_body(req, res);
			} else {
				this.json(res, { error: "not found", path }, 404);
			}
		} catch (err) {
			this.json(res, { error: err instanceof Error ? err.message : String(err) }, 500);
		}
	}

	private info() {
		return {
			endpoints: [
				"GET  /                     → server info",
				"GET  /state                → dump of major subsystem states",
				"GET  /debugger             → debugger subsystem state",
				"GET  /debugger/scene-tree  → parsed scene tree",
				"GET  /debugger/inspector   → inspector state",
				"GET  /debugger/variables?frame=0&scope=locals",
				"POST /reload               → reload the extension (recompile + reactivate)",
				"POST /eval                 → eval code in extension context",
			],
		};
	}

	private state() {
		return safe(() => ({
			globals: {
				hasLsp: !!globals.lsp,
				hasDebug: !!globals.debug,
				hasScenePreview: !!globals.scenePreviewProvider,
				hasFormatter: !!globals.formattingProvider,
			},
			debugger: this.debugger_state(),
		}));
	}

	private debugger_state() {
		return safe(() => {
			const dbg = globals.debug;
			if (!dbg) return { error: "debugger not initialized" };
			const session = dbg.session;
			return {
				hasSession: !!session,
				sessionType: session?.constructor?.name,
				sceneTree: safe(() => ({
					hasRoot: !!dbg.sceneTree,
					rootLabel: dbg.sceneTree?.["root"]?.label,
				})),
				inspector: safe(() => ({
					hasRoot: !!dbg.inspector,
				})),
				controller: safe(() => ({
					className: session?.["controller"]?.constructor?.name,
					hasSocket: !!session?.["controller"]?.["socket"],
					threadId: session?.["controller"]?.["threadId"],
					projectVersion: session?.["controller"]?.["projectVersionMajor"] != null
						? `${session["controller"]["projectVersionMajor"]}.${session["controller"]["projectVersionMinor"]}.${session["controller"]["projectVersionPoint"]}`
						: undefined,
				})),
				variablesManager: safe(() => !!session?.["variables_manager"]),
			};
		});
	}

	private scene_tree() {
		return safe(() => {
			const root = globals.debug?.sceneTree?.["root"];
			if (!root) return { error: "no scene tree available" };
			return serialize(root);
		});
	}

	private inspector() {
		return safe(() => {
			const root = globals.debug?.inspector?.["root"];
			if (!root) return { error: "no inspector available" };
			return serialize(root);
		});
	}

	private variables(query: URLSearchParams) {
		return safe(() => {
			const session = globals.debug?.session;
			if (!session) return { error: "no debug session" };
			const vm = session["variables_manager"];
			if (!vm) return { error: "no variables manager (not at a breakpoint?)" };
			const frame = Number(query.get("frame") ?? 0);
			const scope = query.get("scope"); // "locals" | "members" | "globals"
			return {
				frame,
				scope,
				note: "variables manager exists, use /eval for detailed inspection",
			};
		});
	}

	private reload(res: http.ServerResponse) {
		require("vscode").commands.executeCommand("workbench.action.reloadWindow");
	}

	private eval_body(req: http.IncomingMessage, res: http.ServerResponse) {
		let body = "";
		req.on("data", (chunk) => { body += chunk; });
		req.on("end", () => {
			try {
				const { code } = JSON.parse(body);
				if (typeof code !== "string") {
					this.json(res, { error: "expected { code: string }" }, 400);
					return;
				}
				// Eval in a context with access to globals and vscode
				const fn = new Function("globals", "vscode", `return (${code})`);
				const result = fn(globals, require("vscode"));
				this.json(res, { result: serialize(result) });
			} catch (err) {
				this.json(res, { error: err instanceof Error ? err.message : String(err) }, 500);
			}
		});
	}

	private json(res: http.ServerResponse, data: any, status = 200) {
		res.writeHead(status, { "Content-Type": "application/json" });
		res.end(JSON.stringify(data, null, 2));
	}
}