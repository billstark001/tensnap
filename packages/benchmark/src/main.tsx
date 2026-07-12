import './runtime/leafer-runtime';

import { createRoot } from 'react-dom/client';
import { App } from './App';
import '@tensnap/web-common/styles/global.css';

createRoot(document.getElementById('app')!).render(<App />);
