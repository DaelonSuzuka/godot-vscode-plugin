// Lezer parser wrapper for GDScript
import { parser } from "./grammar/generated/gdscript";

/**
 * Parse GDScript source code and return the syntax tree
 */
export function parse(source: string) {
	return parser.parse(source);
}

/**
 * Parse and return a string representation of the tree (for debugging)
 */
export function parseToString(source: string): string {
	const tree = parser.parse(source);
	return tree.toString();
}

// Re-export parser for direct access
export { parser };