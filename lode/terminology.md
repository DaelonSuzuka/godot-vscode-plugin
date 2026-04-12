# Terminology

- **LSP** - Language Server Protocol. VS Code protocol for language features (autocomplete, hover, diagnostics, etc.)
- **DAP** - Debug Adapter Protocol. VS Code protocol for debugger integration
- **GDScript** - Godot's built-in scripting language (`.gd` files)
- **GDResource** - Godot resource file format (`.tres`, `.godot`, `.import`, `.gdns`, `.gdnlib`)
- **GDScene** - Godot scene file format (`.tscn` files)
- **GDShader** - Godot shader file format (`.gdshader`, `.gdshaderinc`)
- **res://** - Godot's virtual filesystem path prefix for project resources
- **Headless LSP** - Running Godot editor without UI to provide language server functionality (available in Godot 3.6+/4.2+)
- **Scene Tree** - Debug-time view of active nodes in running Godot project
- **Inspector** - Debug-time property inspector for remote node objects
- **nodePath** - Godot path syntax for referencing nodes (e.g., `../Sprite2D`, `Node/Child`)
- **resourcePath** - `res://` path to a Godot resource file

## Godot Versions

- **Godot 3** - Legacy Godot version (GDScript 1.x)
- **Godot 4** - Current Godot version (GDScript 2.x with significant syntax changes)

## VS Code Extension Concepts

- **Provider** - VS Code API pattern for providing language features (e.g., `HoverProvider`, `DefinitionProvider`)
- **Command** - User-invokable action registered with VS Code
- **Context** - VS Code extension context, stores subscriptions and global state