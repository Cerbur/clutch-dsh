/** DSH's supported UI languages. Technical constraints live only in the English core. */
export const animationPromptLocales = {
  en: {
    title: 'Generate your own animation with AI',
    guide:
      'Copy the prompt, replace the creative brief at the end with your idea, ask AI for a complete .js file, then import it. The shared technical instructions are in English.',
    label: 'Animation generation prompt',
    copy: 'Copy generation prompt',
    copied: 'Generation prompt copied.',
    unavailable: 'Copy is unavailable. Please copy from the text box manually.',
    failed: 'Copy failed. Please copy from the text box manually.',
    creativeBrief:
      'My creative brief: <Replace this with your desired motif, colors, mood and motion; for example, a delicate constellation that gathers, blooms into orbiting stars, then gently dissolves.>',
  },
  zh: {
    title: '用 AI 生成自己的动画',
    guide:
      '复制提示词，将末尾的创意描述替换为你的想法，让 AI 输出完整 .js 文件，然后导入。共用的技术规范使用英文。',
    label: '动画脚本生成提示词',
    copy: '复制生成提示词',
    copied: '生成提示词已复制。',
    unavailable: '复制不可用，请从文本框手动复制。',
    failed: '复制失败，请从文本框手动复制。',
    creativeBrief:
      '我的创意描述：<请替换为你想要的主题、配色、氛围与运动；例如，细腻的星座聚拢、绽放为环绕的星群，再轻柔消散。>',
  },
};

// DSH synchronizes document.lang with its locale service, including live changes.
// Observe that public page state without adding a new required Host service.
export function promptLanguage(): keyof typeof animationPromptLocales {
  return typeof document !== 'undefined' && /^zh(?:-|$)/i.test(document.documentElement?.lang ?? '')
    ? 'zh'
    : 'en';
}

export function subscribePromptLanguage(changed: () => void): () => void {
  if (typeof MutationObserver === 'undefined' || typeof document === 'undefined') return () => {};
  const observer = new MutationObserver(changed);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] });
  return () => observer.disconnect();
}
