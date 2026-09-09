#!/usr/bin/env node
import { runCli } from '../dist/main.js'

runCli(process.argv.slice(2), {
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text),
  env: process.env,
}).then((code) => process.exit(code))
