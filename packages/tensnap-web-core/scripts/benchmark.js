#!/usr/bin/env node

/**
 * Performance benchmarking for tensnap-web-core
 */

console.log('=== TenSnap Web Core Benchmarks ===\n');

async function benchmark(name, fn) {
  const start = Date.now();
  await fn();
  const duration = Date.now() - start;
  console.log(`${name}: ${duration}ms`);
  return duration;
}

async function runBenchmarks() {
  await benchmark('Chart rendering (simulated)', async () => {
    await new Promise(r => setTimeout(r, 100));
  });
  
  await benchmark('State updates (simulated)', async () => {
    await new Promise(r => setTimeout(r, 50));
  });
  
  console.log('\nBenchmarks completed');
}

runBenchmarks().catch(console.error);
