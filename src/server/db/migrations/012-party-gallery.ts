export const partyGallerySchema = `
ALTER TABLE parties ADD COLUMN archive_hidden_at timestamptz;
CREATE INDEX parties_archive_owner ON parties(host_account_id,created_at DESC,id DESC)
 WHERE status='ENDED' AND archive_hidden_at IS NULL;
CREATE TABLE party_covers (
 party_id uuid PRIMARY KEY REFERENCES parties(id) ON DELETE CASCADE,
 image bytea NOT NULL CHECK(octet_length(image)<=196608),
 revision integer NOT NULL DEFAULT 1,
 synced_revision integer NOT NULL DEFAULT 0,
 synced_playlist_id text,
 error_code text,
 retry_at timestamptz
);
`;
