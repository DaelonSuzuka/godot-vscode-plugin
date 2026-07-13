// Plain-node tests for the tscn parser — no VS Code host required.

import { assert } from "chai";
import * as fs from "node:fs";
import * as path from "node:path";
import { parse_tscn, path_at, reference_at } from "./parser";
import { interpret_scene } from "./scene";

suite("tscn parser: sections and values", () => {
	test("gd_scene header and ext_resource attributes", () => {
		const src = `[gd_scene load_steps=3 format=3 uid="uid://abc123"]

[ext_resource type="Script" path="res://player.gd" id="1_p3f"]
[ext_resource type="Texture2D" uid="uid://xyz" path="res://art/my sprite (final).png" id="2_tex"]
`;
		const { sections } = parse_tscn(src);
		assert.strictEqual(sections.length, 3);
		assert.strictEqual(sections[0].tag, "gd_scene");
		assert.strictEqual(sections[0].attributes.get("load_steps"), 3);
		// the regex parser could not read paths with spaces or parens
		const tex = sections[2];
		assert.strictEqual(tex.attributes.get("path"), "res://art/my sprite (final).png");
	});

	test("godot 3 numeric resource ids", () => {
		const src = `[ext_resource path="res://x.gd" type="Script" id=1]\n`;
		const scene = interpret_scene(src);
		assert.isTrue(scene.externalResources.has("1"));
	});

	test("multiline values do not desync sections", () => {
		const src = `[sub_resource type="TileSet" id="ts"]
tile_data = PackedInt32Array(0, 1, 2,
	3, 4, 5)
points = [Vector2(0, 0),
	Vector2(1, 1)]

[node name="Root" type="Node2D"]
`;
		const scene = interpret_scene(src);
		assert.isTrue(scene.subResources.has("ts"));
		assert.isTrue(scene.nodes.has("Root"));
	});

	test("properties parse: script, unique names, dicts", () => {
		const src = `[node name="Player" type="CharacterBody2D"]
script = ExtResource("1_p3f")
unique_name_in_owner = true
metadata/_edit_lock_ = true
custom = {
"speed": 10.5,
"tags": ["a", "b"]
}
`;
		const scene = interpret_scene(src);
		const player = scene.nodes.get("Player");
		assert.isDefined(player);
		assert.strictEqual(player?.scriptId, "1_p3f");
		assert.isTrue(player?.uniqueNameInOwner);
	});

	test("node tree paths match the historical rules", () => {
		const src = `[node name="Root" type="Node2D"]
[node name="Child" type="Sprite2D" parent="."]
[node name="Grand" type="Sprite2D" parent="Child"]
[node name="Weird Name" type="Node" parent="Child/Grand"]
`;
		const scene = interpret_scene(src);
		assert.strictEqual(scene.rootPath, "Root");
		assert.deepEqual(
			[...scene.nodes.keys()],
			["Root", "Root/Child", "Root/Child/Grand", "Root/Child/Grand/Weird Name"],
		);
		const grand = scene.nodes.get("Root/Child/Grand");
		assert.strictEqual(grand?.parentPath, "Root/Child");
		assert.strictEqual(grand?.relativePath, "Child/Grand");
	});

	test("instanced scenes", () => {
		const src = `[ext_resource type="PackedScene" path="res://enemy.tscn" id="3_e"]
[node name="Root" type="Node2D"]
[node name="Enemy" parent="." instance=ExtResource("3_e")]
`;
		const scene = interpret_scene(src);
		const enemy = scene.nodes.get("Root/Enemy");
		assert.strictEqual(enemy?.type, "PackedScene");
		assert.strictEqual(enemy?.instanceId, "3_e");
	});

	test("string escapes and node names the regexes rejected", () => {
		const src = `[node name="Health 100%" type="Label"]
text = "line one\\nline \\"two\\""
`;
		const scene = interpret_scene(src);
		assert.isTrue(scene.nodes.has("Health 100%"));
	});

	test("section body spans (for tooltips and doc links)", () => {
		const src = `[ext_resource type="Script" path="res://a.gd" id="1"]

[node name="Root" type="Node2D"]
position = Vector2(1, 2)

[node name="B" parent="."]
`;
		const scene = interpret_scene(src);
		const root = scene.nodes.get("Root");
		assert.include(root?.body, "position = Vector2(1, 2)");
		assert.notInclude(root?.body, '[node name="B"');
		assert.strictEqual(scene.externalResources.get("1")?.line, 1);
	});

	test("typed container literals (Godot 4.4+) — found hanging on demo corpus", () => {
		const src = `[node name="Store" type="VSplitContainer" unique_id=967199979]
script = ExtResource("1_s")
inapp_products = Dictionary[String, Texture]({
"blaster": ExtResource("8_j"),
"sword": ExtResource("4_n")
})
levels = Array[int]([1, 2, 3])
nested = Dictionary[String, Array[int]]({})
`;
		const scene = interpret_scene(src);
		const store = scene.nodes.get("Store");
		assert.strictEqual(store?.scriptId, "1_s");
	});

	test("malformed input throws instead of hanging (no-progress guard)", () => {
		// unknown typed-container name: the [String, Texture] part gets read
		// as a section header, whose comma must throw rather than spin
		assert.throws(() => interpret_scene(`[node name="X"]\nx = Foo[String, Texture]({})\n`));
	});

	test("embedded Object(...) values with key:value arguments", () => {
		const src = `[sub_resource type="AnimationNodeStateMachineTransition" id="t1"]
advance_condition = Object(StringName,"name":"is_running")
input = Object(InputEventKey,"resource_local_to_scene":false,"keycode":32,"pressed":true)

[node name="Root" type="Node2D"]
`;
		const scene = interpret_scene(src);
		assert.isTrue(scene.subResources.has("t1"));
		assert.isTrue(scene.nodes.has("Root"));
	});

	test("connections and editable sections are tolerated", () => {
		const src = `[node name="Root" type="Node2D"]
[connection signal="pressed" from="." to="." method="_on_pressed"]
[editable path="Enemy"]
`;
		const scene = interpret_scene(src);
		assert.isTrue(scene.nodes.has("Root"));
	});
});

suite("tscn parser: position index", () => {
	const src = `[gd_scene format=3]
[ext_resource type="Script" path="res://player one.gd" id="1_a"]
[node name="Root" type="Node2D"]
script = ExtResource("1_a")
mat = SubResource("m1")
paths = ["res://a.png", "uid://b3xyz"]
`;

	test("reference usage sites are indexed with exact spans", () => {
		const { index } = parse_tscn(src);
		assert.lengthOf(index.references, 2);
		const [ext, sub] = index.references;
		assert.strictEqual(ext.kind, "ext");
		assert.strictEqual(ext.id, "1_a");
		assert.strictEqual(src.slice(ext.span.start, ext.span.end), 'ExtResource("1_a")');
		assert.strictEqual(sub.kind, "sub");
		assert.strictEqual(src.slice(sub.span.start, sub.span.end), 'SubResource("m1")');
		assert.strictEqual(src.split("\n")[ext.span.line], 'script = ExtResource("1_a")');
	});

	test("res:// and uid:// strings are indexed, including header attributes", () => {
		const { index } = parse_tscn(src);
		assert.deepEqual(
			index.paths.map((p) => p.value),
			["res://player one.gd", "res://a.png", "uid://b3xyz"],
		);
		for (const p of index.paths) {
			// span covers the quoted literal
			assert.strictEqual(src.slice(p.span.start + 1, p.span.end - 1), p.value);
		}
	});

	test("point queries by offset", () => {
		const { index } = parse_tscn(src);
		const offset = src.indexOf('ExtResource("1_a")') + 5;
		assert.strictEqual(reference_at(index, offset)?.id, "1_a");
		assert.isUndefined(reference_at(index, 0));
		const pathOffset = src.indexOf("res://a.png");
		assert.strictEqual(path_at(index, pathOffset)?.value, "res://a.png");
	});

	test("numbers do not bloat the index", () => {
		const big = `[sub_resource type="X" id="t"]\ndata = PackedInt32Array(${Array.from({ length: 1000 }, (_, i) => i).join(", ")})\n`;
		const { index } = parse_tscn(big);
		assert.lengthOf(index.references, 0);
		assert.lengthOf(index.paths, 0);
	});
});

suite("tscn parser: termination fuzz", () => {
	// The parser must terminate on ANY input — throwing is fine, hanging is
	// not (a wedged parser wedges the editor). Deterministic seeded fuzz so
	// failures reproduce; the no-progress guard in parse() is the backstop
	// this exercises.
	function mulberry32(seed: number) {
		let a = seed;
		return () => {
			a |= 0;
			a = (a + 0x6d2b79f5) | 0;
			let t = Math.imul(a ^ (a >>> 15), 1 | a);
			t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
			return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
		};
	}

	const template = `[gd_scene load_steps=2 format=3 uid="uid://x"]
[ext_resource type="Script" path="res://a b(c).gd" id="1_a"]
[sub_resource type="TileSet" id="t"]
0:0/1/flip_h = true
data = Dictionary[String, Array[int]]({"k": [1, 2], "j": Object(Thing,"p":3)})
[node name="Root" type="Node2D"]
script = ExtResource("1_a")
text = "multi\\nline \\"str\\""
`;
	const CHARS = `[]{}()=:,;"'\\&-.0aZ_$%\n\t `;

	test("random garbage terminates", () => {
		const rand = mulberry32(0xdae101);
		for (let i = 0; i < 2000; i++) {
			const len = Math.floor(rand() * 200);
			let s = "";
			for (let j = 0; j < len; j++) {
				s += CHARS[Math.floor(rand() * CHARS.length)];
			}
			try {
				interpret_scene(s);
			} catch {
				// throwing is acceptable; hanging is the failure mode
			}
		}
	});

	test("mutated real scenes terminate", () => {
		const rand = mulberry32(0x5eed);
		for (let i = 0; i < 2000; i++) {
			const pos = Math.floor(rand() * template.length);
			const op = rand();
			let s: string;
			if (op < 0.4) {
				s = template.slice(0, pos) + template.slice(pos + 1 + Math.floor(rand() * 20)); // delete run
			} else if (op < 0.8) {
				s = template.slice(0, pos) + CHARS[Math.floor(rand() * CHARS.length)] + template.slice(pos); // insert
			} else {
				s = template.slice(pos) + template.slice(0, pos); // rotate
			}
			try {
				interpret_scene(s);
			} catch {
				// acceptable
			}
		}
	});
});

suite("tscn parser: corpus", () => {
	test("all test-project scenes and resources parse", function () {
		this.timeout(10000);
		const root = path.resolve(__dirname, "..", "..", "test_projects");
		const files: string[] = [];
		const walk = (dir: string) => {
			for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
				const full = path.join(dir, entry.name);
				if (entry.isDirectory()) {
					walk(full);
				} else if (entry.name.endsWith(".tscn") || entry.name.endsWith(".tres")) {
					files.push(full);
				}
			}
		};
		walk(root);
		assert.isAbove(files.length, 0);
		for (const file of files) {
			const scene = interpret_scene(fs.readFileSync(file, "utf8"));
			assert.isDefined(scene.nodes, file);
		}
	});
});
