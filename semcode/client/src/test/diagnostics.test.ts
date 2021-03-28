import * as qv from 'vscode';
import * as assert from 'assert';
import { getDocUri, activate } from './helper';

suite('Should get diagnostics', () => {
  const docUri = getDocUri('diagnostics.txt');
  test('Diagnoses uppercase texts', async () => {
    await testDiagnostics(docUri, [
      { message: 'ANY is all uppercase.', range: toRange(0, 0, 0, 3), severity: qv.DiagnosticSeverity.Warning, source: 'ex' },
      { message: 'ANY is all uppercase.', range: toRange(0, 14, 0, 17), severity: qv.DiagnosticSeverity.Warning, source: 'ex' },
      { message: 'OS is all uppercase.', range: toRange(0, 18, 0, 20), severity: qv.DiagnosticSeverity.Warning, source: 'ex' },
    ]);
  });
});

function toRange(sLine: number, sChar: number, eLine: number, eChar: number) {
  const start = new qv.Position(sLine, sChar);
  const end = new qv.Position(eLine, eChar);
  return new qv.Range(start, end);
}

async function testDiagnostics(r: qv.Uri, d: qv.Diagnostic[]) {
  await activate(r);
  const v = qv.languages.getDiagnostics(r);
  assert.strictEqual(v.length, d.length);
  d.forEach((x, i) => {
    const y = v[i];
    assert.strictEqual(y.message, x.message);
    assert.deepStrictEqual(y.range, x.range);
    assert.strictEqual(y.severity, x.severity);
  });
}
