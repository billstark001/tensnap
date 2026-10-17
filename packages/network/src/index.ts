/** Local transport configuration; this is not part of the wire protocol. */
export type IPFamily = 'auto' | 'ipv4' | 'ipv6';

export function parseIPFamily(value: unknown = 'auto'): IPFamily {
  if (value === 'auto' || value === 'ipv4' || value === 'ipv6') return value;
  throw new Error('ip_family must be auto, ipv4, or ipv6.');
}

export function urlHostname(host: string): string {
  const bare = host.replace(/^\[|\]$/g, '');
  return bare.includes(':') ? `[${bare}]` : bare;
}

/** Build a reachable local endpoint from a bound IP address, including wildcard listeners. */
export function listenerUrl(
  address: { address: string; port: number },
  protocol: 'ws' | 'wss' | 'http' | 'https' = 'ws',
): string {
  const bare = address.address.replace(/^\[|\]$/g, '');
  const host = bare === '::' ? '::1' : bare === '0.0.0.0' ? '127.0.0.1' : bare;
  return `${protocol}://${urlHostname(host)}:${address.port}`;
}

export function validateIPFamily(host: string, family: IPFamily): void {
  parseIPFamily(family);
  const bare = host.replace(/^\[|\]$/g, '');
  const literalFamily = bare.includes(':')
    ? 'ipv6'
    : /^\d+\.\d+\.\d+\.\d+$/.test(bare)
      ? 'ipv4'
      : undefined;
  if (family !== 'auto' && literalFamily && family !== literalFamily)
    throw new Error(`Address ${host} conflicts with ip_family=${family}.`);
}

/** Browsers cannot restrict DNS resolution for arbitrary hostnames. */
export function browserWebSocketUrl(value: string, family: IPFamily = 'auto'): string {
  parseIPFamily(family);
  const url = new URL(value);
  if (url.protocol !== 'ws:' && url.protocol !== 'wss:')
    throw new Error('Expected a ws:// or wss:// URL.');
  validateIPFamily(url.hostname, family);
  if (family === 'auto') return value;
  if (url.hostname.toLowerCase() === 'localhost') {
    if (url.protocol === 'wss:')
      throw new Error(
        'The browser cannot force an IP family for a wss:// hostname while preserving its TLS hostname. Use auto or a matching IP-address certificate.',
      );
    url.hostname = family === 'ipv4' ? '127.0.0.1' : '[::1]';
  } else if (!url.hostname.includes(':') && !/^\d+\.\d+\.\d+\.\d+$/.test(url.hostname)) {
    throw new Error(
      'The browser cannot force IPv4/IPv6 for a domain name. Use auto or enter an explicit IP address.',
    );
  }
  return url.href;
}
