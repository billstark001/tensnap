import React from 'react';
import ReactDOM from 'react-dom/client';
import { Providers } from './Providers';
import { App } from './App';

import './styles/global.css';
import { UseFileSystemGuard } from './store/file-system/provider';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Providers>
      <UseFileSystemGuard>
        <App />
      </UseFileSystemGuard>
    </Providers>
  </React.StrictMode>
);