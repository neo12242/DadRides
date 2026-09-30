# DadRides

Self-hosted ride journal, private modification tracker and publishing API for RykerConnect. Deploy on Cloudflare Pages using your own hostname and credentials. See [DEPLOYMENT.md](DEPLOYMENT.md) for deployment and rollback guidance.

## Local preview

From this directory:

```powershell
npm ci
npm run build
npm run db:local
npm run dev
```

The preview runs at http://127.0.0.1:8890. Optional illustrated DEMO rides are synthetic; a fresh checkout contains no local ride database. `node tests/seed-demo.mjs` seeds those examples only on localhost. It is not part of the production build.

The API and bindings run in Cloudflare's local runtime. `wrangler.toml` contains a deliberately local placeholder D1 identifier. Do not use `--remote` for tests.

### Read-only preview without the Cloudflare runtime

If Windows blocks `workerd.exe`, use Node 24 or later and run `npm run preview`.
Open http://127.0.0.1:8891. This reuses the existing API, `.dev.vars` digest,
local D1 database and R2 images under `.wrangler/state/v3`. An existing standard
local setup with built `site/vendor` assets is required; it does not seed data.
The adapter expects one local D1 database, one R2 database, and the configured
`dadrides-local` image bucket. Ambiguous databases cause startup to fail.

Click **Owner**, then copy the key from `owner-local.txt` into **Publishing key**.
This ignored file is for local development only; do not share or deploy it.
The preview binds only to `127.0.0.1`, opens both databases read-only, rejects
all API writes and hides publishing/deletion controls. Nothing is deployed.
Owner authentication and public/draft access checks still run through `worker.mjs`.
This adapter is for viewing, not Cloudflare deployment validation. Stop the
process to return to the normal Wrangler preview. `npm run test:preview` checks
the adapter against isolated synthetic fixtures without touching your ride data.

## Owner access

One 256-bit random publishing key grants access to this site's owner API. It is **not a Cloudflare account token**. The API stores only its SHA-256 digest in `OWNER_TOKEN_SHA256`. The Android app encrypts the key with Android Keystore and stores the encrypted bytes in its no-backup directory. Manual browser login holds the entered key only in page memory. The app can also open the modification editor through a single-use, 60-second code exchanged for a 30-minute HttpOnly browser session.

Local development uses `.dev.vars` and `owner-local.txt`, both ignored by Git. Neither should be deployed or shared. Generate a different production key during the deployment review. Rotating the server digest revokes the old key immediately. Anyone holding the publishing key can manage this site's rides, so keep it private.

Owner endpoints require a Bearer authorization header or a valid browser session; cookie-authenticated writes require a matching Origin. Public visitors do not authenticate. Draft images are delivered through the authenticated API; the R2 bucket must remain private, with no r2.dev/public custom-domain exposure.

## App workflow

1. My Trips → saved ride → Ride summary & photos → Photos & publishing.
2. Add images using Android's picker, choose cover, save captions, reorder and tag the ride. Local photos work with the add-on disabled.
3. Settings → Add-ons → enable DadRides → configure the deployed site and its publishing key.
4. Prepare a public copy from the ride journal. Review the endpoint privacy radius, route, selected photos and statistics. Choose Queue private draft.
5. Uploads use unmetered Wi-Fi unless Allow mobile data is explicitly selected for that upload. Android may defer jobs. Failed uploads have Retry; canceling leaves any remote draft private.
6. Review / publish on website opens owner preview. Sign in with the same publishing key, inspect the exact uploaded version, then publish explicitly.
7. Local edits require a new prepared revision. The published version is unchanged until explicit replacement. Owner preview offers unpublish and delete for non-published versions.

Disabling the add-on cancels scheduled work and network calls. Previously published rides stay online. Disconnect also deletes the locally stored encrypted key. Remove local upload copy removes only the queue's copied assets; it does not delete the local journal or remote version.

## Storage, privacy and limits

- Local original: at most 15 MB per photo, 30 photos per ride. App-owned originals are separate from the phone-gallery source.
- Website copy: JPEG, up to 1600 pixels on its longest side; thumbnail 400 pixels. Re-encoding strips EXIF; the API also rejects EXIF-bearing JPEGs.
- Upload limits: 3 MB per website image, 500 KB per thumbnail, 20,000 route points and 4 MB manifest. Routes exceeding the point limit can be trimmed into a copy first.
- The server uses an atomic 8 GB reservation quota including manifest bytes, all versions, draft images and thumbnails. Delete unused remote drafts/old versions to release reservations. Failed uploads reserve space until their remote version is deleted.
- Local prepared copies are limited to 20 pending items and approximately 250 MB before preparation; an individual new job may exceed that soft local threshold. Remove old local copies when asked.
- Public routes omit points within the chosen radius of either endpoint, including later reentries, and preserve separate segments. Entire route/statistics can be excluded. Public copies never include parking, VIN, home address or maintenance records. Photos are not automatically geotagged on the public map.
- The starting privacy radius is 500 m, shown explicitly for review. It is not a guarantee of anonymity. Whole-ride totals may still be displayed when a route is trimmed.
- Current photo-inclusive backups are bounded by the existing 100 MB archive limit and 90 MB photo preflight. If exceeded, backup stops with an error rather than omitting photos. Original image data, including original EXIF, is inside the private backup.
- D1 stores metadata and manifests; R2 stores images. The application quota does not cap traffic, R2 operations, or other account-wide usage. A $0 target is not a guaranteed billing cap.
- Public API and image responses use no-store so unpublishing takes effect without relying on a CDN purge. Previously downloaded or third-party copies cannot be recalled.

## Tests

With the local server running, `npm test` tests private/public separation, schema validation, EXIF rejection, checksum failure/retry, draft completion, duplicate uploads, publication conflicts, unpublish, and concurrent quota reservations. It temporarily changes only the local quota and restores it in finally. API test rides are removed afterward.

The Android `DadRidesIntegrationTest` runs against port 8890 through `adb reverse`. It overrides storage and preferences into isolated test directories and checks photo ingestion, backup restore, duplicate queue suppression, private upload, and disabled publishing. It takes UI screenshots using synthetic records. Run through `adb shell am instrument`, **not Gradle connectedDebugAndroidTest**, because that Gradle runner can uninstall the target app and erase working emulator data.

## Cloudflare deployment design

Resource design (production IDs and current status are recorded in [DEPLOYMENT.md](DEPLOYMENT.md)):

| Resource | Proposed setup |
|---|---|
| Pages project | `dadrides`, repository root, build `npm ci && npm run build`, output `site` |
| API | Pages Functions `/api/*`; no separate duplicate Worker service |
| D1 | `dadrides`, bound as `DB`, initialized with `schema.sql` |
| R2 | private Standard bucket `dadrides-media`, bound as `PHOTOS` |
| Secret | `OWNER_TOKEN_SHA256`, new production digest |
| Domain | `rides.example.com`, attached through Pages custom domains |
| DNS | Only the `DadRides` host record, after checking the existing zone and Pages-assigned target |

Before provisioning: verify zone/account access, resource-name availability, existing usage/free allowances, R2 enrollment requirements and the final hostname target. Do not upgrade any paid plan without approval. If a conflicting DNS record exists, retain it and review replacement explicitly.

After approval: provision/bind resources, run the production schema, deploy with no demo data, attach the custom domain, verify HTTPS and anonymous draft denial, and use an approved sample for publish/unpublish checks. Keep `.dev.vars`, the local owner key, `.wrangler`, test fixtures and local database out of deployment. Only built `site` assets and compiled Pages Functions ship.

Backout: disable the app add-on, roll Pages back to the prior deployment when one exists, and revert only the reviewed DNS record. Retain D1/R2 content; do not delete resources as a rollback shortcut. Take remote backups before later destructive maintenance.

## References

- [Pages Functions bindings](https://developers.cloudflare.com/pages/functions/bindings/)
- [Local Cloudflare development](https://developers.cloudflare.com/workers/local-development/)
- [R2 pricing](https://developers.cloudflare.com/r2/pricing/)
- [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/)
