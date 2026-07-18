import { BlockList, isIP } from 'node:net';

function canonicalAddress(address) {
  return address?.replace(/^::ffff:/i, '') ?? null;
}

function forwardedAddresses(value) {
  if (typeof value !== 'string') return [];
  return value
    .split(',')
    .map((address) => canonicalAddress(address.trim()))
    .filter((address) => isIP(address));
}

export function parseTrustedProxyIps(value = '') {
  return value
    .split(',')
    .map((address) => canonicalAddress(address.trim()))
    .filter(Boolean);
}

export function createRequesterId({ trustedProxyIps = [] } = {}) {
  const trusted = new BlockList();
  for (const configuredRange of trustedProxyIps.map(canonicalAddress).filter(Boolean)) {
    const [address, prefixValue] = configuredRange.split('/');
    const family = isIP(address);
    if (!family) throw new Error(`Invalid trusted proxy address: ${configuredRange}`);
    const type = family === 4 ? 'ipv4' : 'ipv6';

    if (prefixValue == null) {
      trusted.addAddress(address, type);
      continue;
    }

    const prefix = Number(prefixValue);
    const maxPrefix = family === 4 ? 32 : 128;
    if (!Number.isInteger(prefix) || prefix < 0 || prefix > maxPrefix) {
      throw new Error(`Invalid trusted proxy prefix: ${configuredRange}`);
    }
    trusted.addSubnet(address, prefix, type);
  }

  function isTrusted(address) {
    const family = isIP(address);
    return family ? trusted.check(address, family === 4 ? 'ipv4' : 'ipv6') : false;
  }

  return (req) => {
    const remoteAddress = req.socket?.remoteAddress ?? 'unknown';
    const canonicalRemoteAddress = canonicalAddress(remoteAddress);
    // Traefik's Docker-network address must be explicitly configured; direct clients cannot
    // select their requester bucket by sending an X-Forwarded-For header.
    if (!isTrusted(canonicalRemoteAddress)) return canonicalRemoteAddress;

    const forwarded = forwardedAddresses(req.headers['x-forwarded-for']);
    for (let index = forwarded.length - 1; index >= 0; index -= 1) {
      if (!isTrusted(forwarded[index])) return forwarded[index];
    }

    return forwarded[0] ?? canonicalRemoteAddress;
  };
}
