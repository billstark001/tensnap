import React from 'react';
import ReactDOM from 'react-dom/client';
import { Providers } from './Providers';
import { App } from './App';

import './styles/global.css';
import { UseFileSystemGuard } from './store/file-system/provider';

const savedTheme = localStorage.getItem('theme') as 'light' | 'dark' | null;
const initialTheme = savedTheme || 'light';
document.body.setAttribute('data-theme', initialTheme);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Providers>
      <UseFileSystemGuard>
        <App />
      </UseFileSystemGuard>
    </Providers>
  </React.StrictMode>
);