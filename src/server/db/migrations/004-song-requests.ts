export const songRequestsSchema = `
CREATE TABLE song_request_attempts (
  party_id uuid NOT NULL,
  guest_id uuid NOT NULL,
  idempotency_key uuid NOT NULL,
  spotify_track_id text NOT NULL CHECK (spotify_track_id ~ '^[A-Za-z0-9]{22}$'),
  request_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (guest_id, idempotency_key),
  FOREIGN KEY (party_id, guest_id) REFERENCES guests(party_id, id) ON DELETE CASCADE,
  FOREIGN KEY (party_id, request_id) REFERENCES song_requests(party_id, id) ON DELETE CASCADE
);
CREATE INDEX song_requests_cooldown_idx ON song_requests(party_id, requested_by, created_at DESC);
`;
