import { defineTool } from '@deepseek-ai/dsh-tools';
import {
  FIREWORKS_MESSAGE_DESCRIPTION,
  FIREWORKS_META_KIND,
  FIREWORKS_TOOL_DESCRIPTION,
  FIREWORKS_TOOL_NAME,
} from './contract/index.js';
import { normalizeFireworksMessage } from './fireworks-projection.js';

export const happyFireworksTool = defineTool({
  name: FIREWORKS_TOOL_NAME,
  description: FIREWORKS_TOOL_DESCRIPTION,
  parameters: {
    message: {
      type: 'string',
      description: FIREWORKS_MESSAGE_DESCRIPTION,
    },
  },
  output: {
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        id: { type: 'string', required: true },
        message: { type: 'string' },
      },
    },
    render: (_args, value) => [
      {
        type: 'text',
        text:
          value.message === undefined
            ? 'Happy fireworks launched! 🎉'
            : `Happy fireworks launched: ${value.message} 🎉`,
      },
    ],
    presentationMeta: (_args, value) => ({
      kind: FIREWORKS_META_KIND,
      id: value.id,
      ...(value.message === undefined ? {} : { message: value.message }),
    }),
  },
  presentCall: () => ({
    card: 'generic',
    title: 'Launch happy fireworks',
    kind: 'other',
  }),
  presentResult: (_args, result) => ({
    card: 'generic',
    title: result.isError ? 'Fireworks failed' : 'Happy fireworks 🎉',
    content: result.content,
  }),
  execute(args, exec) {
    const message = normalizeFireworksMessage(args.message);
    return Promise.resolve({
      id: String(exec.callId),
      ...(message === undefined ? {} : { message }),
    });
  },
});
