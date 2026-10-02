export const partyCreationSchema = `
-- Keep previously created parties, supplying any missing default settings.
INSERT INTO party_settings (party_id)
  SELECT id FROM parties ON CONFLICT (party_id) DO NOTHING;

CREATE TABLE party_link_secrets (
  party_id uuid PRIMARY KEY REFERENCES parties(id) ON DELETE CASCADE,
  tokens_ciphertext bytea NOT NULL CHECK (octet_length(tokens_ciphertext) > 0),
  encryption_key_id text NOT NULL CHECK (length(encryption_key_id) > 0)
);

ALTER TABLE parties ADD CONSTRAINT parties_host_id_unique UNIQUE (host_account_id, id);
CREATE TABLE party_creation_requests (
  host_account_id uuid NOT NULL,
  idempotency_key uuid NOT NULL,
  payload_hash text NOT NULL CHECK (payload_hash ~ '^[0-9a-f]{64}$'),
  party_id uuid NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (host_account_id, idempotency_key),
  FOREIGN KEY (host_account_id, party_id) REFERENCES parties(host_account_id, id) ON DELETE CASCADE
);
`;
