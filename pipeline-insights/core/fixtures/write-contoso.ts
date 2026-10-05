/** Rewrites contoso.json from contoso.ts: `npm run fixture -w @pipeline-insights/core`. */
import { writeFileSync } from 'node:fs';
import { fixtureText } from './contoso.js';

const out = new URL('./contoso.json', import.meta.url);
writeFileSync(out, fixtureText());
console.log(`wrote ${out.pathname}`);
