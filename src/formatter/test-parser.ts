// Manual test script for the Lezer parser
// Run with: npx ts-node src/formatter/test-parser.ts

import { parser } from "./grammar/generated/gdscript";

const testCases = [
	// Basic variable
	'var x = 42',
	// Typed variable
	'var x: int = 42',
	// Const
	'const PI = 3.14',
	// Function simple
	'func _ready():',
	// Function with params
	'func add(a: int, b: int) -> int:',
	// Class name
	'class_name Player',
	// Extends
	'extends Node',
	// Binary expression
	'var x = 1 + 2',
	// Function call
	'get_tree()',
	// Paren expression
	'(1 + 2)',
	// String
	'"hello world"',
	// If statement
	'if x > 0',
	// For loop
	'for i in range(10)',
	// While
	'while alive',
	// Return
	'return result',
	// Pass
	'pass',
	/// Multiple statements
	'var x = 1\nvar y = 2\nvar z = x + y',
];

console.log("Testing Lezer GDScript Parser\n");

for (const source of testCases) {
	console.log(`Input: "${source.replace(/\n/g, '\\n')}"`);
	const tree = parser.parse(source);
	console.log(`Tree: ${tree.toString()}`);
	console.log();
}