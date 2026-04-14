import { ContextTracker, ExternalTokenizer } from "@lezer/lr";
import {
	BraceL,
	BracketL,
	ParenL,
	blankLineStart,
	dedent,
	eof,
	indent,
	newlineBracketed,
	newline as newlineToken,
} from "./parser.terms.js";

const newline = 10,
	carriageReturn = 13,
	space = 32,
	tab = 9,
	hash = 35;

const bracketed = new Set([
	// Add GDScript bracketed constructs here
]);

function isLineBreak(ch) {
	return ch == newline || ch == carriageReturn;
}

export const newlines = new ExternalTokenizer(
	(input, stack) => {
		let prev;
		if (input.next < 0) {
			input.acceptToken(eof);
		} else if (stack.context.flags & cx_Bracketed) {
			if (isLineBreak(input.next)) input.acceptToken(newlineBracketed, 1);
		} else if (((prev = input.peek(-1)) < 0 || isLineBreak(prev)) && stack.canShift(blankLineStart)) {
			let spaces = 0;
			while (input.next == space || input.next == tab) {
				input.advance();
				spaces++;
			}
			if (input.next == newline || input.next == carriageReturn || input.next == hash)
				input.acceptToken(blankLineStart, -spaces);
		} else if (isLineBreak(input.next)) {
			input.acceptToken(newlineToken, 1);
		}
	},
	{ contextual: true },
);

export const indentation = new ExternalTokenizer((input, stack) => {
	const context = stack.context;
	if (context.flags) return;
	let prev = input.peek(-1),
		depth;
	if (prev == newline || prev == carriageReturn) {
		let depth = 0,
			chars = 0;
		for (;;) {
			if (input.next == space) depth++;
			else if (input.next == tab)
				depth += 4; // GDScript uses 4-space tabs
			else break;
			input.advance();
			chars++;
		}
		if (depth != context.indent && input.next != newline && input.next != carriageReturn && input.next != hash) {
			if (depth < context.indent) input.acceptToken(dedent, -chars);
			else input.acceptToken(indent);
		}
	}
});

const cx_Bracketed = 1;

function Context(parent, indent, flags) {
	this.parent = parent;
	this.indent = indent;
	this.flags = flags;
	this.hash = (parent ? (parent.hash + parent.hash) << 8 : 0) + indent + (indent << 4) + flags + (flags << 6);
}

const topIndent = new Context(null, 0, 0);

function countIndent(space) {
	let depth = 0;
	for (let i = 0; i < space.length; i++) depth += space.charCodeAt(i) == tab ? 4 : 1; // GDScript uses 4-space tabs
	return depth;
}

export const trackIndent = new ContextTracker({
	start: topIndent,
	reduce(context, term, _, input) {
		if (context.flags & cx_Bracketed && bracketed.has(term)) return context.parent;
		return context;
	},
	shift(context, term, stack, input) {
		if (term == indent) return new Context(context, countIndent(input.read(input.pos, stack.pos)), 0);
		if (term == dedent) return context.parent;
		if (term == ParenL || term == BracketL || term == BraceL) return new Context(context, 0, cx_Bracketed);
		return context;
	},
	hash(context) {
		return context.hash;
	},
});
