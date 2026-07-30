#!/usr/bin/env node
import { runLiveLapsBackfillCli } from '../server/backfill/livelaps.js';

const exitCode: number = await runLiveLapsBackfillCli();
process.exitCode = exitCode;
