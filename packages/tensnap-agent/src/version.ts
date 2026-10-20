import { readFileSync } from 'node:fs';
function readPackageMetadata(): { url: URL; version: string } {
  // Source modules and bundled chunks are one directory below the manifest;
  // an unsplit CLI entry lives beside it.
  for (const path of ['./package.json', '../package.json']) {
    const url = new URL(path, import.meta.url);
    try {
      return { url, version: JSON.parse(readFileSync(url, 'utf8')).version };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  throw new Error('Cannot locate @tensnap/agent package.json.');
}

const metadata = readPackageMetadata();
export const PACKAGE_URL = metadata.url;
export const CLI_VERSION = metadata.version;
