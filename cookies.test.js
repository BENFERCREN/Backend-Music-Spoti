import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { withCookieFile } from './server.js';

test('cookies use isolated writable copies and clean up on success and failure', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'sirilo-test-'));
  try {
    const source = join(dir, 'input.txt');
    const content = '# Netscape HTTP Cookie File\n.youtube.com\tTRUE\t/\tTRUE\t2000000000\tTEST\tfake-value\n';
    await writeFile(source, content);
    let copies = [];
    await Promise.all([1, 2].map(() => withCookieFile(source, async file => {
      copies.push(file);
      assert.equal(await readFile(file, 'utf8'), content);
      await writeFile(file, 'changed');
    })));
    assert.notEqual(copies[0], copies[1]);
    assert.equal(await readFile(source, 'utf8'), content);
    for (const file of copies) await assert.rejects(access(file));
    let failedCopy;
    await assert.rejects(withCookieFile(source, file => {
      failedCopy = file;
      throw new Error('test failure');
    }));
    await assert.rejects(access(failedCopy));
    await writeFile(source, 'invalid secret');
    await assert.rejects(withCookieFile(source, () => assert.fail()), /formato Netscape/);
    await assert.rejects(withCookieFile(join(dir, 'missing'), () => assert.fail()), /formato Netscape/);
    assert.equal(await withCookieFile('', file => file), null);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
