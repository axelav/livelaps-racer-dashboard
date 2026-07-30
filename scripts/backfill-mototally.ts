#!/usr/bin/env node
import { runMotoTallyBackfillCli } from '../server/backfill/mototally.js';

const exitCode: number = await runMotoTallyBackfillCli();
process.exitCode = exitCode;
