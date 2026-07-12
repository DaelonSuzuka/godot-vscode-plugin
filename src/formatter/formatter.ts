import * as vscode from "vscode";
import { format_source, normalize_options } from "../gdscript/formatter/engine";
import { createLogger, get_configuration } from "../utils";

const log = createLogger("formatter");

export class FormattingProvider implements vscode.DocumentFormattingEditProvider {
	constructor(private context: vscode.ExtensionContext) {
		const selector = { language: "gdscript", scheme: "file" };

		context.subscriptions.push(vscode.languages.registerDocumentFormattingEditProvider(selector, this));
	}

	public provideDocumentFormattingEdits(document: vscode.TextDocument): vscode.TextEdit[] {
		const options = normalize_options({
			maxEmptyLines: get_configuration("formatter.maxEmptyLines"),
			denseFunctionParameters: get_configuration("formatter.denseFunctionParameters"),
			spacesBeforeEndOfLineComment: get_configuration("formatter.spacesBeforeEndOfLineComment"),
		});

		const text = document.getText();
		let formatted: string;
		try {
			formatted = format_source(text, options);
		} catch (e) {
			// formatting must never break a save; the engine is fuzz-tested
			// against this, but a formatter that throws should do nothing
			log.error(`format failed for ${document.uri.fsPath}: ${e}`);
			return [];
		}
		if (formatted === text) {
			return [];
		}
		const fullRange = new vscode.Range(document.positionAt(0), document.positionAt(text.length));
		return [vscode.TextEdit.replace(fullRange, formatted)];
	}
}
