import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {WHITE_RETOUCH_PROMPT} from '../plugins/modelscope-retouch/prompt.mjs';

test('release uses the original project white-background prompt verbatim', () => {
  assert.equal(WHITE_RETOUCH_PROMPT, [
    '白底精修图，展现珠宝的真实光泽与精致细节。',
    '精修参考图片，保留主体的设计、结构、材质和细节，不增加或改变产品部件。',
    '将背景替换为纯白色，保持自然接触阴影。',
    '优化光影与清晰度，展现金属光泽和宝石质感，避免过度锐化。',
    '去除价格标签、无关文字、灰尘和污点。',
  ].join('\n'));
});

test('client rejects a caller-supplied prompt before file or network access', () => {
  const result = spawnSync(process.execPath, [new URL('../plugins/modelscope-retouch/client.mjs',import.meta.url).pathname,
    'submit','test','/nonexistent/output','/nonexistent/input.png','保留原背景'], {encoding:'utf8'});
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Usage:/);
  assert.doesNotMatch(result.stderr, /fetch failed|ENOENT/);
});
