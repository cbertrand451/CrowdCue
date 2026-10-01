export const spotifyAuthSchema = `
ALTER TABLE spotify_accounts ADD COLUMN display_name text;

CREATE TABLE spotify_oauth_attempts (
  state_hash text PRIMARY KEY CHECK (state_hash ~ '^[0-9a-f]{64}$'),
  browser_token_hash text NOT NULL CHECK (browser_token_hash ~ '^[0-9a-f]{64}$'),
  verifier_ciphertext bytea NOT NULL,
  encryption_key_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL CHECK (expires_at > created_at)
);
CREATE INDEX spotify_oauth_attempts_expiry_idx ON spotify_oauth_attempts(expires_at);

CREATE TABLE host_sessions (
  token_hash text PRIMARY KEY CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  account_id uuid NOT NULL REFERENCES spotify_accounts(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL CHECK (expires_at > created_at)
);
CREATE INDEX host_sessions_account_idx ON host_sessions(account_id);
CREATE INDEX host_sessions_expiry_idx ON host_sessions(expires_at);
`;
