// Plain-node tests for the tscn parser — no VS Code host required.

import { assert } from "chai";
import * as fs from "node:fs";
import * as path from "node:path";
import { parse_tscn } from "./parser";
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
