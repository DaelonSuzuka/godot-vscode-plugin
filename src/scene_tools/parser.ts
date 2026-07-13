import * as fs from "node:fs";
import { basename, extname } from "node:path";
import { TextDocument, Uri } from "vscode";
import { interpret_scene } from "../tscn/scene";
import { createLogger } from "../utils";
import { Scene, SceneNode } from "./types";

const log = createLogger("scenes.parser");

interface CacheEntry {
	scene: Scene;
	mtime: number;
	version: number;
}

export class SceneParser {
	private static instance: SceneParser;
	public scenes: Map<string, Scene> = new Map();
	private cache: Map<string, CacheEntry> = new Map();

	constructor() {
		if (SceneParser.instance) {
			// biome-ignore lint/correctness/noConstructorReturn: <explanation>
			return SceneParser.instance;
		}
		SceneParser.instance = this;
	}

	public parse_scene(document: TextDocument): Scene {
		const filePath = document.uri.fsPath;
		let mtime = 0;
		try {
			mtime = fs.statSync(filePath).mtimeMs;
		} catch {
			// untitled/virtual documents have no file behind them
		}

		// valid only for the same file state AND the same buffer state —
		// document.version catches unsaved edits that mtime cannot see
		const cached = this.cache.get(filePath);
		if (cached && cached.mtime === mtime && cached.version === document.version) {
			return cached.scene;
		}

		const scene = new Scene();
		scene.path = filePath;
		scene.mtime = mtime;
		scene.title = basename(filePath);
		this.scenes.set(filePath, scene);
		this.cache.set(filePath, { scene, mtime, version: document.version });

		const text = document.getText();
		let data: ReturnType<typeof interpret_scene>;
		try {
			data = interpret_scene(text);
		} catch (e) {
			// mid-edit files can be transiently unparseable; an empty scene is
			// better than a stale or crashed provider
			log.warn(`failed to parse ${filePath}: ${e}`);
			return scene;
		}
		for (const warning of data.warnings) {
			log.debug(`${filePath}: ${warning}`);
		}
		scene.index = data.index;

		for (const [id, res] of data.externalResources) {
			scene.externalResources.set(id, { ...res, index: res.offset });
		}
		for (const [id, res] of data.subResources) {
			scene.subResources.set(id, { ...res, index: res.offset });
		}

		const nodesByPath: Record<string, SceneNode> = {};
		for (const [path, n] of data.nodes) {
			const node = new SceneNode(n.name, n.type);
			node.path = path;
			node.description = n.type;
			node.relativePath = n.relativePath;
			node.parent = n.parentPath;
			node.text = n.header;
			node.position = n.offset;
			node.body = n.body;
			node.resourceUri = Uri.from({ scheme: "godot", path });

			if (n.instanceId) {
				const res = scene.externalResources.get(n.instanceId);
				if (res) {
					node.tooltip = res.path;
					node.resourcePath = res.path;
					if (extname(node.resourcePath) === ".tscn") {
						node.contextValue += "openable";
					}
				}
				node.contextValue += "hasResourcePath";
			}

			node.parse_body();

			// parsed values win over parse_body's line regexes
			node.unique = n.uniqueNameInOwner;
			if (n.scriptId) {
				node.hasScript = true;
				node.scriptId = n.scriptId;
				if (!node.contextValue?.includes("hasScript")) {
					node.contextValue += "hasScript";
				}
			}

			scene.nodes.set(path, node);
			if (path === data.rootPath) {
				scene.root = node;
			}
			if (n.parentPath in nodesByPath) {
				nodesByPath[n.parentPath].children.push(node);
			}
			nodesByPath[path] = node;
		}

		return scene;
	}
}
