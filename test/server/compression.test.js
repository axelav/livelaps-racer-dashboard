import { describe, expect, it } from 'vitest';
import { compressArtifact, decompressArtifact } from '../../server/compression.js';

describe('artifact compression', () => {
  it('round-trips text through gzip compression', () => {
    expect(decompressArtifact(compressArtifact('<html>race</html>'))).toBe('<html>race</html>');
  });
});
