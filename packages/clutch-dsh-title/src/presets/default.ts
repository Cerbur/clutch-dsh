import type { TitleFieldConfig } from '../types.js';

export const DEFAULT_PRESET = {
  preset: 'default',
  template: '${daytime}|${type}|${desc}',
  fields: {
    daytime: {
      kind: 'datetime',
      source: 'session.createdAt',
      format: 'MMDD',
      timezone: 'Asia/Shanghai',
    },
    type: {
      kind: 'llm-enum',
      instruction: '判断这个 session 的任务类型',
      values: ['前端', '后端', '配置', '文档'],
    },
    desc: {
      kind: 'llm-text',
      instruction: '总结首次 prompt，保留具体任务含义',
      maxCharacters: 32,
    },
  },
} as const satisfies {
  readonly preset: 'default';
  readonly template: string;
  readonly fields: Readonly<Record<string, TitleFieldConfig>>;
};
