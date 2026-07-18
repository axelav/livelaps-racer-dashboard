import express from 'express';

export function configureStaticApp(app, { distPath }) {
  app.use(express.static(distPath));
  app.get('/{*splat}', (_req, res) => res.sendFile('index.html', { root: distPath }));
}
