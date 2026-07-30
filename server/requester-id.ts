import { BlockList, isIP } from 'node:net';
import type { Request } from 'express';

type IpFamilyName = 'ipv4' | 'ipv6';

export type RequesterId = (req: Request) => string | null;

function ipFamilyName(family: number): IpFamilyName {
  return family === 4 ? 'ipv4' : 'ipv6';
}

function canonicalAddress(address: string | null | undefined): string | null {
  return address?.replace(/^::ffff:/i, '') ?? null;
}

function isUsableAddress(address: string | null): address is string {
  return address != null && isIP(address) !== 0;
}

function forwardedAddresses(value: string | string[] | undefined): string[] {
  if (typeof value !== 'string') return [];
  return value
    .split(',')
    .map((address) => canonicalAddress(address.trim()))
    .filter(isUsableAddress);
}

export function parseTrustedProxyIps(value = ''): string[] {
  return value
    .split(',')
    .map((address) => canonicalAddress(address.trim()))
    .filter((address): address is string => address != null && address.length > 0);
}

export function createRequesterId({ trustedProxyIps = [] }: { trustedProxyIps?: readonly string[] | undefined } = {}): RequesterId {
  const trusted = new BlockList();
  for (const configuredRange of trustedProxyIps.map(canonicalAddress).filter((address): address is string => address != null)) {
    const [rawAddress, prefixValue] = configuredRange.split('/');
    const address = rawAddress ?? '';
    const family = isIP(address);
    if (!family) throw new Error(`Invalid trusted proxy address: ${configuredRange}`);
    const type = ipFamilyName(family);

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

  function isTrusted(address: string | null): boolean {
    if (address == null) return false;
    const family = isIP(address);
    return family ? trusted.check(address, ipFamilyName(family)) : false;
  }

  return (req: Request): string | null => {
    const remoteAddress = req.socket?.remoteAddress ?? 'unknown';
    const canonicalRemoteAddress = canonicalAddress(remoteAddress);
    // Traefik's Docker-network address must be explicitly configured; direct clients cannot
    // select their requester bucket by sending an X-Forwarded-For header.
    if (!isTrusted(canonicalRemoteAddress)) return canonicalRemoteAddress;

    const forwarded = forwardedAddresses(req.headers['x-forwarded-for']);
    for (let index = forwarded.length - 1; index >= 0; index -= 1) {
      const address = forwarded[index];
      if (address && !isTrusted(address)) return address;
    }

    return forwarded[0] ?? canonicalRemoteAddress;
  };
}
