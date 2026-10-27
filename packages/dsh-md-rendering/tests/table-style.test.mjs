import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';

const client = readFileSync(new URL('../client.js', import.meta.url), 'utf8');
const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

test('table styles stay scoped to assistant chat and use one cell background', () => {
  assert.match(client, /\[data-chat-flow-kind="assistant-step"\] div > table th/);
  assert.match(client, /background: var\(--dsw-alias-bg-base\)/);
  assert.doesNotMatch(client, /tr:nth-child\(even\)|opacity:\s*\.7/);
  assert.match(client, /overflow-x: auto/);
});

test('bundle exports its client and distribution resources', () => {
  assert.equal(manifest.dsh.bundle.patch, './cordis.patch.yml');
  assert.equal(manifest.exports['./client'], './client.js');
  for (const file of ['client.js', 'index.js', 'cordis.patch.yml', 'icon.svg']) {
    assert.ok(manifest.files.includes(file), `${file} must be packaged`);
  }
});
