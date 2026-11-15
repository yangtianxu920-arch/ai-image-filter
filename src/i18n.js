// 界面语言：浏览器界面是中文就用中文，其它语言一律用英文。
// 用法：AIF_T('key', 参数...)，文案里的 {0} {1} 会被参数替换。
(function (root) {
  const M = {
    badgeAi: ['AI', 'AI'],
    badgeWeak: ['疑似AI', 'Maybe AI'],
    pending: ['检查中…', 'Checking…'],
    pendingReason: ['本地模型正在检查这张图', 'The local model is checking this image'],
    modelAi: ['AI·模型', 'AI · model'],
    modelMaybe: ['疑似AI·模型', 'Maybe AI · model'],
    modelPart: ['部分疑似AI·模型', 'Partly AI? · model'],
    reasonModelAi: ['本地模型判断为 AI 生成（仍可能误判，可点开笔记纠错）', 'The local model judged this as AI-generated (it can be wrong; open the post to correct it)'],
    reasonModelUnsure: [
      '本地模型认为可能是 AI 生成，但把握不够（白底图、带水印的图容易影响判断，仅供参考）',
      'The local model thinks this may be AI-generated but is not confident (white backgrounds and watermarks affect it; for reference only)',
    ],
    reasonModelPart: [
      '这是一张拼图，本地模型认为其中个别小图像 AI 生成（仅供参考）',
      'This is a collage; the local model thinks a few of its tiles look AI-generated (for reference only)',
    ],
    reasonModelVideo: [
      '本地模型认为这个视频封面像 AI 生成（视频封面容易误判，仅供参考）',
      'The local model thinks this video cover looks AI-generated (video covers are error-prone; for reference only)',
    ],
    reasonAuthor: ['该作者有 {0} 篇笔记被标为 AI', '{0} post(s) by this author are marked as AI'],
    reasonLabel: ['平台标识：{0}', 'Platform label: {0}'],
    reasonManual: ['手动标记', 'Marked by you'],
    ctlNotAi: ['不是 AI（纠错）', 'Not AI (correct this)'],
    ctlMarkAi: ['标记为 AI', 'Mark as AI'],
    pillError: ['模型出错：{0}', 'Model error: {0}'],
    pillDownloading: ['正在下载模型 {0}%…', 'Downloading model {0}%…'],
    pillLoading: ['正在加载模型…', 'Loading model…'],
    pillChecking: ['正在检查 {0}/{1} 张…', 'Checking {0}/{1} images…'],
    pillNone: ['当前没有可检查的图片', 'No images to check here'],
    pillFound: ['已检查 {0} 张：发现 {1} 张疑似 AI', 'Checked {0} images: {1} possibly AI'],
    pillClean: ['已检查 {0} 张：未发现 AI', 'Checked {0} images: no AI found'],
    pillFailed: ['，{0} 张检查失败', ', {0} failed'],
    pillTitle: ['AI 过滤器：统计的是当前屏幕附近的图片', 'AI Filter: counts the images near the current screen'],
    toastPrefix: ['AI 过滤器：', 'AI Filter: '],

    metaC2pa: ['元数据：C2PA / IPTC 声明为 AI 生成或合成', 'Metadata: C2PA / IPTC declares AI-generated or composited'],
    metaSd: ['元数据：Stable Diffusion 生成参数', 'Metadata: Stable Diffusion generation parameters'],
    metaNovelAi: ['元数据：NovelAI', 'Metadata: NovelAI'],
    metaComfy: ['元数据：ComfyUI 工作流', 'Metadata: ComfyUI workflow'],
    metaTool: ['元数据：提到 AI 生成工具', 'Metadata: mentions an AI generation tool'],
    offscreenWhy: ['在本地运行 AI 图片检测模型', 'Run the AI image detection model locally'],
    menuCheck: ['用 AI 过滤器检查这张图片', 'Check this image with AI Filter'],
    checkFailed: ['检查失败：这不是图片，或者图片读取不到', 'Check failed: not an image, or it could not be loaded'],
    checkBlurry: ['图片太模糊，无法判断', 'Image is too blurry to judge'],
    checkSmall: ['图片太小，无法判断', 'Image is too small to judge'],
    checkCollageHit: ['这是拼图：{0} 格里有 {1} 格被模型判为 AI', 'Collage: the model judged {1} of {0} tiles as AI'],
    checkCollageClean: ['这是拼图：{0} 格都没有被模型判为 AI', 'Collage: none of the {0} tiles was judged as AI'],
    verdictAi: ['判为 AI', 'Judged as AI'],
    verdictUnsure: ['疑似 AI（把握不够）', 'Possibly AI (not confident)'],
    verdictClean: ['未判为 AI', 'Not judged as AI'],
    checkScore: ['{0}。模型分数 {1}%（达到 99% 才算，分数仅供参考）', '{0}. Model score {1}% (99% needed; the score is only a rough guide)'],
    checkNoUrl: ['这张图片的地址无法读取', 'The address of this image cannot be read'],
    checkBusy: ['正在检查…（首次使用需要先下载模型）', 'Checking… (the model is downloaded on first use)'],

    popTitle: ['AI 过滤器', 'AI Filter'],
    popEnabled: ['启用', 'Enabled'],
    popWhenFound: ['发现 AI 图片时', 'When an AI image is found'],
    popBadge: ['只打标记', 'Badge only'],
    popBlur: ['模糊（悬停查看）', 'Blur (hover to reveal)'],
    popHide: ['隐藏', 'Hide'],
    popWeak: ['显示"疑似AI"弱提示', 'Show "Maybe AI" hints'],
    popMeta: ['检查图片元数据（普通网页）', 'Check image metadata (ordinary sites)'],
    popModelGroup: ['本地模型（实验功能）', 'Local model (experimental)'],
    popModel: ['用模型识别图片本身', 'Judge the image itself with a model'],
    popModelHint: [
      '首次开启会下载约 190MB 模型，之后只在本机运行，图片不会上传。只有把握很高时才会标记，所以会漏掉一部分 AI 图；也仍可能误判。',
      'Turning this on downloads a ~190MB model once. It then runs only on your computer; images are never uploaded. It flags only when very confident, so it misses some AI images, and it can still be wrong.',
    ],
    popNoticeTitle: ['使用须知', 'Please note'],
    popNotice: [
      '：检测结果可能出错，会漏判，也会把真人作品误判成 AI。本工具仅供个人筛选素材时参考，禁止把结果当作证据用于指认、举报他人，或用于"AI 对赌"等任何争议和对赌场景。',
      ': results can be wrong. The tool misses AI images and also flags human-made work as AI. Use it only as a personal aid for screening reference material. Do not use its output as evidence to accuse or report anyone, or in any dispute or bet about whether an image is AI.',
    ],
    popStats: ['已记录 {0} 篇 AI 笔记，{1} 位作者', '{0} AI post(s) and {1} author(s) recorded'],
    popClear: ['清空已记录的笔记和作者', 'Clear recorded posts and authors'],
    stDownloading: ['正在下载模型… {0}%', 'Downloading model… {0}%'],
    stLoading: ['正在加载模型…', 'Loading model…'],
    stReady: ['模型已就绪', 'Model ready'],
    stError: ['出错：{0}', 'Error: {0}'],
    stStarting: ['正在启动…', 'Starting…'],
  };

  let ui = '';
  try {
    ui = chrome.i18n.getUILanguage();
  } catch {
    ui = (root.navigator && root.navigator.language) || '';
  }
  const zh = /^zh\b/i.test(ui);

  function t(key, ...args) {
    const pair = M[key];
    if (!pair) return key;
    return pair[zh ? 0 : 1].replace(/\{(\d)\}/g, (_, i) => String(args[i]));
  }

  root.AIF_T = t;
  root.AIF_LANG = zh ? 'zh' : 'en';
})(typeof self !== 'undefined' ? self : globalThis);
