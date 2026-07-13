import * as vscode from "vscode";
import {
	type CancellationToken,
	type ExtensionContext,
	Hover,
	type HoverProvider,
	MarkdownString,
	type Position,
	type TextDocument,
	Uri,
} from "vscode";
import { SceneParser } from "../scene_tools";
import type { GDResource } from "../scene_tools/types";
import { path_at, reference_at } from "../tscn/parser";
import { convert_resource_path_to_uri, convert_uid_to_uri, convert_uri_to_resource_path, createLogger } from "../utils";

const log = createLogger("providers.hover");

export class GDHoverProvider implements HoverProvider {
	public parser = new SceneParser();

	constructor(private context: ExtensionContext) {
		const selector = [
			{ language: "gdresource", scheme: "file" },
			{ language: "gdscene", scheme: "file" },
			{ language: "gdscript", scheme: "file" },
		];
		context.subscriptions.push(vscode.languages.registerHoverProvider(selector, this));
	}

	async get_links(text: string): Promise<string> {
		let links = "";
		for (const match of text.matchAll(/res:\/\/[^"'\s]*/g)) {
			const uri = await convert_resource_path_to_uri(match[0]);
			if (uri instanceof Uri) {
				links += `* [${match[0]}](${uri})\n`;
			}
		}
		for (const match of text.matchAll(/uid:\/\/[0-9a-z]*/g)) {
			const uri = await convert_uid_to_uri(match[0]);
			if (uri instanceof Uri) {
				links += `* [${match[0]}](${uri})\n`;
			}
		}
		return links;
	}

	private async ext_resource_hover(resource: GDResource): Promise<Hover> {
		const definition = resource.body;
		const links = await this.get_links(definition);

		const contents = new MarkdownString();
		contents.appendMarkdown(links);
		const uri = await convert_resource_path_to_uri(resource.path);
		contents.appendMarkdown("\n---\n");
		contents.appendCodeblock(definition, "gdresource");
		// resource classes: Texture (Godot 3), Texture2D/CompressedTexture2D/
		// AtlasTexture/... (Godot 4)
		if (resource.type.includes("Texture")) {
			contents.appendMarkdown("\n---\n");
			contents.appendMarkdown(`<img src="${uri}" min-width=100px max-width=500px/>\n`);
			contents.supportHtml = true;
			contents.isTrusted = true;
		}
		if (resource.type === "Script" && uri) {
			contents.appendMarkdown("\n---\n");
			const text = (await vscode.workspace.openTextDocument(uri)).getText();
			contents.appendCodeblock(text, "gdscript");
		}
		return new Hover(contents);
	}

	private sub_resource_hover(resource: GDResource): Hover {
		// don't display the contents of giant arrays
		const definition = resource.body.replace(/(\w*Array)\(([^)]{120,})\)/g, "$1(...)");
		const contents = new MarkdownString();
		contents.appendCodeblock(definition, "gdresource");
		return new Hover(contents);
	}

	async provideHover(
		document: TextDocument,
		position: Position,
		token: CancellationToken,
	): Promise<Hover | undefined> {
		if (["gdresource", "gdscene"].includes(document.languageId)) {
			const scene = this.parser.parse_scene(document);
			const offset = document.offsetAt(position);

			const ref = reference_at(scene.index, offset);
			if (ref) {
				const resource =
					ref.kind === "ext" ? scene.externalResources.get(ref.id) : scene.subResources.get(ref.id);
				if (!resource) {
					return undefined;
				}
				return ref.kind === "ext" ? this.ext_resource_hover(resource) : this.sub_resource_hover(resource);
			}

			const path = path_at(scene.index, offset);
			if (path) {
				return this.link_hover(path.value);
			}
			return undefined;
		}

		// gdscript (and anything else): resolve res:// / uid:// under the cursor
		const resRange = document.getWordRangeAtPosition(position, /res:\/\/[^"'\n]*/);
		if (resRange) {
			return this.link_hover(document.getText(resRange));
		}
		const uidRange = document.getWordRangeAtPosition(position, /uid:\/\/[0-9a-z]*/);
		if (uidRange) {
			return this.link_hover(document.getText(uidRange));
		}
		return undefined;
	}

	private async link_hover(link: string): Promise<Hover | undefined> {
		let resPath = link;
		if (resPath.startsWith("uid://")) {
			const uri = await convert_uid_to_uri(resPath);
			if (!uri) {
				return undefined;
			}
			resPath = await convert_uri_to_resource_path(uri);
		}
		if (!resPath.startsWith("res://")) {
			return undefined;
		}

		let type = "";
		if (resPath.endsWith(".gd")) {
			type = "gdscript";
		} else if (resPath.endsWith(".cs")) {
			type = "csharp";
		} else if (resPath.endsWith(".tscn")) {
			type = "gdscene";
		} else if (resPath.endsWith(".tres")) {
			type = "gdresource";
		} else if (resPath.endsWith(".png") || resPath.endsWith(".svg")) {
			type = "image";
		} else {
			// not a previewable type; no hover rather than an error
			return undefined;
		}

		const uri = await convert_resource_path_to_uri(resPath);
		if (!uri) {
			return undefined;
		}
		const contents = new MarkdownString();
		if (type === "image") {
			contents.appendMarkdown(`<img src="${uri}" min-width=100px max-width=500px/>`);
			contents.supportHtml = true;
			contents.isTrusted = true;
		} else {
			const text = (await vscode.workspace.openTextDocument(uri)).getText();
			contents.appendCodeblock(text, type);
		}
		return new Hover(contents);
	}
}
