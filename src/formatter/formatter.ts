import * as vscode from "vscode";
import { format_document } from "./textmate";
import { createLogger } from "../utils";
import { Tree } from "@lezer/common";

const log = createLogger("formatter");

export class FormattingProvider implements vscode.DocumentFormattingEditProvider {
	public parser;

	constructor(private context: vscode.ExtensionContext) {
		import("@gdquest/lezer-gdscript").then((module) => {
			this.parser = module.parser;
		});
		
		const selector = { language: "gdscript", scheme: "file" };
		context.subscriptions.push(vscode.languages.registerDocumentFormattingEditProvider(selector, this));
	}

	public provideDocumentFormattingEdits(document: vscode.TextDocument) {
		log.info("Formatting document");
		const text = document.getText();
		const tree: Tree = this.parser.parse(text);
		const cursor = tree.cursor();

		cursor.iterate((node) => {
			const body = text.slice(node.from, node.to);
			log.info(node.type.name, body);
		});

		// log.info(tree.type.name);
		return format_document(document);
	}
}
