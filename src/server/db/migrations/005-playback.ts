export const playbackSchema = `
ALTER TABLE party_settings ADD COLUMN backup_source_id text CHECK (backup_source_id ~ '^[A-Za-z0-9]{22}$');
ALTER TABLE party_settings ADD COLUMN save_recap_playlist boolean NOT NULL DEFAULT false;
CREATE TABLE party_playback (
  party_id uuid PRIMARY KEY,
  host_account_id uuid NOT NULL,
  FOREIGN KEY (host_account_id,party_id) REFERENCES parties(host_account_id,id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT false,
  mode text NOT NULL DEFAULT 'QUEUE' CHECK (mode IN ('QUEUE','PLAYLIST')),
  initialized boolean NOT NULL DEFAULT false,
  playlist_id text CHECK (playlist_id ~ '^[A-Za-z0-9]{22}$'),
  playlist_creation text NOT NULL DEFAULT 'NEW' CHECK (playlist_creation IN ('NEW','CREATING','UNKNOWN','READY')),
  playlist_removed boolean NOT NULL DEFAULT false,
  save_at_creation boolean NOT NULL DEFAULT false,
  save_at_close boolean,
  close_decided boolean NOT NULL DEFAULT false,
  backup_tracks jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(backup_tracks)='array'),
  playlist_digest text,
  completed boolean NOT NULL DEFAULT false,
  last_track_id text,
  last_progress_ms integer,
  source_cursor integer NOT NULL DEFAULT 0 CHECK (source_cursor >= 0),
  error_code text CHECK (error_code IN ('reauthenticate','permissions','rate_limited','unavailable','no_active_device','queue_unknown','creation_unknown','backup_empty','backup_required','too_many_tracks')),
  retry_at timestamptz,
  playlist_synced_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((playlist_creation = 'READY') = (playlist_id IS NOT NULL))
);
CREATE UNIQUE INDEX party_playback_one_host_active ON party_playback(host_account_id) WHERE enabled;
INSERT INTO party_playback (party_id,host_account_id) SELECT id,host_account_id FROM parties;
CREATE TABLE playback_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  party_id uuid NOT NULL REFERENCES parties(id) ON DELETE CASCADE,
  request_id uuid,
  FOREIGN KEY (party_id,request_id) REFERENCES song_requests(party_id,id) ON DELETE CASCADE,
  source text NOT NULL CHECK (source IN ('GUEST','BACKUP')),
  track jsonb NOT NULL CHECK (jsonb_typeof(track) = 'object'),
  sequence bigint GENERATED ALWAYS AS IDENTITY,
  status text NOT NULL DEFAULT 'WAITING' CHECK (status IN ('WAITING','LOCKED','PLAYING','PLAYED','REMOVED')),
  locked_at timestamptz,
  delivery_seen boolean NOT NULL DEFAULT false,
  delivery text NOT NULL DEFAULT 'PENDING' CHECK (delivery IN ('PENDING','SENDING','SENT','UNKNOWN')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (request_id),
  CHECK ((source = 'GUEST') = (request_id IS NOT NULL)),
  CHECK (status NOT IN ('LOCKED','PLAYING','PLAYED') OR locked_at IS NOT NULL)
);
CREATE UNIQUE INDEX playback_entries_one_locked ON playback_entries(party_id) WHERE status = 'LOCKED';
CREATE UNIQUE INDEX playback_entries_one_playing ON playback_entries(party_id) WHERE status = 'PLAYING';
CREATE INDEX playback_entries_party_order ON playback_entries(party_id,sequence);
`;
