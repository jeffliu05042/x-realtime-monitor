#!/usr/bin/env node

import process from "node:process";

import { execute } from "../src/cli.js";

process.exitCode = await execute(process.argv.slice(2));
