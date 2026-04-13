import { parser } from './grammar/generated/gdscript.js';

const tests = [
  // Basics
  'var x = 5',
  'const X = 5',
  'func foo():',
  'func foo() -> int:',
  '@export',
  '@export var x',
  '$"Node"',
  '[1, 2]',
  '[]',
  '{}',
  'x[0]',
  '5 + 3',
  '5 * 3',
  'x.y',
  'foo()',
  
  // Empty strings
  '""',
  "''",
  'var x = ""',
  
  // Function parameters
  'func foo(a):',
  'func foo(a: int):',
  'func foo(a, b):',
  'func foo(a: int, b: String):',
  
  // Signal with params
  'signal test(a, b)',
  
  // Function calls with args
  'foo(1)',
  'foo(1, 2)',
  'foo(a, b)',
  
  // Multi-line friendly
  'var x: int = 5',
];

console.log('Grammar test:');
let passed = 0;
for (const t of tests) {
  const tree = parser.parse(t);
  const errors = (tree.toString().match(/⚠/g) || []).length;
  if (errors === 0) {
    passed++;
    console.log(`  OK: ${t}`);
  } else {
    console.log(`  FAIL: ${t} -> ${tree.toString()}`);
  }
}
console.log(`\nPassed: ${passed}/${tests.length}`);