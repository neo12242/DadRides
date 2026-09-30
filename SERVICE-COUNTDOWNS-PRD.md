# My Services countdowns

Approved by the project owner with "proceeed" on September 26, 2026. Implementation authorized; production deployment follows review of the tested result.

1. Problem: time remaining is not clearly displayed on My Services cards.
2. Success: show remaining miles, due odometer, remaining calendar days and due date.
3. Scope: DadRides My Services cards only.
4. Out of scope: app updates or changes to intervals, baselines and service records.
5. Constraints: use synced odometer data; retain stale-data notices; show missing baseline/unset interval states; withhold counters during conflicts.
6. Approach: separate Mileage and Time sections. Show Due now, Due today or Overdue by as appropriate. Calendar-day differences avoid daylight-saving rounding errors. Existing due-date and distance calculations remain the source of truth.
7. Plan: update rendering and derived display fields, verify normal/due/overdue/missing-data/conflict cases, inspect desktop/mobile previews, prepare a frontend-only deploy stage.
8. Risk/backout: no database/API changes. Restore the previous frontend while retaining the baseline-compatible worker.
9. Open questions: none.

## Implemented and verified

All 14 countdown/mods/services tests passed. Browser verification passed on desktop
and at 390px mobile width: normal countdowns, due today, overdue, missing baselines,
unset intervals, conflict suppression and no horizontal overflow or page errors.
Screenshots use explicitly labeled synthetic examples, not the project owner's service schedule.

Preview: `.wrangler/service-countdowns-desktop.png` and
`.wrangler/service-countdowns-mobile.png`.

Prepared stage: `.wrangler/production-stage-20260926-service-countdowns/`.
The live assets matched the preceding baseline release before preparation.
Only services.js, app.js and index.html differ; the worker and bindings are identical.
No API, database, maintenance data or APK changes. Production deployed after the project owner's
"deploy" approval: https://a2cde106.dadrides.pages.dev.

Live verification: all three changed assets matched the stage; service definitions,
baselines, maintenance, fuel readings and conflicts matched the pre-deploy snapshot.
Anonymous owner-service access remained blocked. Authenticated mobile browser showed
all 12 service cards with Mileage and Time sections, no overflow and no page errors.

Backout: redeploy the previous `.wrangler/production-stage-20260926-service-baseline/`
bundle or restore deployment `5e653573` through Pages. Both retain baseline-compatible
API support. Keep all service records and media.
