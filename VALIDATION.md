# Publication validation — 2026-09-16

- Fresh `npm ci`: succeeded; npm reported 0 vulnerabilities at install time.
- `node scripts/setup-local.mjs`: generated new ignored localhost credentials; no pre-existing keys were copied.
- `npm run build` and `npm run db:local`: succeeded in this separate repository copy.
- `npm test`: all 6 tests passed against the isolated local Pages/D1/R2 server on port 8890. Covers schema checks, EXIF rejection, anonymous denial, private draft/publication lifecycle, photo retry and concurrent quota enforcement.
- JavaScript syntax checks passed for the app and local setup helper.
- Publication source scan found no credential findings in DadRides. Private owner files and `.wrangler` data are ignored and absent from Git's index. Test fixtures are synthetic; personal domain references were replaced with a reserved example domain.

No production Pages/D1/R2 resources or DNS were created. This is not a production load/security audit or physical hardware test. Runtime secrets must still be generated/configured securely by each deployment owner. Automated scans do not guarantee detection of every possible secret or personal identifier.
