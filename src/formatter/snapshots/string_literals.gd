# String-family literals: StringName, NodePath strings, raw strings.
# All are preserved verbatim by the formatter.

# --- IN ---
var a = &"jump"
var b = &'single_name'
var c = ^"Player/Sprite"
var d = $"Enemy"
var e = %"Weird Name"
var f = r"raw \d+ string"
var g = r'raw single'

# --- IN ---
signal jumped
func f():
	emit_signal(&"jumped")
	get_node(^"../Sibling")
	var re = r"\b(\w+)\b"
# --- END ---

# Godot 3 NodePath literal syntax

# --- IN ---
var np = @"Path/To/Node"
