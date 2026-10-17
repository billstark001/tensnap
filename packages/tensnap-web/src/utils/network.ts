import { browserWebSocketUrl, type IPFamily } from '@tensnap/network';

export function ipFamilyError(url: string, family: IPFamily): string | undefined {
  try {
    browserWebSocketUrl(url, family);
    return undefined;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}
