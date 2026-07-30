import express, { type Express, type Request, type Response } from 'express';

export function configureStaticApp(app: Express, { distPath }: { distPath: string }): void {
  app.use(express.static(distPath));
  app.get('/{*splat}', (_req: Request, res: Response) => res.sendFile('index.html', { root: distPath }));
}
