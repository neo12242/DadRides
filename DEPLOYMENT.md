# Deploying DadRides

This repository contains source and synthetic test fixtures only. Supply your own Cloudflare account, hostname, database, private image bucket and owner key. Never commit local credentials, production resource identifiers, exported ride data or deployment receipts.

## Prepare and validate

1. Use Node 24 or newer and run `npm ci`, `npm test` and `npm run build`.
2. For local development, use `node scripts/setup-local.mjs` and the local Wrangler commands in the README. Local secrets and state are ignored by Git.
3. For an isolated writable ownership preview, set `DADRIDES_OWNERSHIP_PREVIEW_DIR` to a private directory outside the repository and run `node scripts/ownership-preview.mjs`. It listens on loopback port 8893 and creates a local-only key/database. It never connects to a production binding.

## Production prerequisites

- Create a Pages project, a D1 database bound as `DB`, and a private R2 bucket bound as `PHOTOS`. Keep R2 public access disabled.
- Configure the production bindings separately from the placeholder local identifiers in `wrangler.toml`.
- Generate a separate owner publishing key. Store only its SHA-256 digest as `OWNER_TOKEN_SHA256` in the runtime secret store. Distribute the key privately to the owner; it is not a Cloudflare API token.
- Keep publisher credentials separate from the owner key. The optional external publication worker requires an explicitly configured destination and its own private environment; see `publisher/README.md`.

## Schema and deployment

For a new database, initialize `schema.sql`. For an existing installation, back up the database first and apply the required additive migrations in order: `0001_shared_library.sql`, `0002_mods_services.sql`, then `ownership-dashboard.sql`. Review which migrations are already present before execution. Do not replace the database or import demonstration data.

Deploy the built `site` directory through your configured Pages workflow. Use HTTPS. The ownership browser handoff expires after 60 seconds and is single-use; the resulting session expires after 30 minutes. Session writes require same-origin requests, and rotating the owner digest revokes previous sessions.

Verify anonymous denial of private owner endpoints, authenticated owner status, private draft editing, two-way modification revision checks, and the signed-in editor handoff. Publishing a public article remains an explicit owner action; private expenses must never appear in public article responses.

## Backout

Record the previous Pages deployment before rollout. If verification fails, restore that deployment and disable the app integration until the issue is understood. Retain database and R2 content; additive tables can remain unused. Do not delete records or restore a database backup over later owner edits without a separate recovery review.

Keep deployment receipts, backup locations, credentials and account-specific settings outside Git. A source push is not a production deployment approval.
