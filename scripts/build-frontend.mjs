import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const srcDir = path.join(root, 'src', 'frontend');
const outputPath = path.join(root, 'index.html');

try {
  const skeleton = fs.readFileSync(path.join(srcDir, 'index.html'), 'utf8');
  const css = fs.readFileSync(path.join(srcDir, 'style.css'), 'utf8');
  const js = fs.readFileSync(path.join(srcDir, 'app.js'), 'utf8');

  // Replace placeholders
  let compiled = skeleton
    .replace('/* CSS will be injected here */', css)
    .replace('/* JS will be injected here */', js);

  fs.writeFileSync(outputPath, compiled, 'utf8');
  console.log('Frontend built successfully! Compiled index.html');
} catch (err) {
  console.error('Failed to build frontend:', err);
  process.exit(1);
}
