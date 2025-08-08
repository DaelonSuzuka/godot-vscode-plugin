import * as vscode from "vscode";
import {
	CancellationToken,
	DocumentSymbol,
	EventEmitter,
	InlayHint,
	InlayHintKind,
	InlayHintsProvider,
	Position,
	Range,
	TextDocument,
	TextEdit,
} from "vscode";
import { ctx, globals } from "../extension";
import { ClientConnectionManager, ManagerStatus } from "../lsp";
import { SceneParser } from "../scene_tools";
import { createLogger, get_configuration } from "../utils";

const log = createLogger("providers.inlay_hints");

/**
 * Returns a label from a detail string.
 * E.g. `var a: int` gets parsed to ` int `.
 */
function fromDetail(detail: string): string {
	const labelRegex = /: ([\w\d_.]+)/;
	const labelMatch = detail.match(labelRegex);

	let label = labelMatch ? labelMatch[1] : "unknown";
	// fix when detail includes a script name
	if (label.includes(".gd.")) {
		label = label.split(".gd.")[1];
	}
	return `${label}`;
}

type HoverResult = {
	contents: {
		kind: string;
		value: string;
	};
};

async function addByHover(document: TextDocument, hoverPosition: vscode.Position): Promise<string | undefined> {
	const response = (await globals.lsp.client.send_request("textDocument/hover", {
		textDocument: { uri: document.uri.toString() },
		position: {
			line: hoverPosition.line,
			character: hoverPosition.character,
		},
	})) as HoverResult;

	// check if contents is an empty array; if it is, we have no hover information
	if (Array.isArray(response.contents) && response.contents.length === 0) {
		return undefined;
	}
	return response.contents.value;
}

function buildHint(start: Position, detail: string): InlayHint {
	const label = fromDetail(detail);
	const hint = new InlayHint(start, label, InlayHintKind.Type);
	hint.paddingLeft = true;
	hint.paddingRight = true;
	// hint.tooltip = "tooltip";
	hint.textEdits = [TextEdit.insert(start, ` ${label} `)];
	return hint;
}

export class GDInlayHintsProvider implements InlayHintsProvider {
	public parser = new SceneParser();

	private _onDidChangeInlayHints = new EventEmitter<void>();
	onDidChangeInlayHints = this._onDidChangeInlayHints.event;

	constructor(lsp: ClientConnectionManager) {
		const selector = [
			{ language: "gdresource", scheme: "file" },
			{ language: "gdscene", scheme: "file" },
			{ language: "gdscript", scheme: "file" },
		];
		ctx.subscriptions.push(
			vscode.languages.registerInlayHintsProvider(selector, this), //
		);

		lsp.onStatusChanged((status) => {
			this._onDidChangeInlayHints.fire();
			if (status === ManagerStatus.CONNECTED) {
				setTimeout(() => {
					this._onDidChangeInlayHints.fire();
				}, 250);
			}
		});
	}

	async provideInlayHints(document: TextDocument, range: Range, token: CancellationToken): Promise<InlayHint[]> {
		log.debug("Inlay Hints: provideInlayHints");

		if (document.fileName.endsWith(".gd")) {
			if (!get_configuration("inlayHints.gdscript", true)) {
				return [];
			}

			const hints = await this.buildGDScriptHints(document, range, token);
			log.debug("hints:", hints);
			return hints;
		}

		if (!get_configuration("inlayHints.gdresource", true)) {
			return [];
		}
		const hints = await this.buildGDResourceHints(document, range, token);
		log.debug("hints:", hints);
		return hints;
	}

	async buildGDScriptHints(document: TextDocument, range: Range, token: CancellationToken): Promise<InlayHint[]> {
		const hints: InlayHint[] = [];
		const text = document.getText(range);
		log.debug("buildGDScriptHints");

		if (!globals.lsp.client.isRunning()) {
			return hints;
		}

		log.debug("globals", globals);

		const symbolsResponse = (await globals.lsp.client.send_request("textDocument/documentSymbol", {
			textDocument: { uri: document.uri.toString() },
		})) as DocumentSymbol[];

		log.debug("symbolsResponse", symbolsResponse);

		if (symbolsResponse.length === 0) {
			return hints;
		}

		const symbols =
			typeof symbolsResponse[0] === "object" && "children" in symbolsResponse[0]
				? (symbolsResponse[0].children as DocumentSymbol[]) // godot 4.0+ returns an array of children
				: symbolsResponse; // godot 3.2 and below returns an array of symbols

		const hasDetail = symbols.some((s) => s.detail);

		// TODO: make sure godot reports the correct location for variable declaration symbols
		// (allowing the use of regex only on ranges provided by the LSP (textDocument/documentSymbol))

		// since neither LSP or the grammar know whether a variable is inferred or not,
		// we still need to use regex to find all inferred variable declarations.
		const regex = /((var|const)\s+)([\w\d_]+)\s*:=/g;

		for (const match of text.matchAll(regex)) {
			if (token.isCancellationRequested) {
				break;
			}
			// TODO: until godot supports nested document symbols, we need to send
			// a hover request for each variable declaration that is nested
			const start = document.positionAt(match.index + match[0].length - 1);

			if (hasDetail) {
				const symbol = symbols.find((s) => s.name === match[3]);
				if (symbol?.detail) {
					const hint = buildHint(start, symbol.detail);
					hints.push(hint);
					continue;
				}
			}

			const hoverPosition = document.positionAt(match.index + match[1].length);
			const detail = await addByHover(document, hoverPosition);
			if (detail) {
				const hint = buildHint(start, detail);
				hints.push(hint);
			}
		}
		return hints;
	}

	async buildGDResourceHints(document: TextDocument, range: Range, token: CancellationToken): Promise<InlayHint[]> {
		const hints: InlayHint[] = [];
		const text = document.getText(range);
		log.debug("buildGDResourceHints");
		const scene = this.parser.parse_scene(document);

		for (const match of text.matchAll(/ExtResource\(\s?"?(\w+)\s?"?\)/g)) {
			const id = match[1];
			const end = document.positionAt(match.index + match[0].length);
			const resource = scene.externalResources.get(id);

			const label = `${resource.type}: "${resource.path}"`;

			const hint = new InlayHint(end, label, InlayHintKind.Type);
			hint.paddingLeft = true;
			hints.push(hint);
		}

		for (const match of text.matchAll(/SubResource\(\s?"?(\w+)\s?"?\)/g)) {
			const id = match[1];
			const end = document.positionAt(match.index + match[0].length);
			const resource = scene.subResources.get(id);

			const label = `${resource.type}`;

			const hint = new InlayHint(end, label, InlayHintKind.Type);
			hint.paddingLeft = true;
			hints.push(hint);
		}

		return hints;
	}
}
