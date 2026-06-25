import { Router } from 'express';
import type { Request, Response } from 'express';
import {
  getSyncState,
  syncCatalog,
} from '../services/catalog-sync.js';

export const premiumRouter = Router();

function statusPayload() {
  return {
    catalog: getSyncState(),
  };
}

/** GET /api/premium — catalog sync status. */
premiumRouter.get('/', (_req: Request, res: Response) => {
  res.json(statusPayload());
});

/** POST /api/premium/sync — check for updates now. */
premiumRouter.post('/sync', async (_req: Request, res: Response) => {
  const sync = await syncCatalog();
  res.json({ ...statusPayload(), sync });
});
