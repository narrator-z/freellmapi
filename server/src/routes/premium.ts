import { Router } from 'express';
import type { Request, Response } from 'express';
import { getSetting, setSetting, getDb } from '../db/index.js';
import {
  SETTING_LICENSE_KEY,
  getCachedLicenseStatus,
  getSyncState,
  refreshLicenseStatus,
  syncCatalog,
} from '../services/catalog-sync.js';

export const premiumRouter = Router();

function maskKey(key: string): string {
  if (key.length <= 10) return key;
  return `${key.slice(0, 7)}…${key.slice(-4)}`;
}

function statusPayload() {
  const key = getSetting(SETTING_LICENSE_KEY);
  return {
    hasKey: Boolean(key),
    maskedKey: key ? maskKey(key) : null,
    license: getCachedLicenseStatus(),
    catalog: getSyncState(),
    siteUrl: (process.env.PREMIUM_SITE_URL ?? 'https://freellmapi.co').replace(/\/$/, ''),
  };
}

/** GET /api/premium — everything the Premium page renders. */
premiumRouter.get('/', (_req: Request, res: Response) => {
  res.json(statusPayload());
});

/**
 * POST /api/premium/key { key } — store a license key locally.
 * Remote activation/validation has been removed. The key is stored as-is;
 * the catalog is always treated as live regardless.
 */
premiumRouter.post('/key', async (req: Request, res: Response) => {
  const key = typeof req.body?.key === 'string' ? req.body.key.trim() : '';
  if (key.length < 8) {
    res.status(400).json({ error: 'Enter the license key from your purchase email.' });
    return;
  }

  setSetting(SETTING_LICENSE_KEY, key);
  await refreshLicenseStatus();
  const sync = await syncCatalog(true);
  res.json({ ...statusPayload(), sync });
});

/** DELETE /api/premium/key — deactivate locally (the purchase itself is untouched). */
premiumRouter.delete('/key', async (_req: Request, res: Response) => {
  const db = getDb();
  db.prepare('DELETE FROM settings WHERE key IN (?, ?)').run(SETTING_LICENSE_KEY, 'premium_license_status');
  void syncCatalog(true);
  res.json(statusPayload());
});

/** POST /api/premium/sync — manual "check for updates now". */
premiumRouter.post('/sync', async (_req: Request, res: Response) => {
  await refreshLicenseStatus();
  const sync = await syncCatalog(true);
  res.json({ ...statusPayload(), sync });
});

/**
 * POST /api/premium/portal — no-op (remote Stripe integration removed).
 */
premiumRouter.post('/portal', (_req: Request, res: Response) => {
  res.json({ url: '#' });
});