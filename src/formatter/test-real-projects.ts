// Test parser against real-world Godot projects
import { parser } from './grammar/generated/gdscript.js';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { glob } from 'glob';

async function main() {
  console.log('=== Real-World Project Parser Test ===\n');
  
  const projects = [
    { path: 'P:\\isotope', name: 'Isotope' },
    { path: 'P:\\SkyknightsOnline', name: 'SkyknightsOnline' },
  ];
  
  let totalFiles = 0;
  let totalLines = 0;
  let totalPassed = 0;
  let totalFailed = 0;
  
  for (const project of projects) {
    console.log(`Scanning ${project.name}...`);
    
    if (!fs.existsSync(project.path)) {
      console.log(`  Project not found: ${project.path}\n`);
      continue;
    }
    
    const pattern = path.join(project.path, '**/*.gd').replace(/\\/g, '/');
    const files = await glob(pattern);
    
    let passed = 0;
    let failed = 0;
    let lines = 0;
    
    for (const file of files) {
      try {
        const source = fs.readFileSync(file, 'utf-8');
        lines += source.split('\n').length;
        
        const tree = parser.parse(source);
        const treeStr = tree.toString();
        const errorCount = (treeStr.match(/⚠/g) || []).length;
        
        if (errorCount > 0) {
          failed++;
        } else {
          passed++;
        }
      } catch (e) {
        failed++;
      }
    }
    
    totalFiles += files.length;
    totalLines += lines;
    totalPassed += passed;
    totalFailed += failed;
    
    const rate = files.length > 0 ? ((passed / files.length) * 100).toFixed(1) : 'N/A';
    console.log(`  Files: ${files.length}`);
    console.log(`  Lines: ${lines.toLocaleString()}`);
    console.log(`  Passed: ${passed}`);
    console.log(`  Failed: ${failed}`);
    console.log(`  Pass rate: ${rate}%\n`);
  }
  
  console.log('=== Total ===');
  console.log(`Files: ${totalFiles}`);
  console.log(`Lines: ${totalLines.toLocaleString()}`);
  console.log(`Passed: ${totalPassed}`);
  console.log(`Failed: ${totalFailed}`);
  console.log(`Pass rate: ${((totalPassed / totalFiles) * 100).toFixed(1)}%`);
}

main().catch(console.error);