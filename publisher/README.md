# Public-site publishing bridge

The DadRides worker consumes only approved mod publication jobs. It never calls MakerOps. Its scoped credential cannot read rides, services or unrelated private images. It produces static article files for The Alaska Geek and verifies a public release marker plus the article before reporting success. Images are copied at publication time; public visitors do not depend on DadRides or MakerOps.

## Deployment prerequisites

Implementation is staged locally; production activation still requires the project owner's deployment approval.

1. Preserve the live The Alaska Geek source and current deployment. The readonly check on 2026-09-24 found production branch `main`, deployment `32ae9e80-c79a-48be-a7df-342cbcebcc60`. Recheck this at deployment time.
2. Use an authoritative source at `/srv/public-site-publisher/site` with installed, locked Astro dependencies. Never seed a new build from an outdated checkout that omits live articles.
3. Install `worker.py` and `shared_site.py` under `/srv/dadrides-publisher`, owned by the project owner with private state/config permissions. Install locked Wrangler/Node tools separately. Python uses only the standard library.
   The rollout pins Node 24.12.0 and Wrangler 4.131.2. Set the private Node `bin` directory in `PATH`, and `TZ=America/Anchorage`. The source renders date-only values in UTC so the authored date is retained. The worker identifies itself as `DadRides-Publisher/1.6.0`; Cloudflare rejected Python's default user agent with error 1010 during server verification. No Cloudflare security settings were changed.
4. Configure the environment from `publisher.env.example`. Keep a randomly generated publisher token in the private host environment only; put its SHA-256 digest in the DadRides Pages secret `PUBLISHER_TOKEN_SHA256`. Do not reuse or disclose the owner publishing key. The Cloudflare token must be scoped to the intended account/Pages deployment. Do not put credentials in command arguments, browser code, source, ZIPs or logs.
5. `PUBLICATION_INITIAL_HEAD` must match the verified current The Alaska Geek production deployment. Both publishers use the exact same `PUBLICATION_SHARED_STATE` and authoritative source. The state contains a global deployment lock, persistent approved exports and the verified production head.
6. If enabling MakerOps publishing, deploy its included coordination update first. Set `PUBLICATION_SHARED_MODULE` to the installed `shared_site.py`, `PUBLICATION_SHARED_STATE` to the same shared state and `MAKEROPS_SITE_SOURCE` to the same site source. Existing YouTube gates, approvals and MakerOps records remain unchanged. No DadRides mod is imported into MakerOps. Never run the old uncoordinated publisher alongside this worker.
7. Install the user unit `dadrides-publisher.service`, reload the user manager and start it only after the approved deployment. Verify startup and logs without printing environment variables. System and user MakerOps publisher services were inactive during implementation; activation is not implied by copying these files.

## Operation

- Save a mod draft in DadRides, preview it, then publish to each selected destination. Selecting The Alaska Geek queues a durable job. The studio shows queued, publishing, published, unpublished, or failed per site.
- Draft revisions stay immutable. An update cannot replace an in-progress publication. A failed destination leaves the other destination's published revision intact.
- One global deployment lock serializes both publishers. The latest committed exports from every publisher are included in each build, preventing a later MakerOps deployment from dropping a DadRides article or the reverse.
- Each provider owns its article/media paths. Unknown source changes and collisions fail closed. Unpublishing removes only that mod's owned static exports and emits a withdrawal marker; unrelated articles remain.
- Repeated or uncertain jobs reconcile the public marker before trying another deployment. A lost lease rejects stale completions. After an uncertain dispatch, the durable pending bundle is retained and other releases are blocked until that release is reconciled. The DadRides lease expires after 20 minutes without heartbeat, allowing the same job to be reclaimed. Do not erase `pending.json` to force another release through.
- On an outside/manual deployment, stop the publishers, reconcile the authoritative source and persistent exports against production, and advance the expected head only after inspection. An external deployment is never silently adopted.
- If a pending MakerOps release reports NeedsAttention, reconcile that original release/marker before dispatching a different release. Retain its shared pending state. This is deliberately fail-closed rather than discarding an uncertain publication.

## Validation

`python -m unittest -v test_publisher.py` covers escaped text, image hashes, withdrawal, source collisions, cross-publisher preservation and recovery without duplicate deployment. The existing MakerOps `test_worker.py` suite remains applicable. An isolated copy of the actual Astro site was built with a generated DadRides article and image; it did not publish any test content.

## Pause / backout

Stop the publisher user services before rolling back deployment plumbing. DadRides `MODS_READ_ONLY=true` pauses new mod writes and dispatch; `SERVICES_READ_ONLY=true` independently pauses service sync. Retain shared exports, pending bundles, D1 data and R2 media. Do not restore a stale site snapshot over unrelated newer articles. An article-specific backout is another reviewed publication/unpublication; a site-code rollback must rebuild with all currently committed exports.
