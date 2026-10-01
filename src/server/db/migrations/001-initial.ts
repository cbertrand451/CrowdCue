export const initialSchema = `
CREATE TABLE spotify_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  spotify_user_id text NOT NULL UNIQUE CHECK (length(spotify_user_id) > 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Only authenticated ciphertext envelopes belong here, never raw OAuth tokens.
CREATE TABLE spotify_credentials (
  account_id uuid PRIMARY KEY REFERENCES spotify_accounts(id) ON DELETE CASCADE,
  access_token_ciphertext bytea NOT NULL CHECK (octet_length(access_token_ciphertext) > 0),
  refresh_token_ciphertext bytea NOT NULL CHECK (octet_length(refresh_token_ciphertext) > 0),
  encryption_key_id text NOT NULL CHECK (length(encryption_key_id) > 0),
  expires_at timestamptz NOT NULL,
  scopes text[] NOT NULL DEFAULT '{}',
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE parties (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  host_account_id uuid NOT NULL REFERENCES spotify_accounts(id) ON DELETE RESTRICT,
  name text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 120),
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'ENDED')),
  guest_join_token text NOT NULL UNIQUE CHECK (length(guest_join_token) >= 32),
  admin_token_hash text NOT NULL UNIQUE CHECK (admin_token_hash ~ '^[0-9a-f]{64}$'),
  display_token_hash text NOT NULL UNIQUE CHECK (display_token_hash ~ '^[0-9a-f]{64}$'),
  backup_playlist_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  CHECK (admin_token_hash <> display_token_hash),
  CHECK ((status = 'ACTIVE' AND ended_at IS NULL) OR (status = 'ENDED' AND ended_at IS NOT NULL AND ended_at >= created_at))
);
CREATE INDEX parties_host_status_idx ON parties(host_account_id, status);

CREATE TABLE party_settings (
  party_id uuid PRIMARY KEY REFERENCES parties(id) ON DELETE CASCADE,
  require_guest_names boolean NOT NULL DEFAULT false,
  voting_enabled boolean NOT NULL DEFAULT true,
  approval_required boolean NOT NULL DEFAULT false,
  max_active_requests_per_guest integer CHECK (max_active_requests_per_guest > 0),
  allow_explicit_tracks boolean NOT NULL DEFAULT true,
  request_cooldown_seconds integer NOT NULL DEFAULT 0 CHECK (request_cooldown_seconds >= 0),
  queue_behavior text NOT NULL DEFAULT 'SPOTIFY_QUEUE' CHECK (queue_behavior IN ('SPOTIFY_QUEUE', 'BACKUP_PLAYLIST')),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE guests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  party_id uuid NOT NULL REFERENCES parties(id) ON DELETE CASCADE,
  session_token_hash text NOT NULL UNIQUE CHECK (session_token_hash ~ '^[0-9a-f]{64}$'),
  display_name text CHECK (length(trim(display_name)) BETWEEN 1 AND 80),
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL CHECK (expires_at > created_at),
  UNIQUE (party_id, id)
);

CREATE TABLE song_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  party_id uuid NOT NULL REFERENCES parties(id) ON DELETE CASCADE,
  requested_by uuid NOT NULL,
  spotify_track_id text NOT NULL CHECK (spotify_track_id ~ '^[A-Za-z0-9]{22}$'),
  track_name text NOT NULL CHECK (length(trim(track_name)) > 0),
  artist_name text NOT NULL CHECK (length(trim(artist_name)) > 0),
  album_name text NOT NULL,
  album_art_url text,
  duration_ms integer NOT NULL CHECK (duration_ms > 0),
  is_explicit boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'REQUESTED' CHECK (status IN ('REQUESTED', 'APPROVED', 'QUEUED', 'PLAYED', 'REJECTED', 'REMOVED')),
  manual_position integer CHECK (manual_position >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (party_id, id),
  FOREIGN KEY (party_id, requested_by) REFERENCES guests(party_id, id) ON DELETE NO ACTION
);
CREATE UNIQUE INDEX song_requests_active_track_idx ON song_requests(party_id, spotify_track_id)
  WHERE status IN ('REQUESTED', 'APPROVED', 'QUEUED');
CREATE INDEX song_requests_queue_idx ON song_requests(party_id, status, created_at, id);
CREATE INDEX song_requests_guest_idx ON song_requests(party_id, requested_by, status);

CREATE TABLE votes (
  party_id uuid NOT NULL REFERENCES parties(id) ON DELETE CASCADE,
  request_id uuid NOT NULL,
  guest_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (request_id, guest_id),
  FOREIGN KEY (party_id, request_id) REFERENCES song_requests(party_id, id) ON DELETE CASCADE,
  FOREIGN KEY (party_id, guest_id) REFERENCES guests(party_id, id) ON DELETE CASCADE
);
CREATE INDEX votes_guest_idx ON votes(party_id, guest_id);

-- A durable coordination record; an uncertain API outcome must not be blindly retried.
CREATE TABLE spotify_queue_operations (
  request_id uuid PRIMARY KEY REFERENCES song_requests(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'IN_FLIGHT', 'SUCCEEDED', 'FAILED', 'UNKNOWN')),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  claimed_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX spotify_queue_operations_pending_idx ON spotify_queue_operations(created_at, request_id)
  WHERE status = 'PENDING';
`;
