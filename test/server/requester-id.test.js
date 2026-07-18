import { describe, expect, it } from 'vitest';
import { createRequesterId } from '../../server/requester-id.js';

function request({ remoteAddress, forwardedFor }) {
  return {
    socket: { remoteAddress },
    headers: forwardedFor ? { 'x-forwarded-for': forwardedFor } : {}
  };
}

describe('requester identity', () => {
  it('uses the client address forwarded by an explicitly trusted Traefik proxy', () => {
    const requesterId = createRequesterId({ trustedProxyIps: ['172.22.0.5'] });

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
    const requesterId = createRequesterId({ trustedProxyIps: ['172.22.0.5'] });

    expect(
      requesterId(
        request({ remoteAddress: '198.51.100.99', forwardedFor: '198.51.100.10' })
      )
    ).toBe('198.51.100.99');
  });
});
