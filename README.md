# DadRides

A self-hosted public ride journal for selected rides, routes and photos from [RykerConnect](https://github.com/neo12242/RykerConnect). This repository contains the **website/API only**. The optional Android publishing integration remains in the RykerConnect APK, disabled by default; there is no separate add-on APK.

The site provides a public gallery, filters, ride details, route maps and photo galleries, plus authenticated owner preview/publish/replace/unpublish controls. It has no visitor accounts, comments, live tracking or video uploads. Hardware is not required to run this site. RykerConnect's physical hardware remains untested while it is being built.

## Local setup

Use Node.js 22 or newer and npm. The lockfile pins the tested dependency versions. From this repository root:

```powershell
npm ci
node scripts/setup-local.mjs
npm run build
npm run db:local
npm run dev
```

Open <http://127.0.0.1:8890/>. Wrangler runs Pages Functions with local D1 and R2 bindings. `wrangler.toml` intentionally has a placeholder local database ID. Do not use `--remote` for local setup/tests.

`setup-local.mjs` generates a fresh 256-bit owner key in ignored `owner-local.txt` and its SHA-256 digest in ignored `.dev.vars`. It refuses to overwrite either file. Do not commit/share these files. The key itself is needed for owner access; a Cloudflare account token is not a substitute. No existing personal key, database or ride history is shipped.

The initial gallery is empty. To load clearly labeled synthetic examples into this localhost preview, run in another terminal:

```powershell
node tests/seed-demo.mjs
```

This is an explicit local demonstration step, not part of the production build. Tests/fixtures are synthetic. Owner access holds the entered key only in browser memory, so refreshing requires re-entry.

## Connect the Android app

Deploy your HTTPS site first. In RykerConnect → Settings → Add-ons, enable DadRides, enter your site origin and publishing key. The Android app encrypts its stored key with Android Keystore and excludes it from backups.

1. Open a saved ride → Ride summary & photos → Photos & publishing.
2. Add/select photos, captions, tags and cover. Local photos work without enabling publishing.
3. Prepare a public copy; review route trimming, selected photos and included statistics.
4. Queue a **private draft**. Uploads prefer unmetered Wi-Fi; mobile data needs an explicit override. Retry is idempotent.
5. Open owner preview on the website, enter the publishing key, inspect the exact revision and explicitly publish.
6. Later edits require a new prepared revision and explicit replacement. Use Unpublish to remove the public version. Disabling the app add-on does not unpublish existing rides.

## Deployment to Cloudflare Pages

Required resources: a Pages project, a D1 database bound as **DB**, and a **private** R2 bucket bound as **PHOTOS**. Keep R2 public access/r2.dev disabled. The API is Pages Functions under `functions/api/`; do not deploy a duplicate standalone Worker.

1. Create the D1 database and R2 bucket in your account. Update the database name/ID and bucket name in `wrangler.toml` with your own values.
2. Initialize the intended production database with `schema.sql` using Wrangler's D1 command and `--remote`. Check the account/database selection before execution. Back up existing data before future schema changes.
3. Create a Pages project connected to this repository. Build command: `npm ci && npm run build`. Output directory: `site`. Repository root: `/` (this is now a standalone repository).
4. Configure production D1/R2 bindings with the exact names above. Bindings must also be configured separately if you use preview deployments.
5. Generate a **new** production publishing key using a cryptographically secure generator. Store the key securely; set only its lowercase hex SHA-256 digest as the secret **OWNER_TOKEN_SHA256**. Never reuse the localhost key or put the raw key into Git, a URL, client JavaScript or Cloudflare configuration files.
6. Deploy and verify HTTPS, an empty gallery, unauthorized owner-request rejection, and denial of draft/media access to anonymous visitors. Test one intentional sample through draft → publish → unpublish before enabling real uploads.
7. Optionally attach your own custom domain through Pages. `rides.example.com` in documentation is a reserved example, not a deployed service.

No production resources or DNS are provisioned by these instructions automatically. Only built `site` assets and compiled Functions should deploy. `.wrangler`, `.dev.vars`, `owner-local.txt`, local databases, tests and original private media do not belong in deployment uploads. R2 enrollment/billing and current Cloudflare limits need checking for your account; the application quota is not a billing cap.

## Privacy and limits

- Public image derivatives are JPEG, up to 1600 px on the long side (400 px thumbnails), re-encoded without EXIF. The API rejects EXIF-bearing JPEGs.
- Per ride: up to 30 photos; originals up to 15 MB each. Website images up to 3 MB, thumbnails 500 KB; manifests up to 4 MB and 20,000 route points.
- Public routes omit points within the reviewed endpoint radius, including later reentries, and preserve segment gaps. The initial radius is 500 m. Route/statistics can be omitted. Trimming does not guarantee anonymity; totals and visible landmarks may reveal information.
- Public copies exclude parking, VIN, home address and maintenance records. Original local photos/backups may still contain private EXIF.
- Storage reserves an application quota of 8 GB across versions, manifests and images. Failed uploads can reserve space until deleted. This does not cap bandwidth, operations or account billing.
- Prepared local upload copies have a 20-item and approximate 250 MB soft preflight limit. Android backup has separate archive limits.
- Public responses use `no-store` to support unpublishing. Previously downloaded or third-party copies cannot be recalled.

## Tests and troubleshooting

With the isolated local server running on port 8890:

```powershell
npm test
```

Tests use the local owner key, create synthetic rides, check private/public separation, photo validation/retry, conflicts, unpublish and quota reservation, then clean up their test data. They temporarily change the **local** quota and restore it. Do not point these tests at production or a local database containing valuable records.

If owner requests return 401, confirm `.dev.vars` contains the hash of the key you entered and restart Wrangler after changes. If maps are missing, run `npm run build` and check external map access/CSP. If binding/database errors appear, check DB/PHOTOS names and run the local schema step. If port 8890 is occupied, identify the existing process before starting another server. Keep local owner files out of diagnostic reports.

Android integration tests use `adb reverse tcp:8890 tcp:8890` and isolated test storage. Use a dedicated emulator; the Gradle instrumentation runner can uninstall the target app and erase data. Ordinary app configuration expects HTTPS; localhost HTTP is for explicit debug/test paths.

## Recovery

Keep a backup of production D1/R2 before maintenance. For a bad website deployment, roll Pages back to the previous deployment and preserve stored data. Rotate the owner digest if a key is exposed; rotation immediately revokes the old key. Unpublish deliberately through owner controls; deleting a Git commit is not a way to recall published data.

## References and attribution

[RykerConnect upstream](https://github.com/JanB97/RykerConnect), [Pages bindings](https://developers.cloudflare.com/pages/functions/bindings/), [Pages local development](https://developers.cloudflare.com/pages/functions/local-development/), [D1](https://developers.cloudflare.com/d1/), [R2](https://developers.cloudflare.com/r2/).

Uses MapLibre GL JS (see its package license) and the map/style providers identified in the site. Preserve map attribution. This repository is separated from the RykerConnect development workspace; Android integration source remains in that project's GPL-3.0 fork. A separate license grant for the new website code has not yet been selected.
