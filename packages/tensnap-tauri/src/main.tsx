import React from 'react';
import ReactDOM from 'react-dom/client';
import { TauriApp } from './TauriApp';

import { getCurrentWindow } from '@tauri-apps/api/window';

async function isDarkMode() {
  const theme = await getCurrentWindow().theme();
  return theme === 'dark';
}


const savedTheme = localStorage.getItem('theme') as 'light' | 'dark' | null;
const initialTheme = savedTheme || (await isDarkMode() ? 'dark' : 'light');
document.body.setAttribute('data-theme', initialTheme);

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <TauriApp />
  </React.StrictMode>,
);
