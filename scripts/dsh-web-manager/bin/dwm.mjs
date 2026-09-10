#!/usr/bin/env node

import process from 'node:process';
import { runCli } from '../src/cli.mjs';

const exitCode = await runCli(process.argv.slice(2));
if (typeof exitCode === 'number') {
  process.exitCode = exitCode;
}
