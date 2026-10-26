import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { OfficeDashboard } from '../src/client/OfficeDashboard.js';
import { en, zh } from '../src/client/locales.js';
import { OFFICE_CSS } from '../src/client/styles.js';
import type { Office } from '../src/office/types.js';

const style = document.createElement('style');
style.textContent = OFFICE_CSS;
document.head.append(style);
const params = new URLSearchParams(location.search);
const copy = params.get('lang') === 'en' ? en : zh;
const samples: Office[] = [
  {
    id: 'clutch-dsh',
    title: 'clutch-dsh',
    activeCount: 3,
    overflow: 1,
    actors: [
      { id: 'a', label: 'Office · build the kitchen', activity: 'working', seat: 0 },
      { id: 'b', label: 'Title · review changes', activity: 'waiting', seat: 1 },
    ],
  },
  {
    id: 'quiet-kitchen',
    title: 'Quiet workspace',
    activeCount: 0,
    overflow: 0,
    actors: [],
  },
  {
    id: 'whale-studio',
    title: 'whale-studio',
    activeCount: 1,
    overflow: 0,
    actors: [{ id: 'c', label: 'Kitchen · explore ideas', activity: 'working', seat: 0 }],
  },
];
function Preview() {
  const [offices, setOffices] = useState(params.has('empty') ? [] : samples);
  const [phase, setPhase] = useState<'loading' | 'ready' | 'error'>('ready');
  Object.assign(window, {
    officeFixture: {
      empty: () => setOffices([]),
      restore: () => {
        setOffices(samples);
        setPhase('ready');
      },
      fail: () => setPhase('error'),
      loading: () => setPhase('loading'),
      removeFirst: () => setOffices(samples.slice(1)),
      stopAll: () =>
        setOffices(
          samples.map((office) => ({ ...office, actors: [], activeCount: 0, overflow: 0 })),
        ),
    },
  });
  return <OfficeDashboard offices={offices} phase={phase} t={(key) => copy[key]} />;
}
createRoot(document.getElementById('root')!).render(<Preview />);
