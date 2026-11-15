// 运行：node test/detect.test.js
const assert = require('assert');
const { LABEL } = require('../src/detect.js');

// 平台标识
for (const t of ['作者声明：笔记含AI合成内容', '疑似包含AI创作信息，请谨慎甄别', '疑似AI生成', 'AI modified', 'AI-generated']) {
  assert.ok(LABEL.test(t), t);
}

// 普通文字、单纯提到 AI 的文字都不算
for (const t of ['今天天气不错', 'AI', '#AI', 'AI绘画日常', '趁人多做点ai扫盲', '挂了描AI图的画师', 'midjourney']) {
  assert.ok(!LABEL.test(t), t);
}

console.log('all detect tests passed');
