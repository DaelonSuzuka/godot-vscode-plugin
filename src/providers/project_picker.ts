import * as vscode from 'vscode';

const log = require('../utils').createLogger('project_picker');


export class GDProjectPicker {

    statusWidget = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right);
    
    constructor() {
        log.debug("ProjectPicker constructor");

        // this.statusWidget.command = "godotTools.checkStatus";
        this.statusWidget.show();
        this.statusWidget.text = "$(sync~spin) Status";

        
    }
}
