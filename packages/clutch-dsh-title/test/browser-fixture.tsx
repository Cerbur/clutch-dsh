// Isolated visual QA harness: real page and DSH primitives, in-memory settings transport.
import React from 'react';
import { createRoot } from 'react-dom/client';
import { TemplateSection } from '../src/client/TemplateSection.js';
import { TemplateStore } from '../src/client/store.js';
import { en, zh } from '../src/client/locales.js';
import { EMOJI_TEMPLATE } from '../src/templates.js';

let revision = 0;
let raw: { enabled: boolean; active: string; templates: Record<string, string> } = {
  enabled: true,
  active: 'personal',
  templates: {
    emoji: EMOJI_TEMPLATE,
    personal: 'template: "${daytime}|${desc}"',
    broken: 'template: "${missing}"',
  },
};
const store = new TemplateStore({
  read: async () => ({ raw: structuredClone(raw), revision, writable: true }),
  write: async (ops, expected) => {
    if (revision !== expected) throw new Error('settings/conflict');
    for (const op of ops) {
      if (op.path[0] === 'templates') {
        if (op.op === 'set') raw.templates = structuredClone(op.value) as Record<string, string>;
      } else if (op.op === 'set' && op.path[0] === 'enabled') raw.enabled = Boolean(op.value);
      else if (op.op === 'set' && op.path[0] === 'active') raw.active = String(op.value);
    }
    revision++;
  },
});
Object.assign(window, {
  externalEdit: () => {
    raw = { ...raw, active: 'broken' };
    revision++;
    void store.load();
  },
});
const copy = new URLSearchParams(location.search).get('lang') === 'en' ? en : zh;
createRoot(document.getElementById('root')!).render(
  <TemplateSection controller={store} t={(key) => copy[key]} />,
);
