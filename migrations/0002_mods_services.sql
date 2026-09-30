-- Additive. Existing ride tables and media are untouched.
CREATE TABLE IF NOT EXISTS service_mirror(key TEXT PRIMARY KEY, branches TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS service_contact(id INTEGER PRIMARY KEY CHECK(id=1), received INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS mods(id TEXT PRIMARY KEY, slug TEXT NOT NULL UNIQUE, head TEXT, published TEXT);
CREATE TABLE IF NOT EXISTS mod_revisions(id TEXT PRIMARY KEY, mod TEXT NOT NULL REFERENCES mods(id), document TEXT NOT NULL, created INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS mod_revision_owner ON mod_revisions(mod,created);
CREATE TABLE IF NOT EXISTS mod_media(id TEXT PRIMARY KEY, sha TEXT NOT NULL, bytes INTEGER NOT NULL, ready INTEGER NOT NULL DEFAULT 0, lease INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS mod_revision_media(revision TEXT NOT NULL REFERENCES mod_revisions(id), media TEXT NOT NULL REFERENCES mod_media(id), PRIMARY KEY(revision,media));
CREATE TABLE IF NOT EXISTS mod_destinations(mod TEXT NOT NULL REFERENCES mods(id), destination TEXT NOT NULL, desired TEXT, published TEXT, state TEXT NOT NULL, job TEXT NOT NULL, claim TEXT, lease INTEGER NOT NULL DEFAULT 0, error TEXT, updated INTEGER NOT NULL, PRIMARY KEY(mod,destination));
CREATE UNIQUE INDEX IF NOT EXISTS mod_publication_job ON mod_destinations(job);

DROP TRIGGER IF EXISTS enforce_quota;
CREATE TRIGGER enforce_quota BEFORE INSERT ON revisions
WHEN COALESCE((SELECT SUM(bytes) FROM revisions),0)+COALESCE((SELECT SUM(bytes) FROM mod_media),0)+NEW.bytes > (SELECT quota FROM limits WHERE id=1)
BEGIN SELECT RAISE(ABORT,'Storage quota reached'); END;
CREATE TRIGGER IF NOT EXISTS enforce_mod_quota BEFORE INSERT ON mod_media
WHEN COALESCE((SELECT SUM(bytes) FROM revisions),0)+COALESCE((SELECT SUM(bytes) FROM mod_media),0)+NEW.bytes > (SELECT quota FROM limits WHERE id=1)
BEGIN SELECT RAISE(ABORT,'Storage quota reached'); END;
