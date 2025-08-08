import * as vscode from "vscode";
import { ctx } from "../extension";
import { register_command } from "../utils";

const log = require("../utils").createLogger("project_picker");

export class GDProjectPicker {
	widget = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right);

	constructor() {
		log.debug("ProjectPicker constructor");

		// this.statusWidget.command = "godotTools.checkStatus";
		this.widget.show();
		this.widget.text = "$(sync~spin) Status";

		this.widget.command = "godotTools.pickProject";

		ctx.subscriptions.push(
			this.widget, //
			register_command("pickProject", this.pickProject.bind(this)),
		);
	}

	pickProject() {
		vscode.window.showQuickPick(["a", "b", "c"]);
	}
}
