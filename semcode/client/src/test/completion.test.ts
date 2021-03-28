import * as qv from 'vscode';
import * as assert from 'assert';
import { getDocUri, activate } from './helper';

suite('Should do completion', () => {
  const r = getDocUri('completion.txt');
  test('Completes JS/TS in txt file', async () => {
    await testCompletion(r, new qv.Position(0, 0), {
      items: [
        { label: 'JavaScript', kind: qv.CompletionItemKind.Text },
        { label: 'TypeScript', kind: qv.CompletionItemKind.Text },
      ],
    });
  });
});

async function testCompletion(r: qv.Uri, p: qv.Position, l: qv.CompletionList) {
  await activate(r);
  const v = (await qv.commands.executeCommand('qv.executeCompletionItemProvider', r, p)) as qv.CompletionList;
  assert.ok(v.items.length >= 2);
  l.items.forEach((x, i) => {
    const y = v.items[i];
    assert.strictEqual(y.label, x.label);
    assert.strictEqual(y.kind, x.kind);
  });
}
