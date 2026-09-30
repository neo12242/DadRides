PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS rides(id TEXT PRIMARY KEY, published TEXT);
CREATE TABLE IF NOT EXISTS revisions(id TEXT PRIMARY KEY, ride TEXT NOT NULL REFERENCES rides(id), manifest TEXT NOT NULL, bytes INTEGER NOT NULL CHECK(bytes>=0), ready INTEGER NOT NULL DEFAULT 0, created INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS assets(key TEXT PRIMARY KEY, revision TEXT NOT NULL REFERENCES revisions(id) ON DELETE CASCADE, sha TEXT NOT NULL, bytes INTEGER NOT NULL, ready INTEGER NOT NULL DEFAULT 0, lease INTEGER NOT NULL DEFAULT 0);
CREATE INDEX IF NOT EXISTS revisions_ride ON revisions(ride);
CREATE TABLE IF NOT EXISTS limits(id INTEGER PRIMARY KEY CHECK(id=1), quota INTEGER NOT NULL);
INSERT OR IGNORE INTO limits VALUES(1,8000000000);
CREATE TRIGGER IF NOT EXISTS enforce_quota BEFORE INSERT ON revisions
WHEN COALESCE((SELECT SUM(bytes) FROM revisions),0)+NEW.bytes > (SELECT quota FROM limits WHERE id=1)
BEGIN SELECT RAISE(ABORT,'Storage quota reached'); END;
-- Additive and repeatable. Existing manifests and objects are unchanged.
CREATE TABLE IF NOT EXISTS revision_assets(
 revision TEXT NOT NULL REFERENCES revisions(id) ON DELETE CASCADE,
 name TEXT NOT NULL,
 asset TEXT NOT NULL REFERENCES assets(key) ON DELETE RESTRICT,
 PRIMARY KEY(revision,name)
);
CREATE INDEX IF NOT EXISTS revision_assets_asset ON revision_assets(asset);
INSERT OR IGNORE INTO revision_assets SELECT revision,substr(key,instr(key,'/')+1),key FROM assets;
CREATE TRIGGER IF NOT EXISTS map_new_asset AFTER INSERT ON assets BEGIN
 INSERT INTO revision_assets(revision,name,asset) VALUES(NEW.revision,substr(NEW.key,instr(NEW.key,'/')+1),NEW.key);
END;
CREATE TABLE IF NOT EXISTS sync_clock(id INTEGER PRIMARY KEY CHECK(id=1),value INTEGER NOT NULL);
INSERT OR IGNORE INTO sync_clock VALUES(1,0);
CREATE TABLE IF NOT EXISTS edit_heads(
 ride TEXT PRIMARY KEY REFERENCES rides(id),
 revision TEXT REFERENCES revisions(id) ON DELETE RESTRICT,
 sequence INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS edit_heads_sequence ON edit_heads(sequence);
CREATE TABLE IF NOT EXISTS edit_safety(
 revision TEXT PRIMARY KEY REFERENCES revisions(id) ON DELETE CASCADE,
 needs_review INTEGER NOT NULL CHECK(needs_review IN (0,1))
);
CREATE TRIGGER IF NOT EXISTS sequence_new_head AFTER INSERT ON edit_heads BEGIN
 UPDATE sync_clock SET value=value+1 WHERE id=1;
 UPDATE edit_heads SET sequence=(SELECT value FROM sync_clock WHERE id=1) WHERE ride=NEW.ride;
END;
CREATE TRIGGER IF NOT EXISTS sequence_changed_head AFTER UPDATE OF revision ON edit_heads BEGIN
 UPDATE sync_clock SET value=value+1 WHERE id=1;
 UPDATE edit_heads SET sequence=(SELECT value FROM sync_clock WHERE id=1) WHERE ride=NEW.ride;
END;
CREATE TRIGGER IF NOT EXISTS sequence_publication AFTER UPDATE OF published ON rides
WHEN OLD.published IS NOT NEW.published BEGIN
 UPDATE sync_clock SET value=value+1 WHERE id=1;
 UPDATE edit_heads SET sequence=(SELECT value FROM sync_clock WHERE id=1) WHERE ride=NEW.id;
END;
INSERT OR IGNORE INTO edit_heads(ride,revision)
 SELECT r.ride,r.id FROM revisions r WHERE r.ready=1 AND NOT EXISTS(
  SELECT 1 FROM revisions n WHERE n.ride=r.ride AND n.ready=1 AND (n.created>r.created OR (n.created=r.created AND n.id>r.id))
 );

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
CREATE TABLE IF NOT EXISTS ownership_mods(id TEXT PRIMARY KEY, revision TEXT NOT NULL, document TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS browser_handoffs(hash TEXT PRIMARY KEY, expires INTEGER NOT NULL, owner TEXT NOT NULL, target TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS browser_sessions(hash TEXT PRIMARY KEY, expires INTEGER NOT NULL, owner TEXT NOT NULL);
