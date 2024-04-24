import * as vscode from "vscode";
import {
	Range,
	Color,
	TextDocument,
	CancellationToken,
	ProviderResult,
	TextEdit,
	ColorInformation,
	ColorPresentation,
	DocumentColorProvider,
	ExtensionContext,
} from "vscode";
import { createLogger } from "../utils";

const log = createLogger("providers.colors");

/*
Godot Color formats:

Color()
Color(Color from, float alpha)
Color(Color from)
Color(String code)
Color(String code, float alpha)
Color(float r, float g, float b)
Color(float r, float g, float b, float a)

Color8(255, 0, 0)
ColorN("red", 1)

Color.from_hsv(float h, float s, float v, float alpha=1.0)
Color.from_ok_hsl(float h, float s, float l, float alpha=1.0)
Color.from_rgbe9995(int rgbe)
Color.from_string(String str, Color default)
Color.hex(int hex)
Color.hex64(int hex)
Color.html(String rgba)
*/

function convert_8bit_to_float(value: number) {
	return ((value - 0) * (1 - 0)) / (255 - 0) + 0;
}

function convert_float_to_8bit(value: number) {
	return Math.floor(((value - 0) * (255 - 0)) / (1 - 0) + 0);
}

class ColorParseResult {
	public func: string;
	public args: string[];
	public format: "RGB" | "RGB8" | "HSV" | "HEX";
	public hex: string;
	public r: number;
	public b: number;
	public g: number;
	public a: number;

	constructor(text: string) {
		const parts = text.match(/(Color|Color8|ColorN|Color\.\w+)?\((.*)\)/);
		this.func = parts[1];
		this.args = parts[2].split(",");

		if (this.func === "Color") {
			if (this.args.length === 1) {
				this.format = "HEX";
				this.hex = this.args[0].replaceAll('"', "");
				const hex = this.hex.replace("#", "");
				this.r = convert_8bit_to_float(parseInt(`0x${hex[0]}${hex[1]}`, 16));
				this.g = convert_8bit_to_float(parseInt(`0x${hex[2]}${hex[3]}`, 16));
				this.b = convert_8bit_to_float(parseInt(`0x${hex[4]}${hex[5]}`, 16));
				if (hex.length === 8) {
					this.a = convert_8bit_to_float(parseInt(`0x${hex[6]}${hex[7]}`, 16));
				}
			} else if (this.args.length === 3 || this.args.length === 4) {
				this.format = "RGB";
				this.r = parseFloat(this.args[0]);
				this.b = parseFloat(this.args[1]);
				this.g = parseFloat(this.args[2]);
				if (this.args.length === 4) {
					this.a = parseFloat(this.args[3]);
				}
			}
		} else if (this.func === "Color8") {
			this.format = "RGB8";
			this.r = convert_8bit_to_float(parseInt(this.args[0]));
			this.b = convert_8bit_to_float(parseInt(this.args[1]));
			this.g = convert_8bit_to_float(parseInt(this.args[2]));
			if (this.args.length === 4) {
				this.a = convert_8bit_to_float(parseInt(this.args[3]));
			}
		}
	}

	to_color() {
		if (this.r !== undefined && this.g !== undefined && this.b !== undefined) {
			return new Color(this.r, this.g, this.b, this.a ?? 1);
		}
		return null;
	}
}

function parse_color(text) {
	const result = new ColorParseResult(text);

	return result.to_color();
}

export class GDColorProvider implements DocumentColorProvider {
	constructor(private context: ExtensionContext) {
		const selector = [
			{ language: "gdresource", scheme: "file" },
			{ language: "gdscene", scheme: "file" },
			{ language: "gdscript", scheme: "file" },
		];
		context.subscriptions.push(vscode.languages.registerColorProvider(selector, this));
	}

	provideColorPresentations(
		color: Color,
		context: { readonly document: TextDocument; readonly range: Range },
		token: CancellationToken,
	): ProviderResult<ColorPresentation[]> {
		const original = new ColorParseResult(context.document.getText(context.range));

		let output = "";

		switch (original.format) {
			case "HEX": {
				output = 'Color("';
				if (original.hex.includes("#")) {
					output += "#";
				}
				output += `${convert_float_to_8bit(color.red).toString(16)}`;
				output += `${convert_float_to_8bit(color.green).toString(16)}`;
				output += `${convert_float_to_8bit(color.blue).toString(16)}`;
				if (original.a || color.alpha !== 1) {
					output += `${convert_float_to_8bit(color.alpha).toString(16)}`;
				}
				output += '")';
				break;
			}
			case "RGB": {
				output = "Color(";
				output += `${color.red}`;
				output += `, ${color.green}`;
				output += `, ${color.blue}`;
				if (original.a || color.alpha !== 1) {
					output += `, ${color.alpha}`;
				}
				output += ")";
				break;
			}
			case "RGB8": {
				output = "Color8(";
				output += `${convert_float_to_8bit(color.red)}`;
				output += `, ${convert_float_to_8bit(color.green)}`;
				output += `, ${convert_float_to_8bit(color.blue)}`;
				if (original.a || color.alpha !== 1) {
					output += `, ${convert_float_to_8bit(color.alpha)}`;
				}
				output += ")";
			}
		}

		const presentation = new ColorPresentation("RGBA");
		presentation.textEdit = TextEdit.replace(context.range, output);

		return [presentation];
	}

	provideDocumentColors(document: TextDocument, token: CancellationToken): ProviderResult<ColorInformation[]> {
		const text = document.getText();

		const colors: ColorInformation[] = [];

		const matches = text.matchAll(/(Color|Color8|ColorN|Color\.\w+)?\(([^\)]*)\)/g);

		for (const match of matches) {
			const start = document.positionAt(match.index);
			const end = document.positionAt(match.index + match[0].length);
			const r = new Range(start, end);
			const color = parse_color(match[0]);

			if (color) {
				colors.push(new ColorInformation(r, color));
			}
		}

		return colors;
	}
}
