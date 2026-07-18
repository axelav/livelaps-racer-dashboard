import express from 'express';
import { parseHTML } from 'linkedom';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';
import { openDatabase } from './archive/database.js';
import { createArchive } from './archive/repository.js';
import { createLimiter } from './rate-limit.js';
import { createSources } from './sources/index.js';

const db = openDatabase(process.env.ENDURO_DB_PATH ?? '/data/enduro.db');
const app = createApp({
  archive: createArchive(db),
  sources: createSources({
    fetchImpl: fetch,
    parseHtml: (html) => parseHTML(html).document
  }),
  limiter: createLimiter()
});
const distPath = fileURLToPath(new URL('../dist/', import.meta.url));

app.use(express.static(distPath));
app.get('/{*splat}', (_req, res) => res.sendFile('index.html', { root: distPath }));
app.listen(Number(process.env.PORT ?? 3000));
