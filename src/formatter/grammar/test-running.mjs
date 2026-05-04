// Quick test for the minimal GDScript parser with indentation
import { parser } from "./dist/test-index.js"

const tests = [
  // Simple statements
  "pass",
  "var x = 5",
  "x = 10",
  // Function with body
  "func foo():\n    pass",
  "func foo():\n    return 5",
  "func add(a: int, b: int):\n    return a + b",
  // Single-line body
  "func foo(): pass",
  // If/elif/else
  "if x > 0:\n    pass",
  "if x > 0:\n    var y = x\nelif x < 0:\n    var y = -x\nelse:\n    var y = 0",
  // For loop
  "for i in items:\n    pass",
  // While loop
  "while true:\n    pass",
  // Nested blocks
  "func foo():\n    if x > 0:\n        pass",
  // Multiple statements in body
  "func foo():\n    var x = 5\n    var y = 10\n    return x + y",
  // Method call
  "func foo():\n    var x = self.bar()",
  // Comments
  "func foo():\n    pass\n# comment",
]

console.log("=== Minimal GDScript Grammar Test ===\n")

let passed = 0
for (const t of tests) {
  const tree = parser.parse(t)
  const errors = (tree.toString().match(/⚠/g) || []).length
  if (errors === 0) {
    passed++
    console.log(`  OK: ${t.replace(/\n/g, '\\n')}`)
  } else {
    console.log(`  FAIL: ${t.replace(/\n/g, '\\n')}`)
    console.log(`        ${tree.toString().substring(0, 200).replace(/\n/g, '\\n')}`)
  }
}
console.log(`\nPassed: ${passed}/${tests.length}`)