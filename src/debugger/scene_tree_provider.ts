import {
	TreeDataProvider,
	EventEmitter,
	Event,
	ProviderResult,
	TreeItem,
	TreeItemCollapsibleState,
	Uri
} from "vscode";
import path = require("path");
import { get_extension_uri } from "../utils";

const iconDir = get_extension_uri("resources", "godot_icons").fsPath;

export class SceneTreeProvider implements TreeDataProvider<SceneNode> {
	private _on_did_change_tree_data: EventEmitter<
		SceneNode | undefined
	> = new EventEmitter<SceneNode | undefined>();
	private tree: SceneNode | undefined;

	public readonly onDidChangeTreeData: Event<SceneNode> | undefined = this
		._on_did_change_tree_data.event;

	constructor() { }

	public fill_tree(tree: SceneNode) {
		this.tree = tree;
		this._on_did_change_tree_data.fire(undefined);
	}

	public getChildren(element?: SceneNode): SceneNode[] {
		if (!this.tree) {
			return [];
		}

		if (!element) {
			return [this.tree];
		} else {
			return element.children;
		}
	}

	public getTreeItem(element: SceneNode): TreeItem | Thenable<TreeItem> {
		const has_children = element.children.length > 0;
		const tree_item: TreeItem = new TreeItem(
			element.label,
			has_children
				? element === this.tree
					? TreeItemCollapsibleState.Expanded
					: TreeItemCollapsibleState.Collapsed
				: TreeItemCollapsibleState.None
		);

		tree_item.description = element.class_name;
		tree_item.iconPath = element.iconPath;
		if (element.scene_file_path) {
			let tooltip = "";
			tooltip += `${element.label}`;
			tooltip += `\n${element.class_name}`;
			tooltip += `\n${element.object_id}`;
			if (element.scene_file_path) {
				tooltip += `\n${element.scene_file_path}`;
			}
			tree_item.tooltip = tooltip;
		}

		return tree_item;
	}
}

export class SceneNode extends TreeItem {
	constructor(
		public label: string,
		public class_name: string,
		public object_id: number,
		public children: SceneNode[],
		public scene_file_path?: string,
		public view_flags?: number,
	) {
		super(label);

		const iconName = class_name + ".svg";

		this.iconPath = {
			light: Uri.file(path.join(iconDir, "light", iconName)),
			dark: Uri.file(path.join(iconDir, "dark", iconName)),
		};
	}
}
