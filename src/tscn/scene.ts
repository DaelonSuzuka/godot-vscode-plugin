// Scene-level interpretation of a parsed .tscn/.tres file — vscode-free.
// Produces plain data; src/scene_tools adapts it to VS Code TreeItems.

import { parse_tscn, type TscnCall, type TscnSection, type TscnValue } from "./parser";

export interface ResourceData {
	id: string;
	type: string;
	path: string;
	uid: string;
	/** 1-based line of the section header (matches editor line numbers) */
	line: number;
	offset: number;
	/** raw text from the section header to the next section */
	body: string;
}

export interface NodeData {
	name: string;
	type: string;
	/** raw parent attribute ("" for root, "." for direct child of root) */
	rawParent: string | undefined;
	/** ExtResource id when this node instances another scene */
	instanceId: string | undefined;
	uniqueNameInOwner: boolean;
	/** ExtResource id of the attached script, if any */
	scriptId: string | undefined;
	/** computed absolute path within the scene (root name prefixed) */
	path: string;
	relativePath: string;
	parentPath: string;
	header: string;
	offset: number;
	line: number;
	/** raw text from the node header to the next section */
	body: string;
}

export interface SceneData {
	rootPath: string;
	nodes: Map<string, NodeData>;
	externalResources: Map<string, ResourceData>;
	subResources: Map<string, ResourceData>;
	warnings: string[];
}

function as_string(v: TscnValue | undefined): string {
	if (typeof v === "string") {
		return v;
	}
	if (typeof v === "number") {
		return String(v);
	}
	return "";
}

/** ExtResource("1_ab2") / SubResource(4) → the id as a string */
function call_id(v: TscnValue | undefined, name: string): string | undefined {
	if (v && typeof v === "object" && !Array.isArray(v) && !(v instanceof Map) && v.kind === "call") {
		const call = v as TscnCall;
		if (call.name === name && call.args.length > 0) {
			return as_string(call.args[0]);
		}
	}
	return undefined;
}

function make_resource(section: TscnSection, source: string): ResourceData {
	return {
		id: as_string(section.attributes.get("id")),
		type: as_string(section.attributes.get("type")),
		path: as_string(section.attributes.get("path")),
		uid: as_string(section.attributes.get("uid")),
		line: section.line + 1,
		offset: section.offset,
		body: source.slice(section.offset, section.endOffset).trimEnd(),
	};
}

export function interpret_scene(source: string): SceneData {
	const { sections, warnings } = parse_tscn(source);
	const scene: SceneData = {
		rootPath: "",
		nodes: new Map(),
		externalResources: new Map(),
		subResources: new Map(),
		warnings,
	};

	let rootName = "";
	for (const section of sections) {
		switch (section.tag) {
			case "ext_resource": {
				const res = make_resource(section, source);
				if (res.id !== "") {
					scene.externalResources.set(res.id, res);
				}
				break;
			}
			case "sub_resource": {
				const res = make_resource(section, source);
				if (res.id !== "") {
					scene.subResources.set(res.id, res);
				}
				break;
			}
			case "node": {
				const name = as_string(section.attributes.get("name")) || "unknown";
				const type = as_string(section.attributes.get("type")) || "PackedScene";
				const rawParentValue = section.attributes.get("parent");
				const rawParent = rawParentValue === undefined ? undefined : as_string(rawParentValue);

				let path = "";
				let relativePath = "";
				let parentPath = "";
				if (rawParent === undefined) {
					rootName = name;
					path = name;
				} else if (rawParent === ".") {
					parentPath = rootName;
					relativePath = name;
					path = `${rootName}/${name}`;
				} else {
					relativePath = `${rawParent}/${name}`;
					parentPath = `${rootName}/${rawParent}`;
					path = `${parentPath}/${name}`;
				}

				scene.nodes.set(path, {
					name,
					type,
					rawParent,
					instanceId: call_id(section.attributes.get("instance"), "ExtResource"),
					uniqueNameInOwner: section.properties.get("unique_name_in_owner") === true,
					scriptId: call_id(section.properties.get("script"), "ExtResource"),
					path,
					relativePath,
					parentPath,
					header: section.header,
					offset: section.offset,
					line: section.line + 1,
					body: source.slice(section.offset, section.endOffset),
				});
				if (rawParent === undefined) {
					scene.rootPath = path;
				}
				break;
			}
			default:
				// gd_scene / gd_resource headers, [resource], [connection ...],
				// [editable ...] — nothing to extract today
				break;
		}
	}
	return scene;
}
