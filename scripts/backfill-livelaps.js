#!/usr/bin/env node
import { runLiveLapsBackfillCli } from '../server/backfill/livelaps.js';

process.exitCode = await runLiveLapsBackfillCli();
