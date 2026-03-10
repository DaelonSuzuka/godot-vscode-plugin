import * as vscode from "vscode";
import { ctx } from "../extension";
import { register_command } from "../utils";

const log = require("../utils").createLogger("project_picker");

export class GDProjectPicker {
	widget = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right);

	selectedProject: string | undefined;

	constructor() {
		log.info("init ProjectPicker");

		// this.statusWidget.command = "godotTools.checkStatus";
		this.widget.show();
		this.widget.text = "GD Project";

		this.widget.command = "godotTools.pickProject";

		ctx.subscriptions.push(
			this.widget, //
			register_command("pickProject", this.pickProject.bind(this)),
		);

		vscode.workspace.findFiles("**/project.godot").then((files) => {
			log.debug(
				`found ${files.length} project files:`,
				files.map((f) => f.fsPath),
			);
			if (files.length === 1) {
				log.debug("only 1 project detected, automatically selecting:", files[0].fsPath);
				this.selectedProject = files[0].fsPath;
			}
		});
	}

	async pickProject() {
		const projectFiles = await vscode.workspace.findFiles("**/project.godot");
		const fileNames = projectFiles.map((f) => f.fsPath);

		const selection = vscode.window.showQuickPick(fileNames);

		log.debug("selection:", selection);
	}
}
