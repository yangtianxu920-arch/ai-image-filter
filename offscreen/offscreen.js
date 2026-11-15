// 离屏页面：扩展里唯一能长期持有模型并跑 WASM 的地方。这里只能用 chrome.runtime。
ort.env.wasm.wasmPaths = chrome.runtime.getURL('vendor/ort/');
ort.env.wasm.numThreads = self.crossOriginIsolated ? Math.min(8, navigator.hardwareConcurrency || 1) : 1;

const results = new Map(); // 图片地址 -> { ai, part, ... }

function status(s) {
  chrome.runtime.sendMessage({ type: 'modelStatus', status: s }).catch(() => {});
}

async function getBlob(url) {
  try {
    const r = await fetch(url, { credentials: 'omit', cache: 'force-cache' });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.blob();
  } catch {
    // 本页面取不到时，让后台脚本代取
    const r = await chrome.runtime.sendMessage({ type: 'fetchImage', url });
    if (!r || !r.dataUrl) throw new Error('图片获取失败');
    return (await fetch(r.dataUrl)).blob();
  }
}

async function infer(url) {
  if (results.has(url)) return results.get(url);
  const r = await AIF_INFER.judgeBlob(await getBlob(url), status);
  if (results.size > 5000) results.clear();
  results.set(url, r);
  return r;
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg) return;
  if (msg.type === 'infer') {
    infer(msg.url).then(
      (r) => sendResponse(r),
      (e) => sendResponse({ error: String((e && e.message) || e) }),
    );
    return true;
  }
  if (msg.type === 'loadModel') {
    AIF_INFER.load(status).then(
      () => sendResponse({ ok: true }),
      (e) => sendResponse({ error: String((e && e.message) || e) }),
    );
    return true;
  }
});
