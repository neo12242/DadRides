# DadRides Mods, Services and Publishing Studio

Status: approved by the project owner on 2026-09-24 with "Proceed with this PRD". Implementation and local validation authorized. Production rollout follows review of tested artifacts and backout instructions.

## 1. Problem
DadRides needs a public home for modifications and reviews, private service information, and one place to manage published rides and mods.

## 2. Goals / success criteria
Signed-out navigation: Ride Journal, Mods. Signed-in navigation: Ride Journal, Mods, My Services, Publishing Studio. Authentication remains a separate control. Private pages and APIs require existing owner authorization.

## 3. Scope
Public Mods: stable entries with title, summary, category/tags, installation notes, review/verdict, useful links, cover image and gallery. Article-like presentation using DadRides branding. Publishing Studio: My Rides and My Mods, drafts, preview, image management, explicit publication/update/unpublication per destination (DadRides, The Alaska Geek, or both). Draft edits never silently change a public version. Independent destination status and errors.

My Services is private and read-only: configured intervals, last service date/mileage, remaining distance/time, maintenance history and latest recorded odometer. Source records are maintained in the Phone and ESP apps. Show last successful sync and unavailable/stale data. Preserve causal record versions and deletions.

## 4. Out of scope
Website service editing, public service history, receipt-photo uploads, importing mods into MakerOps, Android mod editing, earlier unapproved service-baseline and simulator work.

## 5. Constraints
Service sync uses D1 metadata only and makes zero R2 operations; Workers/D1 retain usage accounting. Mod images use existing R2 media storage. Preserve existing rides, records, signing/package identities, and MakerOps publishing behavior. No credentials in URLs, public exports or logs.

## 6. Proposed approach
DadRides owns mod drafts/revisions. A trusted publisher exports a selected revision and images into The Alaska Geek static article format. Coordinate deployment/source preservation between publishers; no DadRides content enters MakerOps records. Service mirror uses shared-library causal versions, minimal explicit fields, tombstones, and owner-only endpoints.

## 7. Implementation plan
Verify publishing configuration; add schema/API and navigation/mod studio; add service mirror to both apps and private page; add static publication bridge; test privacy, retries, conflicts, duplicates, calculations and destination failures; prepare signed APKs, additive migrations and deployment/backout package.

## 8. Risks / backout
Stale data and competing deployments require visible sync status, retained revisions, deployment serialization, persistent exported source and verified completion. Restore compatible app/site versions without replacing databases or erasing newer unrelated articles. Service writes and publication dispatch can be disabled independently.

## 9. Decisions / open questions
the project owner selected read-only services and optional per-mod destination selection. Existing owner-key login is retained. Publisher activation and credentials remain deployment prerequisites; no publisher is assumed to be installed.
