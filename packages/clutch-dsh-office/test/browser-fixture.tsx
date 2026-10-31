import React from 'react';
import { createRoot } from 'react-dom/client';
import { OfficeDashboard } from '../src/client/OfficeDashboard.js';
import { projectSessionBoard } from '../src/office/session-board.js';
import { en, zh } from '../src/client/locales.js';
import { OFFICE_CSS } from '../src/client/styles.js';
const style = document.createElement('style');
style.textContent = OFFICE_CSS;
document.head.append(style);
const copy = new URLSearchParams(location.search).get('lang') === 'en' ? en : zh;
createRoot(document.getElementById('root')!).render(
  <OfficeDashboard
    version="fixture"
    board={projectSessionBoard([])}
    phase="ready"
    t={(key) => copy[key]}
    onOpenSession={() => {}}
  />,
);
