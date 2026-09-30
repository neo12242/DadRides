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
