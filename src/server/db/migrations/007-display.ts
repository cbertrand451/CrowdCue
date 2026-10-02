export const displaySchema = `
ALTER TABLE party_playback ADD COLUMN display_track jsonb CHECK (display_track IS NULL OR jsonb_typeof(display_track)='object');
ALTER TABLE party_playback ADD COLUMN display_state text NOT NULL DEFAULT 'UNKNOWN' CHECK (display_state IN ('UNKNOWN','PLAYING','PAUSED','IDLE','UNAVAILABLE'));
ALTER TABLE party_playback ADD COLUMN display_progress_ms integer CHECK (display_progress_ms >= 0);
ALTER TABLE party_playback ADD COLUMN display_observed_at timestamptz;

-- Track/state changes notify viewers; progress timestamps are refreshed by fallback reads.
CREATE OR REPLACE FUNCTION notify_party_change() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  row_data jsonb;
  party uuid;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF (to_jsonb(NEW) - ARRAY['updated_at','last_seen_at','last_progress_ms','playlist_synced_at','delivery_seen','display_progress_ms','display_observed_at'])
       IS NOT DISTINCT FROM
       (to_jsonb(OLD) - ARRAY['updated_at','last_seen_at','last_progress_ms','playlist_synced_at','delivery_seen','display_progress_ms','display_observed_at']) THEN
      RETURN NULL;
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN row_data := to_jsonb(OLD);
  ELSE row_data := to_jsonb(NEW); END IF;
  IF TG_TABLE_NAME = 'parties' THEN party := (row_data->>'id')::uuid;
  ELSE party := (row_data->>'party_id')::uuid; END IF;
  PERFORM pg_notify('crowdcue_party_changes', party::text);
  RETURN NULL;
END;
$$;
`;
