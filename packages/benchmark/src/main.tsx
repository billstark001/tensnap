import './runtime/leafer-runtime';

import { render } from 'preact';
import { App } from './App';

render(<App />, document.getElementById('app')!);
