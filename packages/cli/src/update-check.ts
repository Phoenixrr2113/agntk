/**
 * @file Non-blocking update checker using check-then-notify pattern.
 *
 * On each run, reads the cached check result and notifies if a newer version exists.
 * Then kicks off a background fetch to npm registry for the *next* run.
 * Never slows down CLI startup — the fetch is fire-and-forget.
 *
 * Cache: ~/.agntk/.update-check (JSON with version + timestamp)
 * TTL: 24 hours between registry fetches.
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { get } from 'node:https';
import { getVersion } from './version';

const AGNTK_DIR = join(homedir(), '.agntk');
const CACHE_FILE = join(AGNTK_DIR, '.update-check');
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours
const PACKAGE_NAME = 'agntk';

interface UpdateCache {
  latestVersion: string;
  checkedAt: number;
}

/**
 *
 */
function readCache(): UpdateCache | null {
  try {
    if (!existsSync(CACHE_FILE)) return null;
    return JSON.parse(readFileSync(CACHE_FILE, 'utf-8')) as UpdateCache;
  } catch {
    return null;
  }
}

/**
 *
 * @param cache
 */
function writeCache(cache: UpdateCache): void {
  try {
    mkdirSync(AGNTK_DIR, { recursive: true });
    writeFileSync(CACHE_FILE, JSON.stringify(cache), 'utf-8');
  } catch {
    // Silent
  }
}

/**
 * Compare two semver strings. Returns true if b is newer than a.
 * @param current
 * @param latest
 */
function isNewer(current: string, latest: string): boolean {
  const parse = (v: string) => v.replace(/^v/, '').split('.').map(Number);
  const a = parse(current);
  const b = parse(latest);

  for (let i = 0; i < 3; i++) {
    const av = a[i] ?? 0;
    const bv = b[i] ?? 0;
    if (bv > av) return true;
    if (bv < av) return false;
  }
  return false;
}

/** Fire-and-forget fetch of latest version from npm registry */
function fetchLatestVersion(): void {
  try {
    const req = get(
      `https://registry.npmjs.org/${PACKAGE_NAME}/latest`,
      { headers: { Accept: 'application/json' }, timeout: 5000 },
      (res) => {
        if (res.statusCode !== 200) return;

        let data = '';
        res.on('data', (chunk: Buffer) => {
          data += chunk.toString();
        });
        res.on('end', () => {
          try {
            const pkg = JSON.parse(data) as { version?: string };
            if (pkg.version) {
              writeCache({ latestVersion: pkg.version, checkedAt: Date.now() });
            }
          } catch {
            // Silent
          }
        });
      },
    );

    req.on('error', () => {
      /* Silent */
    });

    // Unref so the request doesn't keep the process alive
    if ('unref' in req && typeof req.unref === 'function') {
      (req as { unref: () => void }).unref();
    }
  } catch {
    // Silent
  }
}

/**
 * Check for updates. Returns a message string if an update is available, null otherwise.
 * Kicks off a background fetch for the next run if the cache is stale.
 * Never blocks, never throws.
 */
export function checkForUpdate(): string | null {
  try {
    const currentVersion = getVersion();
    const cache = readCache();

    // Kick off background fetch if cache is missing or stale
    if (!cache || Date.now() - cache.checkedAt > CHECK_INTERVAL_MS) {
      fetchLatestVersion();
    }

    // Notify based on cached result (from previous run)
    if (cache && isNewer(currentVersion, cache.latestVersion)) {
      return `Update available: ${currentVersion} → ${cache.latestVersion} — run npm i -g agntk`;
    }

    return null;
  } catch {
    return null;
  }
}
