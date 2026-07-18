function canonicalAddress(address) {
  return address?.replace(/^::ffff:/i, '') ?? null;
}

function forwardedClientAddress(value) {
  if (typeof value !== 'string') return null;
  return value.split(',')[0]?.trim() || null;
}

export function parseTrustedProxyIps(value = '') {
  return value
    .split(',')
    .map((address) => canonicalAddress(address.trim()))
    .filter(Boolean);
}

export function createRequesterId({ trustedProxyIps = [] } = {}) {
  const trusted = new Set(trustedProxyIps.map(canonicalAddress).filter(Boolean));

  return (req) => {
    const remoteAddress = req.socket?.remoteAddress ?? 'unknown';
    const canonicalRemoteAddress = canonicalAddress(remoteAddress);
    // Traefik's Docker-network address must be explicitly configured; direct clients cannot
    // select their requester bucket by sending an X-Forwarded-For header.
    if (!trusted.has(canonicalRemoteAddress)) return canonicalRemoteAddress;

    return forwardedClientAddress(req.headers['x-forwarded-for']) ?? canonicalRemoteAddress;
  };
}
