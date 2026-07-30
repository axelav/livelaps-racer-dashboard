import express from 'express';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { configureStaticApp } from '../../server/static.js';

const distPath = fileURLToPath(new URL('../fixtures/static-app/', import.meta.url));

describe('production static app configuration', () => {
  it('serves built static assets', async () => {
    const app = express();
    configureStaticApp(app, { distPath });

    const response = await request(app).get('/asset.txt');

    expect(response.status).toBe(200);
    expect(response.text).toBe('built asset\n');
  });

  it('serves the index shell for an unknown SPA route', async () => {
    const app = express();
    configureStaticApp(app, { distPath });

    const response = await request(app).get('/racer/axel-anderson');

    expect(response.status).toBe(200);
    expect(response.text).toContain('<title>Enduro app</title>');
  });
});
