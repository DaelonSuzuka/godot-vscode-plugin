# --- CONFIG ALL ---
{"denseFunctionParameters": true}
# --- IN ---
func f(  a : int = 10  ,  b : String = "hello"  ,  c : float = 3.14  ):
	pass
# --- OUT ---
func f(a: int = 10, b: String = "hello", c: float = 3.14):
	pass

# --- IN ---
# Verify dense mode doesn't break := spacing
func g(x:=1, y:=2):
	pass

# --- IN ---
# Bug #938: Dense mode should not strip spaces inside lambda bodies
tween.finished.connect(
	func():
		_is_tween_playing = false
)
# --- IN ---
# Dense mode should still format lambda's own parameters
tween.finished.connect(
	func(  x : int = 1  ):
		_is_tween_playing = false
)
# --- OUT ---
# Dense mode should still format lambda's own parameters
tween.finished.connect(
	func(x: int = 1):
		_is_tween_playing = false
)