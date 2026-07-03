import { Router } from 'express';
import type { Request, Response } from 'express';
import {
  getSyncState,
  syncCatalog,
} from '../services/catalog-sync.js';

export const catalogRouter = Router();

function statusPayload() {
  return {
    catalog: getSyncState(),
  };
}

/** GET /api/catalog — catalog sync status. */
catalogRouter.get('/', (_req: Request, res: Response) => {
  res.json(statusPayload());
});

/** POST /api/catalog/sync — check for updates now. */
catalogRouter.post('/sync', async (_req: Request, res: Response) => {
  const sync = await syncCatalog();
  res.json({ ...statusPayload(), sync });
});
