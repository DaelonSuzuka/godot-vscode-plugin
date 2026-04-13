// Debug failing files
import { parser } from './grammar/generated/gdscript.js';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { glob } from 'glob';

async function main() {
  const projectPath = 'P:\\isotope';
  const pattern = path.join(projectPath, '**/*.gd').replace(/\\/g, '/');
  const files = await glob(pattern);
  
  type Sample = { file: string; errors: number; snippets: string[] };
  const samples: Sample[] = [];
  
  for (const file of files) {
    const source = fs.readFileSync(file, 'utf-8');
    const tree = parser.parse(source);
    const treeStr = tree.toString();
    const errorCount = (treeStr.match(/⚠/g) || []).length;
    
    if (errorCount > 0 && errorCount <= 10) {
      // Extract error snippets
      const cursor = tree.cursor();
      const snippets: string[] = [];
      do {
        if (cursor.name === '⚠') {
          const text = source.slice(cursor.from, cursor.to);
          const line = source.slice(0, cursor.from).split('\n').length;
          snippets.push(`L${line}: "${text}"`);
        }
      } while (cursor.next());
      
      samples.push({ file: path.basename(file), errors: errorCount, snippets: snippets.slice(0, 5) });
      if (samples.length >= 20) break;
    }
  }
  
  console.log('Files with few errors:\n');
  for (const s of samples) {
    console.log(`${s.file} (${s.errors} errors)`);
    for (const snippet of s.snippets) {
      console.log(`  ${snippet}`);
    }
    console.log();
  }
}

main().catch(console.error);