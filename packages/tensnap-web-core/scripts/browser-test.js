#!/usr/bin/env node

/**
 * Browser-based test runner for tensnap-web-core
 * Opens a blank page and provides interfaces for performance testing
 */

import { chromium } from 'playwright';
import { join } from 'path';
import { existsSync, mkdirSync, writeFileSync } from 'fs';

const HTML_TEMPLATE = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>TenSnap Web Core - Browser Tests</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 20px; background: #f0f0f0; }
    #test-container { background: white; padding: 20px; border-radius: 8px; margin-bottom: 20px; }
    #results { background: #2d2d2d; color: #f0f0f0; padding: 15px; border-radius: 8px; 
               font-family: 'Courier New', monospace; font-size: 14px; max-height: 400px; overflow-y: auto; }
    .test-pass { color: #4caf50; }
    .test-fail { color: #f44336; }
    button { background: #2196f3; color: white; border: none; padding: 10px 20px; 
             border-radius: 4px; cursor: pointer; margin: 5px; }
  </style>
</head>
<body>
  <h1>TenSnap Web Core - Browser Tests</h1>
  <div id="test-container">
    <h2>Performance Test Area</h2>
    <div id="chart-container" style="width: 800px; height: 400px; border: 1px solid #ddd;"></div>
  </div>
  <button onclick="runTests()">Run Tests</button>
  <div id="results"></div>
  <script>
    function log(msg, type) {
      const r = document.getElementById('results');
      const l = document.createElement('div');
      l.className = 'test-' + type;
      l.textContent = new Date().toLocaleTimeString() + ' - ' + msg;
      r.appendChild(l);
    }
    window.runTests = () => log('Tests ready', 'pass');
    log('Environment ready', 'pass');
  </script>
</body>
</html>
`;

async function runBrowserTests() {
  console.log('Starting browser tests...');
  const tempDir = join(process.cwd(), '.tmp');
  if (!existsSync(tempDir)) mkdirSync(tempDir, { recursive: true });
  const htmlPath = join(tempDir, 'test.html');
  writeFileSync(htmlPath, HTML_TEMPLATE);
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();
  await page.goto(`file://${htmlPath}`);
  console.log('Browser opened. Press Ctrl+C to exit.');
  await new Promise(() => {});
}

runBrowserTests().catch(console.error);
