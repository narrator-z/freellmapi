// Post-merge i18n normalization:
// The fork replaced PremiumPage with CatalogPage (catalog.* keys), while the
// 58 locales imported from upstream v0.6.0 still carry premium.* keys and
// lack the fork's catalog keys. Runtime falls back to English for missing
// keys, so filling gaps with en values preserves pre-merge behavior exactly.
// zh-TW gets proper Traditional Chinese translations (mirroring zh-CN).
import fs from 'node:fs';
import path from 'node:path';

const dir = 'client/src/i18n/locales';
const en = JSON.parse(fs.readFileSync(path.join(dir, 'en.json'), 'utf8'));

const zhTW = {
  navCatalog: '目錄同步',
  fusionLoadError: '載入設定失敗: {error}',
  catalog: {
    title: '目錄同步',
    description:
      'Augmented catalog 由 narratorz 維護和託管。新模型、配額調整和缺陷修復會在發佈後數小時內到達。本伺服器每 12 小時自動同步一次。',
    loading: '載入中…',
    checkForUpdates: '檢查更新',
    syncing: '同步中…',
    catalogFeed: '目錄來源',
    feedLabel: 'Augmented catalog',
    lastChecked: '上次檢查:{when}',
    syncDescription: 'Augmented catalog 由 narratorz 維護和託管。本伺服器每 12 小時自動同步一次。',
    lastSyncProblem: '上次同步問題:{error}',
    bundled: '內建',
  },
};

const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json') && !['en.json', 'zh-CN.json'].includes(f));

for (const file of files) {
  const p = path.join(dir, file);
  const d = JSON.parse(fs.readFileSync(p, 'utf8'));

  // Drop premium leftovers from upstream.
  if (d.nav) {
    delete d.nav.premium;
    delete d.nav.upgrade;
  }
  delete d.premium;

  const isZhTW = file === 'zh-TW.json';

  // Fill fork-specific keys (English fallback except zh-TW).
  d.nav = d.nav || {};
  if (d.nav.catalog === undefined) d.nav.catalog = isZhTW ? zhTW.navCatalog : en.nav.catalog;
  d.fusion = d.fusion || {};
  if (d.fusion.loadError === undefined) d.fusion.loadError = isZhTW ? zhTW.fusionLoadError : en.fusion.loadError;
  if (d.catalog === undefined) d.catalog = isZhTW ? zhTW.catalog : en.catalog;
  else {
    for (const [k, v] of Object.entries(isZhTW ? zhTW.catalog : en.catalog)) {
      if (d.catalog[k] === undefined) d.catalog[k] = v;
    }
  }

  fs.writeFileSync(p, JSON.stringify(d, null, 2) + '\n');
  console.log('fixed', file);
}
