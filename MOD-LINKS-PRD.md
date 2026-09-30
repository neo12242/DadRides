# Mod links and initial private drafts

Approved by the project owner on 2026-09-26: "proceed" after reviewing the scope and clarifying that cruise control is aftermarket and the OEM electric latch locks the frunk when the bike is off.

1. Problem: maintain upcoming modifications as parts are ordered and installed.
2. Success: six editable private drafts and optional labeled product/YouTube links in the editor and article preview/public view.
3. Scope: aftermarket cruise control, aftermarket keyed parking brake lock, HJC Cardo Packtalk mount, salvage OEM electric frunk latch, GP2GS aftermarket MaxMount, TricLED brake light flasher.
4. Out of scope: purchasing, publishing these drafts, invented installation/review results, unrelated app changes.
5. Constraints: unknown facts remain pending; quoted prices are not confirmed purchase totals. Cruise control shipping is treated as additional, subject to correction.
6. Approach: replace the links textarea with add/remove labeled URL rows; identify YouTube URLs by hostname while retaining the existing link document schema. External videos open on YouTube.
7. Implementation: verify existing deployed bundle; update the link editor/display; test validation, save/reload and article rendering; deploy only changed frontend assets; create drafts through the authenticated API; verify anonymous exclusion.
8. Risks/backout: preserve existing backend and bindings; keep prior deployed assets for Pages rollback. Retain draft content privately if rolling back the frontend. No migration or public publication is needed.
9. Open details: exact marketplace listings, purchase dates/status, unprovided prices/shipping, helmet/mount details and installation results remain pending.
