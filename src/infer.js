// 本地模型推理：下载并缓存 ONNX 模型，用 onnxruntime-web（WASM）在本机判断图片。
// 依赖全局 ort（vendor/ort/ort.wasm.min.js）。
(function (root) {
  // SwinV2，256 输入，Apache-2.0。在小红书封面的对比测试里明显好于之前用的两个小模型。
  const MODEL = {
    url: 'https://huggingface.co/SoldadoXara/ai-image-detector-deploy-ONNX/resolve/0df8696b5db0ab5bd72baeab571fec55d65128e7/onnx/model_uint8.onnx',
    size: 256,
    mean: [0.485, 0.456, 0.406],
    std: [0.229, 0.224, 0.225],
    aiIndex: 0,
    mb: 190,
  };
  // 判定门槛写死，不开放给用户调：宁可漏掉，也尽量不冤枉真人作品。
  const THRESHOLD = 0.99;
  const MAYBE = 0.9;
  const CACHE = 'aif-models-v2';

  let session = null;
  let loading = null;

  async function fetchModel(onProgress) {
    caches.delete('aif-models-v1').catch(() => {}); // 清掉旧版本下载的模型
    const cache = await caches.open(CACHE);
    const hit = await cache.match(MODEL.url);
    if (hit) return hit.arrayBuffer();
    const net = await fetch(MODEL.url, { credentials: 'omit' });
    if (!net.ok) throw new Error(`HTTP ${net.status}`);
    const total = Number(net.headers.get('content-length')) || MODEL.mb * 1048576;
    const reader = net.body.getReader();
    const chunks = [];
    let got = 0;
    let last = -1;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      got += value.length;
      const pct = Math.min(99, Math.floor((got / total) * 100));
      if (pct !== last) {
        last = pct;
        onProgress(pct);
      }
    }
    const blob = new Blob(chunks);
    await cache.put(MODEL.url, new Response(blob));
    return blob.arrayBuffer();
  }

  function load(onStatus) {
    onStatus = onStatus || (() => {});
    if (session) return Promise.resolve(session);
    if (!loading) {
      loading = (async () => {
        onStatus({ state: 'loading' });
        const buf = await fetchModel((pct) => onStatus({ state: 'downloading', pct }));
        onStatus({ state: 'loading' });
        session = await ort.InferenceSession.create(buf, { executionProviders: ['wasm'] });
        onStatus({ state: 'ready' });
        return session;
      })()
        .catch((e) => {
          onStatus({ state: 'error', msg: String((e && e.message) || e) });
          throw e;
        })
        .finally(() => (loading = null));
    }
    return loading;
  }

  function toTensor(source) {
    const n = MODEL.size;
    const canvas = new OffscreenCanvas(n, n);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, n, n);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(source, 0, 0, n, n);
    const d = ctx.getImageData(0, 0, n, n).data;
    const px = n * n;
    const out = new Float32Array(3 * px);
    for (let i = 0; i < px; i++) {
      for (let ch = 0; ch < 3; ch++) out[ch * px + i] = (d[i * 4 + ch] / 255 - MODEL.mean[ch]) / MODEL.std[ch];
    }
    return new ort.Tensor('float32', out, [1, 3, n, n]);
  }

  // 清晰度：灰度图上拉普拉斯算子的方差，越小越糊。统一缩到最长边 384 再算。
  // 实测正常封面在 160 以上（中位数约 1100），3px 高斯模糊后中位数约 40。
  const MIN_SHARP = 120;
  function sharpness(source) {
    const k = Math.min(1, 384 / Math.max(source.width, source.height));
    const w = Math.max(8, Math.round(source.width * k));
    const h = Math.max(8, Math.round(source.height * k));
    const canvas = new OffscreenCanvas(w, h);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, w, h);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(source, 0, 0, w, h);
    const d = ctx.getImageData(0, 0, w, h).data;
    const g = new Float32Array(w * h);
    for (let i = 0; i < g.length; i++) g[i] = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2];
    let sum = 0;
    let sq = 0;
    let n = 0;
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const i = y * w + x;
        const l = g[i - 1] + g[i + 1] + g[i - w] + g[i + w] - 4 * g[i];
        sum += l;
        sq += l * l;
        n++;
      }
    }
    const mean = sum / n;
    return sq / n - mean * mean;
  }

  // 返回模型给出的 AI 分数（0~1）。source 可以是 ImageBitmap 或画布。
  async function score(source) {
    const s = await load();
    const out = await s.run({ [s.inputNames[0]]: toTensor(source) });
    const logits = out[s.outputNames[0]].data;
    const max = Math.max(logits[0], logits[1]);
    const e0 = Math.exp(logits[0] - max);
    const e1 = Math.exp(logits[1] - max);
    return (MODEL.aiIndex === 0 ? e0 : e1) / (e0 + e1);
  }

  // ---------- 拼图检测 ----------
  // 拼图（九宫格、上下拼接等）整张交给模型时容易被误判，所以找出拼接缝，把每一格单独判断。
  // 拼接缝的特征：一条贯穿整幅的直线，线两侧的像素在大部分位置上都有明显跳变。
  function findSeams(source, sx, sy, sw, sh) {
    const N = 256;
    const canvas = new OffscreenCanvas(N, N);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, N, N);
    ctx.drawImage(source, sx, sy, sw, sh, 0, 0, N, N);
    const d = ctx.getImageData(0, 0, N, N).data;
    const g = new Float32Array(N * N);
    for (let i = 0; i < g.length; i++) g[i] = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2];
    const scan = (horizontal) => {
      const strong = [];
      for (let a = 1; a < N; a++) {
        let c = 0;
        for (let b = 0; b < N; b++) {
          const i = horizontal ? a * N + b : b * N + a;
          if (Math.abs(g[i] - g[horizontal ? i - N : i - 1]) > 16) c++;
        }
        if (c / N >= 0.6) strong.push(a);
      }
      if (strong.length > N * 0.12) return []; // 到处都是强边缘，是纹理而不是拼接缝
      const seams = [];
      let group = [];
      const flush = () => {
        if (!group.length) return;
        const pos = (group[0] + group[group.length - 1]) / 2 / N;
        if (pos > 0.12 && pos < 0.88) seams.push(pos);
        group = [];
      };
      for (const a of strong) {
        if (group.length && a - group[group.length - 1] > 8) flush();
        group.push(a);
      }
      flush();
      return seams;
    };
    return { rows: scan(true), cols: scan(false) };
  }

  // 把图按拼接缝切成若干格（最多再细分一层），返回每格在原图上的区域。没有拼接缝时返回空数组。
  function findTiles(source) {
    const split = (x, y, w, h, depth) => {
      const { rows, cols } = findSeams(source, x, y, w, h);
      if (!rows.length && !cols.length) return [[x, y, w, h]];
      const ys = [0, ...rows, 1];
      const xs = [0, ...cols, 1];
      const out = [];
      for (let r = 0; r < ys.length - 1; r++) {
        for (let c = 0; c < xs.length - 1; c++) {
          const cell = [x + xs[c] * w, y + ys[r] * h, (xs[c + 1] - xs[c]) * w, (ys[r + 1] - ys[r]) * h];
          if (depth > 0) out.push(...split(...cell, depth - 1));
          else out.push(cell);
        }
      }
      return out;
    };
    const tiles = split(0, 0, source.width, source.height, 1);
    return tiles.length > 1 ? tiles : [];
  }

  // 单独取出一格（去掉边缘几个像素，避开拼接缝和留白）
  function cropTile(source, [x, y, w, h]) {
    const m = Math.min(w, h) * 0.04;
    const cw = Math.max(1, Math.round(w - 2 * m));
    const ch = Math.max(1, Math.round(h - 2 * m));
    const canvas = new OffscreenCanvas(cw, ch);
    canvas.getContext('2d').drawImage(source, x + m, y + m, w - 2 * m, h - 2 * m, 0, 0, cw, ch);
    return canvas;
  }

  // 判断一张图。返回 { ai, part, unsure, p, tiles, hits }：
  //   ai     —— 整张图（或拼图里过半的格子）判为 AI
  //   part   —— 是拼图，只有少数格子判为 AI
  //   unsure —— 模型判为 AI，但这是容易误判的白底图
  // 拼图整张交给模型既会误判也会漏判（实测整张分数和各格分数经常对不上），所以拼图只看各格的结果。
  const MIN_TILE = 200; // 太小的格子不判，小图上模型不可靠
  const MAX_TILES = 9;
  async function judge(bmp) {
    if (bmp.width < 64 || bmp.height < 64) return { ai: false };
    // 模糊的图会让模型的分数虚高，太糊就不判
    if (sharpness(bmp) < MIN_SHARP) return { ai: false, blurry: true };
    const tiles = findTiles(bmp)
      .filter((t) => t[2] >= MIN_TILE && t[3] >= MIN_TILE)
      .sort((a, b) => b[2] * b[3] - a[2] * a[3])
      .slice(0, MAX_TILES);
    const whole = async () => {
      const p = await score(bmp);
      const hit = p >= THRESHOLD;
      // 两种情况只算"不确定"（黄色提示）：
      // 1. 白底抠图（商品图、素材图）容易被误判；
      // 2. 分数在 90%~99% 之间。实测 AI 图盖上满屏水印后分数会从 99.8% 掉到这个区间。
      const white = hit && whiteBackground(bmp) >= 0.35;
      return { ai: hit && !white, unsure: (hit && white) || (!hit && p >= MAYBE), p };
    };
    if (tiles.length < 2) return whole();
    let n = 0;
    let hits = 0;
    for (const t of tiles) {
      const tile = cropTile(bmp, t);
      if (sharpness(tile) < MIN_SHARP) continue;
      n++;
      if ((await score(tile)) >= THRESHOLD) hits++;
    }
    if (n < 2) return whole(); // 能判的格子不到两个，当普通图处理
    const ai = hits * 2 > n; // 过半的格子是 AI 才算整张是 AI
    return { ai, part: hits > 0 && !ai, tiles: n, hits };
  }

  // 接近纯白的像素占比，用来认出白底图
  function whiteBackground(source) {
    const N = 96;
    const canvas = new OffscreenCanvas(N, N);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, N, N);
    ctx.drawImage(source, 0, 0, N, N);
    const d = ctx.getImageData(0, 0, N, N).data;
    let white = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i] >= 244 && d[i + 1] >= 244 && d[i + 2] >= 244) white++;
    return white / (N * N);
  }

  // 推理排队执行，一次只跑一张。
  let chain = Promise.resolve();
  function judgeBlob(blob, onStatus) {
    const run = async () => {
      await load(onStatus);
      const bmp = await createImageBitmap(blob);
      try {
        return await judge(bmp);
      } finally {
        bmp.close();
      }
    };
    const p = chain.then(run, run);
    chain = p.catch(() => {});
    return p;
  }

  root.AIF_INFER = { load, judgeBlob, judge, score, sharpness, findTiles, cropTile };
})(self);
