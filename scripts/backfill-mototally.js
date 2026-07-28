#!/usr/bin/env node
import { runMotoTallyBackfillCli } from '../server/backfill/mototally.js';

process.exitCode = await runMotoTallyBackfillCli();
