export const sessionPlaylistSchema = `
ALTER TABLE party_playback ADD COLUMN playlist_name text;
ALTER TABLE party_playback ADD COLUMN playlist_description text NOT NULL DEFAULT '';
ALTER TABLE party_playback ALTER COLUMN mode SET DEFAULT 'PLAYLIST';
ALTER TABLE party_settings ALTER COLUMN queue_behavior SET DEFAULT 'BACKUP_PLAYLIST';
ALTER TABLE party_settings ALTER COLUMN save_recap_playlist SET DEFAULT true;
DROP INDEX playback_entries_one_locked;
ALTER TABLE playback_entries ADD COLUMN manual_position integer;
ALTER TABLE playback_entries ADD COLUMN legacy_committed_at timestamptz;
UPDATE party_playback SET mode='PLAYLIST',save_at_creation=true,save_at_close=true,close_decided=true;
UPDATE party_settings SET queue_behavior='BACKUP_PLAYLIST',save_recap_playlist=true;
UPDATE playback_entries SET status='WAITING',legacy_committed_at=locked_at,locked_at=NULL,delivery='PENDING' WHERE id IN (
 SELECT id FROM (SELECT e.id,row_number() OVER (PARTITION BY party_id ORDER BY locked_at,sequence) AS n,
 EXISTS(SELECT 1 FROM playback_entries x WHERE x.party_id=e.party_id AND x.status='PLAYING') AS playing
 FROM playback_entries e WHERE status IN ('WAITING','LOCKED') AND locked_at IS NOT NULL) ranked
 WHERE n > CASE WHEN playing THEN 1 ELSE 2 END
);
UPDATE song_requests r SET status='APPROVED' FROM playback_entries e WHERE e.request_id=r.id AND e.status='WAITING' AND e.locked_at IS NULL AND r.status='QUEUED';
`;
