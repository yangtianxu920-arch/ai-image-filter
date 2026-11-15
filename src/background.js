importScripts('i18n.js');
const T = self.AIF_T;

// 元数据检查：读取图片开头的字节，查找生成工具写入的标记。
// 只对通用网页启用；小红书 / Pinterest 的 CDN 会重新压缩图片并抹掉元数据。
const MAX_BYTES = 512 * 1024;
const cache = new Map();

const MARKERS = [
  [/trainedAlgorithmicMedia/i, T('metaC2pa')],
  [/tEXtparameters\0[\s\S]{0,6000}?Steps: \d+/, T('metaSd')],
  [/tEXtSoftware\0NovelAI/, T('metaNovelAi')],
  [/tEXtprompt\0\{[\s\S]*?class_type/, T('metaComfy')],
  [/Midjourney|Stable Diffusion|NovelAI|ComfyUI|Adobe Firefly|DALL.{1,2}E[ -]?[23]/, T('metaTool')],
];

async function readHead(url) {
  const res = await fetch(url, {
    headers: { Range: `bytes=0-${MAX_BYTES - 1}` },
    credentials: 'omit',
    cache: 'force-cache',
  });
  if (!res.ok || !res.body) return '';
  const reader = res.body.getReader();
  const dec = new TextDecoder('latin1');
  let out = '';
  let total = 0;
  while (total < MAX_BYTES) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    out += dec.decode(value, { stream: true });
  }
  reader.cancel().catch(() => {});
  return out;
}

async function checkMeta(url) {
  if (cache.has(url)) return cache.get(url);
  let result = { ai: false };
  try {
    const head = await readHead(url);
    for (const [re, reason] of MARKERS) {
      if (re.test(head)) {
        result = { ai: true, reason };
        break;
      }
    }
  } catch {
    // 取不到就当作没有信号
  }
  if (cache.size > 2000) cache.clear();
  cache.set(url, result);
  return result;
}

// ---------- 本地模型（可选） ----------
// 模型跑在离屏页面里；这里只负责开关它、转发请求、记录下载状态。
const MODEL_DEFAULTS = { model: false };
let creating = null;

async function ensureOffscreen() {
  if (await chrome.offscreen.hasDocument()) return;
  if (!creating) {
    creating = chrome.offscreen
      .createDocument({
        url: 'offscreen/offscreen.html',
        reasons: ['WORKERS'],
        justification: T('offscreenWhy'),
      })
      .finally(() => (creating = null));
  }
  await creating;
}

async function closeOffscreen() {
  if (await chrome.offscreen.hasDocument()) await chrome.offscreen.closeDocument();
}

// force：右键手动检查时，即使没开"用模型识别图片本身"也照样检查
async function runModel(url, force) {
  const s = await chrome.storage.local.get(MODEL_DEFAULTS);
  if (!s.model && !force) return { off: true };
  await ensureOffscreen();
  return chrome.runtime.sendMessage({ type: 'infer', url });
}

// ---------- 右键菜单：手动检查任意图片或图片链接 ----------
// 页面上有些图不是普通的图片元素（背景图、只有链接等），自动扫描看不到，用这个兜底。
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: 'aif-check', title: T('menuCheck'), contexts: ['image', 'link'] });
  });
});

function describe(res) {
  if (!res || res.error) return T('checkFailed');
  if (res.blurry) return T('checkBlurry');
  if (res.tiles) {
    return res.hits
      ? T('checkCollageHit', res.tiles, res.hits)
      : T('checkCollageClean', res.tiles);
  }
  if (typeof res.p !== 'number') return T('checkSmall');
  const pct = (Math.floor(res.p * 1000) / 10).toFixed(1);
  const verdict = T(res.ai ? 'verdictAi' : res.unsure ? 'verdictUnsure' : 'verdictClean');
  return T('checkScore', verdict, pct);
}

async function checkFromMenu(url, tabId) {
  const toast = (text, busy) => chrome.tabs.sendMessage(tabId, { type: 'toast', text, busy }).catch(() => {});
  if (!/^https?:/.test(url || '')) return toast(T('checkNoUrl'));
  toast(T('checkBusy'), true);
  let res;
  try {
    res = await runModel(url, true);
  } catch (e) {
    res = { error: String(e) };
  }
  toast(describe(res));
}

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'aif-check' && tab && tab.id != null) checkFromMenu(info.srcUrl || info.linkUrl, tab.id);
});

async function fetchImage(url) {
  const r = await fetch(url, { credentials: 'omit', cache: 'force-cache' });
  if (!r.ok) return {};
  const bytes = new Uint8Array(await r.arrayBuffer());
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return { dataUrl: `data:${r.headers.get('content-type') || 'image/jpeg'};base64,${btoa(bin)}` };
}

async function syncModel() {
  const s = await chrome.storage.local.get(MODEL_DEFAULTS);
  if (!s.model) {
    await closeOffscreen();
    await chrome.storage.local.set({ modelStatus: { state: 'off' } });
    return;
  }
  await ensureOffscreen();
  chrome.runtime.sendMessage({ type: 'loadModel' }).catch(() => {});
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.model) syncModel();
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg) return;
  if (msg.type === 'meta' && /^https?:/.test(msg.url)) {
    checkMeta(msg.url).then(sendResponse);
    return true;
  }
  if (msg.type === 'model' && /^https?:/.test(msg.url)) {
    runModel(msg.url).then(sendResponse, (e) => sendResponse({ error: String((e && e.message) || e) }));
    return true;
  }
  if (msg.type === 'fetchImage' && /^https?:/.test(msg.url)) {
    fetchImage(msg.url).then(sendResponse, () => sendResponse({}));
    return true;
  }
  if (msg.type === 'modelStatus') {
    chrome.storage.local.set({ modelStatus: msg.status });
  }
});
