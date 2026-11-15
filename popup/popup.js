const DEFAULTS = {
  enabled: true, mode: 'badge', weak: true, meta: true,
  model: false, modelStatus: { state: 'off' },
  aiNotes: {}, okNotes: {}, aiAuthors: {},
};
const $ = (id) => document.getElementById(id);
const T = self.AIF_T;
document.documentElement.lang = self.AIF_LANG === 'zh' ? 'zh-CN' : 'en';
document.querySelectorAll('[data-i18n]').forEach((e) => (e.textContent = T(e.dataset.i18n)));

function statusText(s) {
  if (!s.model) return '';
  const st = s.modelStatus || {};
  if (st.state === 'downloading') return T('stDownloading', st.pct);
  if (st.state === 'loading') return T('stLoading');
  if (st.state === 'ready') return T('stReady');
  if (st.state === 'error') return T('stError', st.msg);
  return T('stStarting');
}

function render(s) {
  $('enabled').checked = s.enabled;
  $('weak').checked = s.weak;
  $('meta').checked = s.meta;
  $('model').checked = s.model;
  $('modelStatus').textContent = statusText(s);
  document.querySelectorAll('input[name="mode"]').forEach((r) => (r.checked = r.value === s.mode));
  $('stats').textContent = T('popStats', Object.keys(s.aiNotes).length, Object.keys(s.aiAuthors).length);
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
