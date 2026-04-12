// Manual test script for the Lezer parser
// Run with: npx ts-node src/formatter/test-parser.ts

import { parser } from "./grammar/generated/gdscript";
import * as fs from "node:fs";
import * as path from "node:path";

// Simple inline tests
const inlineTests = [
	"var x = 42",
	"var x: int = 42",
	"const PI = 3.14",
	"func _ready():",
	"func add(a: int, b: int) -> int:",
	"class_name Player",
	"extends Node",
	"var x = 1 + 2",
	"get_tree()",
	'"hello world"',
	"if x > 0:",
	"for i in range(10):",
	"while alive:",
	"return result",
	"pass",
	"signal health_changed",
	"enum { A, B, C }",
	"@export var speed: float = 100.0",
	"var arr: Array[int] = [1, 2, 3]",
	"var dict = { 'key': 'value' }",
];

console.log("=== Inline Tests ===\n");

for (const source of inlineTests) {
	console.log(`Input: "${source}"`);
	const tree = parser.parse(source);
	const hasErrors = tree.toString().includes("â");
	console.log(`Status: ${hasErrors ? "ERRORS" : "OK"}`);
	console.log();
}

// Test with example files
const exampleFiles = [
	"syntaxes/examples/gdscript1.gd",
	"syntaxes/examples/gdscript2.gd",
	"test_projects/test-dap-project-godot4/ExtensiveVars.gd",
	"test_projects/test-dap-project-godot4/ScopeVars.gd",
	"src/formatter/snapshots/operators.gd",
	"src/formatter/snapshots/setters_getters.gd",
	"src/formatter/snapshots/match/in.gd",
];

console.log("=== File Tests ===\n");

for (const relPath of exampleFiles) {
	const filePath = path.join(__dirname, "..", "..", relPath);
	if (fs.existsSync(filePath)) {
		const source = fs.readFileSync(filePath, "utf-8");
		console.log(`File: ${relPath}`);
		console.log(`Lines: ${source.split("\n").length}`);
		
		const tree = parser.parse(source);
		const treeStr = tree.toString();
		const errorCount = (treeStr.match(/â/g) || []).length;
		console.log(`Parse errors: ${errorCount}`);
		console.log();
	} else {
		console.log(`File not found: ${filePath}`);
	}
}