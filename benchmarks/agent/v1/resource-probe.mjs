// Benchmark-only process high-water accounting; one write after timed work ends.
import { writeFileSync } from 'node:fs';
process.on('exit', () => {
  writeFileSync(
    process.env.TENSNAP_BENCH_RESOURCE_FILE,
    JSON.stringify({
      maxRssBytes: process.resourceUsage().maxRSS * 1024,
    }),
  );
});
