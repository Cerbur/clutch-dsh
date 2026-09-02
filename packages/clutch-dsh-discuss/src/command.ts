import type { CommandDefinition, CommandInvocation } from '@deepseek-ai/dsh-commands';
import { createUserMessage } from '@deepseek-ai/dsh-llm';

export const DISCUSS_COMMAND_NAME = 'discuss';

function thrownMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function buildBrainstormingMessage(rawInput: string): string {
  const topic = rawInput.trim();
  return topic.length === 0 ? '/brainstorming' : `/brainstorming\n\n${topic}`;
}

function successText(rawInput: string): string {
  return rawInput.trim().length === 0
    ? 'Brainstorming discussion started without a topic.'
    : 'Brainstorming discussion started with a topic.';
}

function steerDiscussion(invocation: CommandInvocation): void {
  invocation.agent.steer(
    createUserMessage({
      content: [{ type: 'text', text: buildBrainstormingMessage(invocation.rawInput) }],
      source: { kind: 'user' },
    }),
  );
}

export function createDiscussCommand(): CommandDefinition {
  return {
    name: DISCUSS_COMMAND_NAME,
    description: 'Start the brainstorming discussion workflow',
    input: { hint: '[optional topic]' },
    recordInput: false,
    handler(invocation) {
      try {
        steerDiscussion(invocation);
        return { kind: 'success', text: successText(invocation.rawInput) };
      } catch (error) {
        return { kind: 'error', text: `Unable to start discussion: ${thrownMessage(error)}` };
      }
    },
  };
}
