// One offline product journey; no external platform, bidder submission or test framework.
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { renderLibrary } from './template-library.mjs';
const root = await mkdtemp(join(tmpdir(), 'tjl-template-kit-'));
try {
  const context = JSON.parse(await readFile(new URL('./example-context.json', import.meta.url), 'utf8'));
  context.fields.project_title = '<script>not executable</script> [not a link](https://example.invalid)';
  const input = join(root, 'input.json'); await writeFile(input, JSON.stringify(context));
  const out = join(root, 'complete');
  const result = await renderLibrary({ contextPath: input, outPath: out });
  assert.equal(result.templates, 7); assert.equal(result.unresolved, 0);
  const map = JSON.parse(await readFile(join(out, 'configuration-map.json'), 'utf8'));
  assert.equal((await readdir(out)).length, 9);
  for (const template of map.templates) {
    const bytes = await readFile(join(out, template.file));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), template.sha256);
    assert.ok(bytes.includes('FICTIONAL DEMONSTRATION INPUTS')); assert.ok(!bytes.includes('<script>'));
    assert.equal(template.platform_configuration, 'NOT_PERFORMED');
  }
  await assert.rejects(renderLibrary({ contextPath: input, outPath: out }), { code: 'EEXIST' });
  delete context.fields.agency; delete context.clauses.privacy_and_public_records;
  await writeFile(input, JSON.stringify(context));
  const partial = await renderLibrary({ contextPath: input, outPath: join(root, 'partial') });
  assert.equal(partial.unresolved, 14);
  console.log(JSON.stringify({ result: 'PASS', templates: 7, generatedFiles: 9, partialUnresolved: 14,
    workflow: 'literal input / seven documents / configuration map / preserved prior output / visible missing content' }));
} finally { await rm(root, { recursive: true, force: true }); }
