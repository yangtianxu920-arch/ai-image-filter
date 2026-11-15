// 元数据检查：读取图片开头的字节，查找生成工具写入的标记。
// 只对通用网页启用；小红书 / Pinterest 的 CDN 会重新压缩图片并抹掉元数据。
const MAX_BYTES = 512 * 1024;
const cache = new Map();

const MARKERS = [
  [/trainedAlgorithmicMedia/i, '元数据：C2PA / IPTC 声明为 AI 生成或合成'],
  [/tEXtparameters\0[\s\S]{0,6000}?Steps: \d+/, '元数据：Stable Diffusion 生成参数'],
  [/tEXtSoftware\0NovelAI/, '元数据：NovelAI'],
  [/tEXtprompt\0\{[\s\S]*?class_type/, '元数据：ComfyUI 工作流'],
  [/Midjourney|Stable Diffusion|NovelAI|ComfyUI|Adobe Firefly|DALL.{1,2}E[ -]?[23]/, '元数据：提到 AI 生成工具'],
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
        justification: '在本地运行 AI 图片检测模型',
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
    chrome.contextMenus.create({ id: 'aif-check', title: '用 AI 过滤器检查这张图片', contexts: ['image', 'link'] });
  });
});

function describe(res) {
  if (!res || res.error) return '检查失败：这不是图片，或者图片读取不到';
  if (res.blurry) return '图片太模糊，无法判断';
  if (res.tiles) {
    return res.hits
      ? `这是拼图：${res.tiles} 格里有 ${res.hits} 格被模型判为 AI`
      : `这是拼图：${res.tiles} 格都没有被模型判为 AI`;
  }
  if (typeof res.p !== 'number') return '图片太小，无法判断';
  const pct = (Math.floor(res.p * 1000) / 10).toFixed(1);
  const verdict = res.ai ? '判为 AI' : res.unsure ? '疑似 AI（把握不够）' : '未判为 AI';
  return `${verdict}。模型分数 ${pct}%（达到 99% 才算，分数仅供参考）`;
}

async function checkFromMenu(url, tabId) {
  const toast = (text, busy) => chrome.tabs.sendMessage(tabId, { type: 'toast', text, busy }).catch(() => {});
  if (!/^https?:/.test(url || '')) return toast('这张图片的地址无法读取');
  toast('正在检查…（首次使用需要先下载模型）', true);
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
