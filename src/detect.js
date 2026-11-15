// 文字方面只认平台自己打的 AI 标识（小红书"作者声明 / 疑似 AI"、Pinterest "AI modified" 等）。
// 标题、正文、标签里出现"AI"不作为依据：教程、讨论、吐槽都会提到 AI，写了不代表图就是 AI 生成的。
(function (root) {
  const LABEL =
    /(?:含|包含|疑似|为)\s*AI\s*(?:合成|生成|创作)|AI\s*(?:合成|生成)\s*内容|作者声明.{0,12}AI|AI[\s-]*(?:generated|modified)|(?:created|made)\s+with\s+AI|AI\s*修改/i;

  const api = { LABEL };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.AIF_DETECT = api;
})(typeof self !== 'undefined' ? self : globalThis);
