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
      values: [
        { value: '设计', description: '明确需求、制定实现方案，或设计架构、接口和交互时使用' },
        {
          value: '探索',
          description: '理解代码、调研技术、分析问题或验证可行性，主要目标是获得结论时使用',
        },
        { value: '功能', description: '新增此前不存在的能力，或扩展现有功能的使用场景时使用' },
        { value: '修复', description: '纠正缺陷、排查并解决故障，或恢复预期行为时使用' },
        {
          value: '优化',
          description: '在保持现有功能含义的基础上，改善性能、体验、结构或可维护性时使用',
        },
        { value: '发布', description: '准备版本、编写发布说明、打包、部署或执行上线流程时使用' },
      ],
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
