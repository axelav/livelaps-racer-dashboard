import { describe, expect, it } from 'vitest';
import { createRequesterId, parseTrustedProxyIps } from '../../server/requester-id.js';

type RequestOptions = {
  remoteAddress: string;
  forwardedFor?: string;
};

type RequestLike = {
  socket: { remoteAddress: string };
  headers: { 'x-forwarded-for'?: string };
};
type RequesterRequest = never;


function requesterIdConfig(trustedProxyIps: string[]): Parameters<typeof createRequesterId>[0] {
  return { trustedProxyIps } as unknown as Parameters<typeof createRequesterId>[0];
}

function request({ remoteAddress, forwardedFor }: RequestOptions): RequesterRequest {
  const req: RequestLike = {
    socket: { remoteAddress },
    headers: forwardedFor ? { 'x-forwarded-for': forwardedFor } : {}
  };
  return req as RequesterRequest;
}

describe('requester identity', () => {
  it('accepts a configured Docker network CIDR for the Traefik proxy', () => {
    const requesterId = createRequesterId(
      requesterIdConfig(parseTrustedProxyIps('172.16.0.0/12') as string[])
    );

    expect(
      requesterId(
        request({
          remoteAddress: '172.22.0.5',
          forwardedFor: '198.51.100.10'
        })
      )
    ).toBe('198.51.100.10');
  });

  it('uses the client address forwarded by an explicitly trusted Traefik proxy', () => {
    const requesterId = createRequesterId(requesterIdConfig(['172.22.0.5']));

    expect(
      requesterId(
        request({
          remoteAddress: '172.22.0.5',
          forwardedFor: '198.51.100.10, 172.22.0.5'
        })
      )
    ).toBe('198.51.100.10');
  });

  it('ignores a spoofed forwarded address from a direct client', () => {
    const requesterId = createRequesterId(requesterIdConfig(['172.22.0.5']));

    expect(
      requesterId(
        request({ remoteAddress: '198.51.100.99', forwardedFor: '198.51.100.10' })
      )
    ).toBe('198.51.100.99');
  });

  it('ignores a spoofed leftmost address appended ahead of the real client by Traefik', () => {
    const requesterId = createRequesterId(requesterIdConfig(['172.22.0.0/24']));

    expect(
      requesterId(
        request({
          remoteAddress: '172.22.0.5',
          forwardedFor: '203.0.113.99, 198.51.100.10'
        })
      )
    ).toBe('198.51.100.10');
  });
});
