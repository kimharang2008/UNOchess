import test from 'node:test';
import assert from 'node:assert/strict';

test('브라우저 앱의 HTML, 스타일, ES 모듈이 개발 서버에서 제공된다', async () => {
  for (const [path, expected] of [
    ['/', '우노체스'],
    ['/style.css', '.board'],
    ['/src/app.js', 'drawAndResolve'],
    ['/src/chess.js', 'isCheckmated'],
    ['/src/uno.js', 'resolveCard'],
  ]) {
    const response = await fetch(`http://127.0.0.1:4173${path}`);
    assert.equal(response.status, 200, `${path} should return HTTP 200`);
    const content = await response.text();
    assert.ok(content.includes(expected), `${path} should contain its application content`);
  }
});
