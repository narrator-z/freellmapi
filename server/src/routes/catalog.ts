import { Router } from 'express';
import type { Request, Response } from 'express';
import {
  getAugmentedSyncState,
  syncAugmentedCatalog,
} from '../services/augmented-catalog-sync.js';

export const catalogRouter = Router();

function statusPayload() {
  return {
    catalog: getAugmentedSyncState(),
  };
}

/** GET /api/catalog — augmented catalog sync status. */
catalogRouter.get('/', (_req: Request, res: Response) => {
  res.json(statusPayload());
});

/** POST /api/catalog/sync — check for updates now. */
catalogRouter.post('/sync', async (_req: Request, res: Response) => {
  const sync = await syncAugmentedCatalog();
  res.json({ ...statusPayload(), sync });
});
