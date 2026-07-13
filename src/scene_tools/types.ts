import { TreeItem, TreeItemCollapsibleState, MarkdownString, Uri } from "vscode";
import * as path from "node:path";
import type { TscnIndex } from "../tscn/parser";
import { get_extension_uri } from "../utils";

const iconDir = get_extension_uri("resources", "godot_icons").fsPath;

export class SceneNode extends TreeItem {
	public path: string;
	public relativePath: string;
	public resourcePath: string;
	public parent: string;
	public text: string;
	public position: number;
	public body: string;
	public unique = false;
	public hasScript = false;
	public scriptId = "";
	public children: SceneNode[] = [];
	/** how many instanced-scene grafts deep this node lives (0 = own scene) */
	public graftDepth = 0;

	/** deep-copy for grafting an instanced scene's tree under another scene's
	 * node — tree items must be unique objects, and cached scenes must not
	 * have their nodes mutated by the view */
	public clone(depth: number): SceneNode {
		const copy = new SceneNode(this.label, this.className);
		copy.path = this.path;
		copy.relativePath = this.relativePath;
		copy.resourcePath = this.resourcePath;
		copy.parent = this.parent;
		copy.text = this.text;
		copy.position = this.position;
		copy.body = this.body;
		copy.unique = this.unique;
		copy.hasScript = this.hasScript;
		copy.scriptId = this.scriptId;
		copy.description = this.description;
		copy.tooltip = this.tooltip;
		copy.contextValue = this.contextValue;
		copy.resourceUri = this.resourceUri;
		copy.graftDepth = depth;
		copy.children = this.children.map((c) => c.clone(depth));
		return copy;
	}

	constructor(
		public label: string,
		public className: string,
		public collapsibleState?: TreeItemCollapsibleState,
	) {
		super(label, collapsibleState);

		const iconName = `${className}.svg`;

		this.iconPath = {
			light: Uri.file(path.join(iconDir, "light", iconName)),
			dark: Uri.file(path.join(iconDir, "dark", iconName)),
		};
	}

	public parse_body() {
		const lines = this.body.split("\n");
		const newLines: string[] = [];
		for (let i = 0; i < lines.length; i++) {
			let line = lines[i];
			if (line.startsWith("tile_data")) {
				line = "tile_data = PoolIntArray(...)";
			}
			if (line.startsWith("unique_name_in_owner = true")) {
				this.unique = true;
			}
			if (line.startsWith("script = ExtResource")) {
				this.hasScript = true;
				this.scriptId = line.match(/script = ExtResource\(\s*"?([\w]+)"?\s*\)/)?.[1] ?? "";
				this.contextValue += "hasScript";
			}
			if (line !== "") {
				newLines.push(line);
			}
		}
		this.body = newLines.join("\n");
		const content = new MarkdownString();
		content.appendCodeblock(this.body, "gdresource");
		this.tooltip = content;
	}
}

export interface GDResource {
	path: string;
	type: string;
	id: string;
	uid: string;
	body: string;
	index: number;
	line: number;
}

export class Scene {
	public path: string;
	public title: string;
	public mtime: number;
	public root: SceneNode | undefined;
	public index: TscnIndex = { references: [], paths: [] };
	public externalResources: Map<string, GDResource> = new Map();
	public subResources: Map<string, GDResource> = new Map();
	public nodes: Map<string, SceneNode> = new Map();
}

export interface SceneResource {
	path: string;
	type: string;
	uid: string;
	id: string;
	index: number;
	line: number;
	body: string;
}
