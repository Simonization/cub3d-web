// Prints ACCEPT or REJECT for a .cub file, so the TS parser can be diffed against
// a harness built from the original C. Used by scripts/parity-fuzz.py.
import { readFileSync } from 'node:fs';

import { parseCub } from '../src/format/cub.ts';

const result = parseCub(readFileSync(process.argv[2]!, 'utf8'));
process.stdout.write(result.ok ? 'ACCEPT\n' : 'REJECT\n');
