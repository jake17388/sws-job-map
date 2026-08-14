import { readFileSync } from 'node:fs';
import vm from 'node:vm';

for (const file of ['Code.js']) {
  new vm.Script(readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'), { filename: file });
}

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)]
  .map(match => match[1])
  .filter(source => source.trim());
scripts.forEach((source, index) => new vm.Script(source, { filename: `index.html#script-${index + 1}` }));

console.log(`syntax ok (${scripts.length + 1} scripts)`);
