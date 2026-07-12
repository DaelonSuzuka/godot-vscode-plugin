# --- IN ---
var some_array = [1, 2, 3]

func f():
	some_array[-1] = 0
	print(some_array[-1])
# --- END ---

# Bug #889: negative indices/keys (merged from negative_indices.gd)

# --- IN ---
func f():
	some_array[-1] = 0
	print(some_array[-1])
	var x = arr[-1]
	var y = dict[-1]
	var z = {"key": [-1]}
