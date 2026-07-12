# --- IN ---
func test():

	pass
# --- OUT ---
func test():
	pass

# --- IN ---
class Test:

	func _ready():

		pass
# --- OUT ---
class Test:
	func _ready():
		pass

# --- IN ---
func test(): # with comment

	pass
# --- OUT ---
func test(): # with comment
	pass

# --- IN ---
class Test: # with comment

	func _ready(): # with comment

		pass
# --- OUT ---
class Test: # with comment
	func _ready(): # with comment
		pass

# --- CONFIG ---
{"maxEmptyLines": 1}
# --- IN ---
func a():
	pass



func b():
	pass
# --- OUT ---
func a():
	pass

func b():
	pass

# --- CONFIG ---
{"maxEmptyLines": 2}
# --- IN ---
func a():
	pass



func b():
	pass
# --- OUT ---
func a():
	pass


func b():
	pass
# --- END ---

# Blank lines at the start of the file are deleted entirely

# --- IN ---



var leading_blanks_removed = true
# --- OUT ---
var leading_blanks_removed = true
