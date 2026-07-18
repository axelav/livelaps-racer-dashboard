import { gunzipSync, gzipSync } from 'node:zlib';

export const compressArtifact = (text) => gzipSync(Buffer.from(text, 'utf8'));
export const decompressArtifact = (blob) => gunzipSync(blob).toString('utf8');
