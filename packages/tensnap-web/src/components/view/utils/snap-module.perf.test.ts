// Performance test for SnapModule optimizations
import { SnapModule } from './snap-module';

// Create test data
const createTestConfig = () => ({
  enableGrid: true,
  gridSize: 20,
  snapThreshold: 10,
  horizontal: Array.from({ length: 50 }, (_, i) => ({ x: 0, y: i * 25 })),
  vertical: Array.from({ length: 50 }, (_, i) => ({ x: i * 25, y: 0 }))
});

const snapModule = new SnapModule(createTestConfig());

// Performance test helpers
const measureTime = (fn: () => void, iterations: number = 10000): number => {
  const start = performance.now();
  for (let i = 0; i < iterations; i++) {
    fn();
  }
  const end = performance.now();
  return end - start;
};

// Test cases
const testSnapPoint = () => {
  const x = Math.random() * 1000;
  const y = Math.random() * 1000;
  snapModule.snapPoint(x, y);
};

const testSnapPointFast = () => {
  const x = Math.random() * 1000;
  const y = Math.random() * 1000;
  snapModule.snapPointFast(x, y);
};

const testSnapRectangle = () => {
  const x = Math.random() * 1000;
  const y = Math.random() * 1000;
  snapModule.snapRectangle({ x, y, width: 100, height: 50 });
};

const testWouldSnap = () => {
  const x = Math.random() * 1000;
  const y = Math.random() * 1000;
  snapModule.wouldSnap(x, y);
};

const testWouldRectangleSnap = () => {
  const x = Math.random() * 1000;
  const y = Math.random() * 1000;
  snapModule.wouldRectangleSnap({ x, y, width: 100, height: 50 });
};

// Run performance tests
console.log('Performance Tests for SnapModule:');
console.log('================================');

const iterations = 10000;

console.log(`Running ${iterations} iterations each...`);
console.log();

const snapPointTime = measureTime(testSnapPoint, iterations);
console.log(`snapPoint: ${snapPointTime.toFixed(2)}ms (${(iterations / snapPointTime * 1000).toFixed(0)} ops/sec)`);

const snapPointFastTime = measureTime(testSnapPointFast, iterations);
console.log(`snapPointFast: ${snapPointFastTime.toFixed(2)}ms (${(iterations / snapPointFastTime * 1000).toFixed(0)} ops/sec)`);

const snapRectangleTime = measureTime(testSnapRectangle, iterations);
console.log(`snapRectangle: ${snapRectangleTime.toFixed(2)}ms (${(iterations / snapRectangleTime * 1000).toFixed(0)} ops/sec)`);

const wouldSnapTime = measureTime(testWouldSnap, iterations);
console.log(`wouldSnap: ${wouldSnapTime.toFixed(2)}ms (${(iterations / wouldSnapTime * 1000).toFixed(0)} ops/sec)`);

const wouldRectangleSnapTime = measureTime(testWouldRectangleSnap, iterations);
console.log(`wouldRectangleSnap: ${wouldRectangleSnapTime.toFixed(2)}ms (${(iterations / wouldRectangleSnapTime * 1000).toFixed(0)} ops/sec)`);

console.log();
console.log('Performance improvements:');
console.log(`snapPointFast is ${(snapPointTime / snapPointFastTime).toFixed(1)}x faster than snapPoint`);
