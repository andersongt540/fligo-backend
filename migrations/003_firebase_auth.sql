ALTER TABLE usuarios
  ADD COLUMN IF NOT EXISTS firebase_uid VARCHAR(128);

CREATE UNIQUE INDEX IF NOT EXISTS usuarios_firebase_uid_unique
  ON usuarios (firebase_uid)
  WHERE firebase_uid IS NOT NULL;
