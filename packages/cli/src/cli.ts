#!/usr/bin/env node

/**
 * @fileoverview Main entry point for the agntk CLI.
 */

// Load .env files before anything else reads process.env
import 'dotenv/config';

import { main } from './run';

main().catch((err) => {
  console.error('Fatal error:', err instanceof Error ? err.message : String(err));
  if (process.env.DEBUG) {
    console.error(err instanceof Error ? err.stack : '');
  }
  process.exit(1);
});
