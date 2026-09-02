import assert from 'node:assert/strict';
import test from 'node:test';
import { loadPackageModule } from './load-module.mjs';

const { apply, inject, name } = await loadPackageModule('index');

test('plugin metadata requires commands and skills and registers both in order', () => {
  const registrations = [];
  apply({
    skills: {
      register(skill) {
        registrations.push(['skill', skill]);
        return () => {};
      },
    },
    commands: {
      register(command) {
        registrations.push(['command', command]);
        return () => {};
      },
    },
  });

  assert.equal(name, 'clutch-dsh-discuss');
  assert.deepEqual(inject, ['commands', 'skills']);
  assert.deepEqual(
    registrations.map(([kind]) => kind),
    ['skill', 'command'],
  );
  assert.equal(registrations[0][1].name, 'brainstorming');
  assert.equal(registrations[1][1].name, 'discuss');
});
