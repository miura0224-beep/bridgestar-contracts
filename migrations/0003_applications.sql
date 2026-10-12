CREATE TABLE applications(id TEXT PRIMARY KEY, party_name TEXT NOT NULL, party_email TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE, status TEXT NOT NULL DEFAULT 'requested' CHECK(status IN ('requested','submitted','converted','revoked')), payload TEXT, created_by TEXT NOT NULL, created_at TEXT NOT NULL, expires_at TEXT NOT NULL, submitted_at TEXT, contract_id TEXT);
ALTER TABLE sessions ADD COLUMN application_id TEXT;
ALTER TABLE contracts ADD COLUMN application_id TEXT REFERENCES applications(id);
CREATE UNIQUE INDEX contract_application_unique ON contracts(application_id) WHERE application_id IS NOT NULL;
CREATE TRIGGER application_conversion_guard BEFORE INSERT ON contracts WHEN NEW.application_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM applications WHERE id=NEW.application_id AND status='submitted') BEGIN SELECT RAISE(ABORT,'application unavailable'); END;
