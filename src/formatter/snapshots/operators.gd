# --- IN ---
func f():
	# arithmetic
    x += 1
	x -= 1
	x *= 1
	x /= 1
	x %= 1
	x = 2 ** 2
	x = 2 * -1
	x **= 2
	
    # bitwise
    x |= 1
	x &= 1
	x ^= 1
	x ~= 1
	x = ~1
	x /= 1
	x >>= 1
	x <<= 1

	x = 1 << 1 | 1 >> 3
	x = 1 << 1 & 1 >> 3
	x = 1 ^ ~1

	print(x == 1)
	print(x <= 1)
	print(x >= 1)

	var ij := 1
	var k := -ij + 1
	var m := 0 + -ij
