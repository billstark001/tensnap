import './runtime/leafer-runtime';

import React from 'react';
import ReactDOM from 'react-dom/client';
import { TauriApp } from './TauriApp';

const savedTheme = localStorage.getItem('theme') as 'light' | 'dark' | null;
if (savedTheme) {
  document.body.setAttribute('data-theme', savedTheme);
}

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <TauriApp />
  </React.StrictMode>,
);
