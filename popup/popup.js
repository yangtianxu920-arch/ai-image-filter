const DEFAULTS = {
  enabled: true, mode: 'badge', weak: true, meta: true,
  model: false, modelStatus: { state: 'off' },
  aiNotes: {}, okNotes: {}, aiAuthors: {},
};
const $ = (id) => document.getElementById(id);

function statusText(s) {
  if (!s.model) return '';
  const st = s.modelStatus || {};
  if (st.state === 'downloading') return `正在下载模型… ${st.pct}%`;
  if (st.state === 'loading') return '正在加载模型…';
  if (st.state === 'ready') return '模型已就绪';
  if (st.state === 'error') return `出错：${st.msg}`;
  return '正在启动…';
}

function render(s) {
  $('enabled').checked = s.enabled;
  $('weak').checked = s.weak;
  $('meta').checked = s.meta;
  $('model').checked = s.model;
  $('modelStatus').textContent = statusText(s);
  document.querySelectorAll('input[name="mode"]').forEach((r) => (r.checked = r.value === s.mode));
  $('stats').textContent = `已记录 ${Object.keys(s.aiNotes).length} 篇 AI 笔记，${Object.keys(s.aiAuthors).length} 位作者`;
}

const refresh = () => chrome.storage.local.get(DEFAULTS, render);
refresh();
chrome.storage.onChanged.addListener(refresh);

for (const id of ['enabled', 'weak', 'meta', 'model']) {
  $(id).addEventListener('change', (e) => chrome.storage.local.set({ [id]: e.target.checked }));
}
document.querySelectorAll('input[name="mode"]').forEach((r) =>
  r.addEventListener('change', () => chrome.storage.local.set({ mode: r.value })),
);
$('clear').addEventListener('click', () => chrome.storage.local.set({ aiNotes: {}, okNotes: {}, aiAuthors: {} }));
