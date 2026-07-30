import { gunzipSync, gzipSync } from 'node:zlib';

export const compressArtifact = (text: string): Buffer => gzipSync(Buffer.from(text, 'utf8'));
export const decompressArtifact = (blob: NodeJS.ArrayBufferView): string => gunzipSync(blob).toString('utf8');
