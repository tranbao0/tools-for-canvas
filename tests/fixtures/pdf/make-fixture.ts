// Writes tests/fixtures/pdf/fixture.pdf from the builder.
// Usage: node tests/fixtures/pdf/make-fixture.ts
import { writeFileSync } from 'node:fs';
import { fixturePdf } from './fixture.ts';

const file = new URL('./fixture.pdf', import.meta.url);
writeFileSync(file, fixturePdf());
console.log(`Wrote ${file.pathname}`);
