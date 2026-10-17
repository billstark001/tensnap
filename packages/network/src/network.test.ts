import { describe, expect, it } from 'vitest';
import { browserWebSocketUrl, parseIPFamily, urlHostname, listenerUrl } from './index';

describe('IP-family connection policy', () => {
  it('keeps auto URLs and formats IPv6 authorities', () => {
    expect(browserWebSocketUrl('wss://example.com/model?x=1')).toBe('wss://example.com/model?x=1');
    expect(urlHostname('::1')).toBe('[::1]');
    expect(urlHostname('[::1]')).toBe('[::1]');
    expect(parseIPFamily()).toBe('auto');
    expect(() => parseIPFamily('dual')).toThrow(/ip_family/);
  });
  it.each([
    ['ipv4', '127.0.0.1'],
    ['ipv6', '[::1]'],
  ] as const)('forces %s for local ws URLs', (family, address) => {
    expect(browserWebSocketUrl('ws://localhost:8765/path?x=1', family)).toBe(
      `ws://${address}:8765/path?x=1`,
    );
    expect(() => browserWebSocketUrl('ws://example.com:8765', family)).toThrow(
      /browser cannot force/,
    );
    expect(() => browserWebSocketUrl('wss://localhost:8765', family)).toThrow(/TLS hostname/);
  });
  it('builds reachable HTTP and WebSocket URLs from actual listener addresses', () => {
    expect(listenerUrl({ address: '0.0.0.0', port: 8765 })).toBe('ws://127.0.0.1:8765');
    expect(listenerUrl({ address: '::', port: 8765 })).toBe('ws://[::1]:8765');
    expect(listenerUrl({ address: '[::1]', port: 1234 }, 'http')).toBe('http://[::1]:1234');
    expect(listenerUrl({ address: '192.0.2.1', port: 443 }, 'wss')).toBe('wss://192.0.2.1:443');
  });
  it('rejects conflicting IP literals instead of falling back', () => {
    expect(() => browserWebSocketUrl('ws://[::1]:8765', 'ipv4')).toThrow(/conflicts/);
    expect(() => browserWebSocketUrl('ws://127.0.0.1:8765', 'ipv6')).toThrow(/conflicts/);
    expect(browserWebSocketUrl('ws://[::1]:8765', 'ipv6')).toBe('ws://[::1]:8765/');
  });
});
