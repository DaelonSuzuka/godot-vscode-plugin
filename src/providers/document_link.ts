import * as vscode from "vscode";
import {
	type CancellationToken,
	DocumentLink,
	type DocumentLinkProvider,
	type ExtensionContext,
	Position,
	Range,
	type TextDocument,
	Uri,
} from "vscode";
import { SceneParser } from "../scene_tools";
import type { Span } from "../tscn/parser";
import { convert_resource_path_to_uri, convert_uids_to_uris, createLogger } from "../utils";

const log = createLogger("providers.document_links");

export class GDDocumentLinkProvider implements DocumentLinkProvider {
	public parser = new SceneParser();

	constructor(private context: ExtensionContext) {
		const selector = [
			{ language: "gdresource", scheme: "file" },
			{ language: "gdscene", scheme: "file" },
			{ language: "gdscript", scheme: "file" },
		];
		context.subscriptions.push(vscode.languages.registerDocumentLinkProvider(selector, this));
	}

	async provideDocumentLinks(document: TextDocument, token: CancellationToken): Promise<DocumentLink[]> {
		if (["gdresource", "gdscene"].includes(document.languageId)) {
			return this.scene_links(document);
		}
		return this.text_links(document);
	}

	/** scene files: everything comes from the parser's position index */
	private async scene_links(document: TextDocument): Promise<DocumentLink[]> {
		const scene = this.parser.parse_scene(document);
		const links: DocumentLink[] = [];

		for (const ref of scene.index.references) {
			const definition =
				ref.kind === "ext" ? scene.externalResources.get(ref.id) : scene.subResources.get(ref.id);
			if (!definition) {
				continue;
			}
			const uri = Uri.from({
				scheme: "file",
				path: document.uri.fsPath,
				fragment: `${definition.line},0`,
			});
			const link = new DocumentLink(this.span_range(document, ref.span), uri);
			link.tooltip = "Jump to resource definition";
			links.push(link);
		}

		const uids = new Set<string>();
		for (const p of scene.index.paths) {
			if (p.value.startsWith("uid://")) {
				uids.add(p.value);
			}
		}
		const uidMap = await convert_uids_to_uris(Array.from(uids));

		for (const p of scene.index.paths) {
			// the span covers the quoted literal; link just the path text
			const range = this.span_range(document, p.span, 1);
			const uri = p.value.startsWith("res://")
				? await convert_resource_path_to_uri(p.value)
				: uidMap.get(p.value);
			if (uri instanceof Uri) {
				links.push(new DocumentLink(range, uri));
			}
		}
		return links;
	}

	/** gdscript (no scene structure): plain text scan */
	private async text_links(document: TextDocument): Promise<DocumentLink[]> {
		const text = document.getText();
		const links: DocumentLink[] = [];

		for (const match of text.matchAll(/res:\/\/([^"'\n]*)/g)) {
			const uri = await convert_resource_path_to_uri(match[0]);
			if (uri instanceof Uri) {
				links.push(new DocumentLink(this.match_range(document, match), uri));
			}
		}

		const uids = new Set<string>();
		const uidMatches: Array<[string, Range]> = [];
		for (const match of text.matchAll(/uid:\/\/([0-9a-z]*)/g)) {
			uids.add(match[0]);
			uidMatches.push([match[0], this.match_range(document, match)]);
		}
		const uidMap = await convert_uids_to_uris(Array.from(uids));
		for (const [uid, range] of uidMatches) {
			const uri = uidMap.get(uid);
			if (uri instanceof vscode.Uri) {
				links.push(new DocumentLink(range, uri));
			}
		}
		return links;
	}

	private span_range(document: TextDocument, span: Span, shrink = 0): Range {
		return new Range(document.positionAt(span.start + shrink), document.positionAt(span.end - shrink));
	}

	private match_range(document: TextDocument, match: RegExpMatchArray): Range {
		if (match.index === undefined) {
			return new Range(new Position(0, 0), new Position(0, 0));
		}
		return new Range(document.positionAt(match.index), document.positionAt(match.index + match[0].length));
	}
}
