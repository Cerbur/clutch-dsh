import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { SkillRegistration } from '@deepseek-ai/dsh-skill';

export const BRAINSTORMING_SKILL_NAME = 'brainstorming';
export const BRAINSTORMING_SKILL_PATH = fileURLToPath(
  new URL('../skills/brainstorming/SKILL.md', import.meta.url),
);

const PROVIDER_NAME = '@cerbur/clutch-dsh-discuss';
const FRONTMATTER_PATTERN = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/u;

type SkillFrontmatter = Readonly<Record<string, string>>;

function parseFrontmatter(
  raw: string,
  filePath: string,
): { metadata: SkillFrontmatter; content: string } {
  const match = FRONTMATTER_PATTERN.exec(raw);
  if (match === null) {
    throw new Error(
      `bundled skill at ${filePath} must start with YAML frontmatter delimited by ---`,
    );
  }

  const metadata: Record<string, string> = {};
  for (const line of match[1].split(/\r?\n/u)) {
    if (line.trim().length === 0) continue;
    const separator = line.indexOf(':');
    if (separator <= 0) {
      throw new Error(`bundled skill at ${filePath} has invalid frontmatter line: ${line}`);
    }
    const key = line.slice(0, separator).trim();
    const token = line.slice(separator + 1).trim();
    if (token.length === 0) {
      throw new Error(`bundled skill at ${filePath} has an empty frontmatter value for ${key}`);
    }
    metadata[key] =
      token.startsWith('"') && token.endsWith('"')
        ? (JSON.parse(token) as string)
        : token.startsWith("'") && token.endsWith("'")
          ? token.slice(1, -1)
          : token;
  }

  const name = metadata.name?.trim();
  const description = metadata.description?.trim();
  if (name === undefined || name.length === 0) {
    throw new Error(`bundled skill at ${filePath} frontmatter must define name`);
  }
  if (description === undefined || description.length === 0) {
    throw new Error(`bundled skill at ${filePath} frontmatter must define description`);
  }

  return { metadata: Object.freeze(metadata), content: match[2] };
}

export function loadBrainstormingSkill(filePath = BRAINSTORMING_SKILL_PATH): SkillRegistration {
  let raw: string;
  try {
    raw = readFileSync(filePath, 'utf8');
  } catch (error) {
    throw new Error(`unable to read bundled skill at ${filePath}`, { cause: error });
  }

  const { metadata, content } = parseFrontmatter(raw, filePath);
  if (metadata.name !== BRAINSTORMING_SKILL_NAME) {
    throw new Error(`bundled skill at ${filePath} must be named ${BRAINSTORMING_SKILL_NAME}`);
  }

  return {
    name: metadata.name,
    description: metadata.description,
    source: 'bundled',
    provider: PROVIDER_NAME,
    path: resolve(filePath),
    resourceBase: { kind: 'directory', path: dirname(resolve(filePath)) },
    metadata,
    content,
    invocation: { modelInvocable: true, userInvocable: true },
  };
}

export function createBrainstormingSkill(): SkillRegistration {
  return loadBrainstormingSkill();
}
