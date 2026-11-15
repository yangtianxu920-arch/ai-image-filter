(() => {
  const D = self.AIF_DETECT;
  const T = self.AIF_T;
  const host = location.hostname;
  const SITE = /(^|\.)(xiaohongshu|rednote)\.com$/.test(host)
    ? 'xhs'
    : /(^|\.)pinterest\.[a-z.]+$/.test(host)
      ? 'pin'
      : 'generic';

  // aiNotes: 笔记ID -> 原因；okNotes: 用户点过"不是AI"的笔记；aiAuthors: 作者ID -> { name, notes: [笔记ID] }
  const DEFAULTS = {
    enabled: true, mode: 'badge', weak: true, meta: true,
    model: false, modelStatus: { state: 'off' },
    aiNotes: {}, okNotes: {}, aiAuthors: {},
  };
  let S = { ...DEFAULTS };
  let alive = true; // 扩展被重新加载后旧脚本会失效

  function save(patch) {
    try {
      chrome.storage.local.set(patch);
    } catch {
      alive = false;
    }
  }

  // ---------- 标记 ----------
  const badges = new WeakMap();

  function setMark(el, anchor, v) {
    const sig = v ? `${v.level}|${v.text || ''}|${v.reason}` : '';
    const old = badges.get(el);
    if ((el.dataset.aifSig || '') === sig && (!v || (old && old.isConnected))) return;
    if (old) old.remove();
    badges.delete(el);
    el.dataset.aifSig = sig;
    if (!v) {
      delete el.dataset.aif;
      return;
    }
    el.dataset.aif = v.level;
    if (!anchor) return;
    if (getComputedStyle(anchor).position === 'static') anchor.classList.add('aif-host');
    const b = document.createElement('span');
    b.className = `aif-badge aif-${v.level}`;
    b.textContent = v.text || T(v.level === 'ai' ? 'badgeAi' : 'badgeWeak');
    b.title = v.reason;
    anchor.appendChild(b);
    badges.set(el, b);
  }

  function clearAll() {
    document.querySelectorAll('.aif-badge, .aif-ctl, .aif-pill').forEach((e) => e.remove());
    document.querySelectorAll('[data-aif-sig]').forEach((e) => {
      delete e.dataset.aif;
      delete e.dataset.aifSig;
    });
  }

  // ---------- 本地模型（可选） ----------
  // 判定门槛写死在 infer.js 里，不开放给用户调。红色角标只给把握极高的图文；
  // 视频封面误判多，拼图里只有个别小图像 AI 时也不确定，这两种最多给黄色提示。
  const modelRes = new Map(); // 图片地址 -> 'pending' | 'error' | { ai, part }
  const modelQueue = [];
  let modelRunning = 0;

  function modelPump() {
    while (alive && modelRunning < 2 && modelQueue.length) {
      // 后进先出：优先判断刚滚到眼前的图；已经滚走的先放弃，回来时再排队
      const [key, url, img] = modelQueue.pop();
      if (!img.isConnected || !near(img)) {
        modelRes.delete(key);
        continue;
      }
      modelRunning++;
      const done = (res) => {
        modelRunning--;
        if (res && res.off) modelRes.delete(key);
        else if (!res || res.error) modelRes.set(key, 'error');
        else modelRes.set(key, { ai: !!res.ai, part: !!res.part, unsure: !!res.unsure }); // 太小或太糊的图不判，算作已检查
        schedule(); // 每出一个结果都刷新角标和右下角的进度
        modelPump();
      };
      try {
        chrome.runtime.sendMessage({ type: 'model', url }, (res) => {
          void chrome.runtime.lastError;
          done(res);
        });
      } catch {
        alive = false;
        modelRunning--;
      }
    }
  }

  // 页面底部的进度提示：让人分得清"还在检查"和"检查完了、没发现"
  const stats = { total: 0, pending: 0, found: 0, failed: 0 };
  let pill = null;

  function updatePill() {
    let text = '';
    if (S.enabled && S.model) {
      const st = (S.modelStatus || {}).state;
      if (st === 'error') text = T('pillError', S.modelStatus.msg);
      else if (stats.pending && st === 'downloading') text = T('pillDownloading', S.modelStatus.pct);
      else if (stats.pending && st !== 'ready') text = T('pillLoading');
      else if (stats.pending) text = T('pillChecking', stats.total - stats.pending, stats.total);
      else if (!stats.total) text = T('pillNone');
      else {
        text = stats.found ? T('pillFound', stats.total, stats.found) : T('pillClean', stats.total);
        if (stats.failed) text += T('pillFailed', stats.failed);
      }
    }
    if (!text) {
      if (pill) pill.remove();
      pill = null;
      return;
    }
    if (!pill || !pill.isConnected) {
      pill = document.createElement('div');
      pill.className = 'aif-pill';
      pill.title = T('pillTitle');
      document.documentElement.appendChild(pill);
    }
    const busy = stats.pending ? '1' : '0';
    if (pill.dataset.busy !== busy) pill.dataset.busy = busy;
    if (pill.textContent !== text) pill.textContent = text;
  }

  // 右键"用 AI 过滤器检查这张图片"的结果提示
  let toast = null;
  let toastTimer = 0;
  try {
    chrome.runtime.onMessage.addListener((msg) => {
      if (!msg || msg.type !== 'toast' || window !== window.top) return;
      if (!toast || !toast.isConnected) {
        toast = document.createElement('div');
        toast.className = 'aif-toast';
        document.documentElement.appendChild(toast);
      }
      toast.textContent = T('toastPrefix') + msg.text;
      clearTimeout(toastTimer);
      if (!msg.busy) toastTimer = setTimeout(() => toast && toast.remove(), 9000);
    });
  } catch {
    alive = false;
  }

  // 只处理视口附近的图片，省算力
  function near(el) {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.bottom > -400 && r.top < innerHeight + 800;
  }

  // 文字信号不够明确时，用模型的结果补上
  function withModel(v, img, isVideo) {
    if (!S.model || (v && v.level === 'ai') || !img) return v;
    const url = img.currentSrc || img.src;
    if (!/^https?:/.test(url)) return v;
    const key = url;
    let r = modelRes.get(key);
    if (r === undefined) {
      if (!near(img)) return v;
      r = 'pending';
      modelRes.set(key, r);
      modelQueue.push([key, url, img]);
      modelPump();
    }
    stats.total++;
    if (r === 'pending') {
      stats.pending++;
      // 还没判完的图给一个灰色记号，这样"没有角标"就明确表示"检查过、没发现"
      return v || { level: 'pending', text: T('pending'), reason: T('pendingReason') };
    }
    if (r === 'error') {
      stats.failed++;
      return v;
    }
    // 不显示百分比，那个数字并不可靠
    if (!r.ai && !r.part && !r.unsure) return v;
    stats.found++;
    if (r.unsure) return v || { level: 'weak', text: T('modelMaybe'), reason: T('reasonModelUnsure') };
    if (r.part) return v || { level: 'weak', text: T('modelPart'), reason: T('reasonModelPart') };
    if (!isVideo) return { level: 'ai', text: T('modelAi'), reason: T('reasonModelAi') };
    return v || { level: 'weak', text: T('modelMaybe'), reason: T('reasonModelVideo') };
  }

  // ---------- 小红书 / rednote ----------
  const noteIdOf = (href) => (String(href || '').match(/\/([0-9a-f]{24})(?:[/?#]|$)/) || [])[1];
  const authorIdOf = (href) => (String(href || '').match(/\/user\/profile\/([0-9a-f]+)/) || [])[1];

  // 记录里存的是与语言无关的代号（manual / label:原文），显示时再翻译；也兼容旧版本存的中文
  function reasonText(code) {
    if (code === 'manual' || code === '手动标记') return T('reasonManual');
    if (code.startsWith('label:')) return T('reasonLabel', code.slice(6));
    if (code.startsWith('平台标识：')) return T('reasonLabel', code.slice(5));
    return code;
  }

  function remember(noteId, authorId, name, reason) {
    const patch = {};
    S.aiNotes[noteId] = reason;
    patch.aiNotes = S.aiNotes;
    if (authorId) {
      const a = S.aiAuthors[authorId] || { name: name || '', notes: [] };
      if (!a.notes.includes(noteId)) a.notes.push(noteId);
      if (name) a.name = name;
      S.aiAuthors[authorId] = a;
      patch.aiAuthors = S.aiAuthors;
    }
    save(patch);
  }

  function forget(noteId) {
    delete S.aiNotes[noteId];
    S.okNotes[noteId] = 1;
    for (const id of Object.keys(S.aiAuthors)) {
      const a = S.aiAuthors[id];
      a.notes = a.notes.filter((n) => n !== noteId);
      if (!a.notes.length) delete S.aiAuthors[id];
    }
    save({ aiNotes: S.aiNotes, okNotes: S.okNotes, aiAuthors: S.aiAuthors });
  }

  function cardVerdict(noteId, authorId) {
    if (noteId && S.okNotes[noteId]) return null;
    if (noteId && S.aiNotes[noteId]) return { level: 'ai', reason: reasonText(S.aiNotes[noteId]) };
    // 标题里写了"AI"不代表图是 AI 生成的（教程、讨论、吐槽都会提到），所以不看文字
    const a = authorId && S.aiAuthors[authorId];
    if (a && a.notes.length) return { level: 'weak', reason: T('reasonAuthor', a.notes.length) };
    return null;
  }

  function scanXhsCards() {
    document.querySelectorAll('section.note-item').forEach((card) => {
      const cover = card.querySelector('a.cover');
      if (!cover) return;
      const noteId = noteIdOf(cover.getAttribute('href'));
      const author = card.querySelector('a.author');
      const authorId = author && authorIdOf(author.getAttribute('href'));
      const okd = noteId && S.okNotes[noteId];
      const v = cardVerdict(noteId, authorId);
      // 视频封面是视频帧，模型在上面更容易误判，所以只给黄色的"疑似"提示
      const isVideo = !!cover.querySelector('.play-icon');
      setMark(cover, cover, okd ? v : withModel(v, cover.querySelector('img'), isVideo));
    });
  }

  function findPlatformLabel(nc) {
    for (const e of nc.querySelectorAll('span, div, p, a')) {
      if (e.children.length) continue;
      const t = e.textContent.trim();
      if (!t || t.length > 40) continue;
      if (e.closest('#detail-desc, #detail-title, .author-wrapper, [class*="comment"], .aif-badge, .aif-ctl')) continue;
      if (D.LABEL.test(t)) return t;
    }
    return null;
  }

  let ctl = null;

  function scanXhsDetail() {
    const nc = document.querySelector('#noteContainer');
    const media = nc && nc.querySelector('.media-container');
    const noteId = noteIdOf(location.pathname);
    if (!media || !noteId) return;
    const authorLink = nc.querySelector('.author-wrapper a[href*="/user/profile/"]');
    const authorId = authorLink && authorIdOf(authorLink.getAttribute('href'));
    const authorName = ((nc.querySelector('.username') || {}).textContent || '').trim();

    let v = null;
    if (!S.okNotes[noteId]) {
      if (S.aiNotes[noteId]) {
        v = { level: 'ai', reason: reasonText(S.aiNotes[noteId]) };
      } else {
        const label = findPlatformLabel(nc);
        // 只认平台自己打的 AI 声明；标题、正文、标签里的字眼不作为依据
        if (label) {
          v = { level: 'ai', reason: T('reasonLabel', label) };
          remember(noteId, authorId, authorName, `label:${label}`);
        }
      }
      // 模型的判断只用于显示，不写入记录，也不连带作者
      if (!media.querySelector('video')) {
        const shown = [...media.querySelectorAll('img')].find((i) => i.width > 100 && near(i));
        v = withModel(v, shown);
      }
    }
    setMark(media, media, v);

    // 手动纠错按钮
    if (!ctl || !ctl.isConnected || ctl.parentElement !== media) {
      if (ctl) ctl.remove();
      ctl = document.createElement('button');
      ctl.className = 'aif-ctl';
      ctl.addEventListener('click', (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        const d = ctl.dataset;
        if (d.flagged === '1') forget(d.note);
        else {
          delete S.okNotes[d.note];
          save({ okNotes: S.okNotes });
          remember(d.note, d.author, d.name, 'manual');
        }
        scan();
      });
      media.appendChild(ctl);
    }
    const flagged = !!(v && v.level === 'ai');
    Object.assign(ctl.dataset, { note: noteId, author: authorId || '', name: authorName, flagged: flagged ? '1' : '0' });
    const text = T(flagged ? 'ctlNotAi' : 'ctlMarkAi');
    if (ctl.textContent !== text) ctl.textContent = text; // 不重复写，避免触发自己的 MutationObserver
  }

  // ---------- Pinterest ----------
  function scanPinterest() {
    document.querySelectorAll('[data-grid-item="true"]').forEach((card) => {
      const img = card.querySelector('img');
      if (!img) return;
      // 只认 Pinterest 自己打的短标签（如 "AI modified"），不看图片描述里的字眼
      const label = [...card.querySelectorAll('span, div')].some(
        (e) => !e.children.length && e.textContent.length < 30 && D.LABEL.test(e.textContent),
      );
      const v = label ? { level: 'ai', reason: T('reasonLabel', 'AI') } : null;
      setMark(card, card, withModel(v, img));
    });
  }

  // ---------- 通用网页 ----------
  const meta = new Map(); // 图片地址 -> 'pending' | 判定 | null
  const queue = [];
  let running = 0;
  let metaCount = 0;

  function pump() {
    while (alive && running < 3 && queue.length) {
      const url = queue.shift();
      running++;
      const done = (res) => {
        running--;
        meta.set(url, res && res.ai ? { level: 'ai', reason: res.reason } : null);
        if (res && res.ai) schedule();
        pump();
      };
      try {
        chrome.runtime.sendMessage({ type: 'meta', url }, (res) => {
          void chrome.runtime.lastError;
          done(res);
        });
      } catch {
        alive = false;
        running--;
      }
    }
  }

  function scanGeneric() {
    for (const img of document.images) {
      if (img.width < 150 || img.height < 150) continue;
      let v = null; // 不看图片周围的文字，只看元数据和模型
      const url = img.currentSrc || img.src;
      if (!v && S.meta && /^https?:/.test(url) && img.width >= 200) {
        const m = meta.get(url);
        if (m === undefined && metaCount < 300) {
          metaCount++;
          meta.set(url, 'pending');
          queue.push(url);
        } else if (m && m !== 'pending') {
          v = m;
        }
      }
      setMark(img, img.parentElement, img.width >= 200 ? withModel(v, img) : v);
    }
    pump();
  }

  // ---------- 调度 ----------
  function scan() {
    if (!alive || !S.enabled) return;
    stats.total = stats.pending = stats.found = stats.failed = 0;
    if (SITE === 'xhs') {
      scanXhsDetail(); // 先看详情页，学到的结果马上用在封面上
      scanXhsCards();
    } else if (SITE === 'pin') scanPinterest();
    else scanGeneric();
    updatePill();
  }

  let timer = 0;
  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(scan, 400);
  }

  function applySettings() {
    const root = document.documentElement;
    if (S.enabled) {
      root.dataset.aifMode = S.mode;
      root.dataset.aifWeak = S.weak ? '1' : '0';
    } else {
      delete root.dataset.aifMode;
      delete root.dataset.aifWeak;
      clearAll();
    }
  }

  chrome.storage.local.get(DEFAULTS, (got) => {
    S = got;
    // 清掉旧版本按标题 / 标签字眼记下的笔记，只保留平台标识和手动标记
    let purged = false;
    for (const id of Object.keys(S.aiNotes)) {
      if (/^(平台标识|手动标记|manual$|label:)/.test(S.aiNotes[id])) continue;
      delete S.aiNotes[id];
      purged = true;
      for (const aid of Object.keys(S.aiAuthors)) {
        const a = S.aiAuthors[aid];
        a.notes = a.notes.filter((n) => n !== id);
        if (!a.notes.length) delete S.aiAuthors[aid];
      }
    }
    if (purged) save({ aiNotes: S.aiNotes, aiAuthors: S.aiAuthors });
    applySettings();
    scan();
    new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true });
    addEventListener('scroll', schedule, { passive: true, capture: true });
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;
      if (changes.modelStatus) {
        // 下载进度只需要刷新右下角的提示，不用重新扫描页面
        S.modelStatus = changes.modelStatus.newValue || DEFAULTS.modelStatus;
        delete changes.modelStatus;
        updatePill();
      }
      if (!Object.keys(changes).length) return;
      for (const k of Object.keys(changes)) S[k] = changes[k].newValue === undefined ? DEFAULTS[k] : changes[k].newValue;
      applySettings();
      schedule();
    });
  });
})();
