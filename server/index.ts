import { parseHTML } from 'linkedom';
import { resolve } from 'node:path';
import { createApp } from './app.js';
import { openDatabase } from './archive/database.js';
import { createArchive } from './archive/repository.js';
import { createLimiter } from './rate-limit.js';
import { parseTrustedProxyIps } from './requester-id.js';
import { configureStaticApp } from './static.js';
import { createSources } from './sources/index.js';

const db = openDatabase(process.env.ENDURO_DB_PATH ?? '/data/enduro.db');
const app = createApp({
  archive: createArchive(db),
  sources: createSources({
    fetchImpl: fetch,
    parseHtml: (html: string): Document => parseHTML(html).document as unknown as Document
  }),
  limiter: createLimiter(),
  trustedProxyIps: parseTrustedProxyIps(process.env.ENDURO_TRUSTED_PROXY_IPS)
});
const distPath = resolve(process.env.ENDURO_STATIC_PATH ?? 'dist');

configureStaticApp(app, { distPath });
app.listen(Number(process.env.PORT ?? 3000));
