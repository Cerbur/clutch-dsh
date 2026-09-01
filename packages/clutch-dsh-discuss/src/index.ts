import type { Context } from '@deepseek-ai/cordis';
import { createDiscussCommand } from './command.js';
import { createBrainstormingSkill } from './skill.js';

export {
  createDiscussCommand,
  DISCUSS_COMMAND_NAME,
  buildBrainstormingMessage,
} from './command.js';
export {
  BRAINSTORMING_SKILL_NAME,
  BRAINSTORMING_SKILL_PATH,
  createBrainstormingSkill,
  loadBrainstormingSkill,
} from './skill.js';

export const name = 'clutch-dsh-discuss';
export const inject = ['commands', 'skills'];

export function apply(ctx: Context): void {
  ctx.skills.register(createBrainstormingSkill());
  ctx.commands.register(createDiscussCommand());
}
