#!/usr/bin/env node
// Helper for shell-based GraphQL scripts — avoids shell-escaping issues
// by doing all JSON construction/extraction in Node.

import { readFileSync } from 'fs';

const [,, cmd, ...args] = process.argv;

if (cmd === 'payload') {
  // args[0] = query string, args[1] = variables JSON string
  const query = args[0];
  const variables = JSON.parse(args[1] || '{}');
  process.stdout.write(JSON.stringify({ query, variables }));
} else if (cmd === 'extract') {
  // args[0] = JSON string (or '-' for stdin), args[1] = dot.path
  const input = args[0] === '-' ? readFileSync(0, 'utf8') : args[0];
  const path = args[1];
  const data = JSON.parse(input);
  const parts = path.split('.');
  let v = data;
  for (const p of parts) {
    if (v == null) { console.log(''); process.exit(0); }
    v = v[p];
  }
  console.log(v == null ? '' : String(v));
} else if (cmd === 'count') {
  // args[0] = JSON string (or '-' for stdin), args[1] = dot.path to array
  const input = args[0] === '-' ? readFileSync(0, 'utf8') : args[0];
  const path = args[1];
  const data = JSON.parse(input);
  const parts = path.split('.');
  let v = data;
  for (const p of parts) {
    if (v == null) { console.log('0'); process.exit(0); }
    v = v[p];
  }
  console.log(Array.isArray(v) ? String(v.length) : '0');
} else {
  console.error(`Unknown command: ${cmd}`);
  process.exit(1);
}
