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
  
  // Multi-line (testing newline handling)
  'class_name Main\nextends Node',
  'class_name Main\nextends Node\nvar x = 5',
  'class_name Main\n\nextends Node',
];

console.log('Grammar test:');
let passed = 0;
for (const t of tests) {
  const tree = parser.parse(t);
  const errors = (tree.toString().match(/⚠/g) || []).length;
  if (errors === 0) {
    passed++;
    console.log(`  OK: ${t.replace(/\n/g, '\\n')}`);
  } else {
    console.log(`  FAIL: ${t.replace(/\n/g, '\\n')} -> ${tree.toString()}`);
  }
}
console.log(`\nPassed: ${passed}/${tests.length}`);