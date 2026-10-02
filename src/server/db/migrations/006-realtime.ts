export const realtimeSchema = `
-- NOTIFY is delivered only on commit; identical party notifications in one transaction coalesce.
CREATE FUNCTION notify_party_change() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  row_data jsonb;
  party uuid;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF (to_jsonb(NEW) - ARRAY['updated_at','last_seen_at','last_progress_ms','playlist_synced_at','delivery_seen'])
       IS NOT DISTINCT FROM
       (to_jsonb(OLD) - ARRAY['updated_at','last_seen_at','last_progress_ms','playlist_synced_at','delivery_seen']) THEN
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
CREATE TRIGGER parties_realtime AFTER INSERT OR UPDATE OR DELETE ON parties FOR EACH ROW EXECUTE FUNCTION notify_party_change();
CREATE TRIGGER settings_realtime AFTER INSERT OR UPDATE OR DELETE ON party_settings FOR EACH ROW EXECUTE FUNCTION notify_party_change();
CREATE TRIGGER guests_realtime AFTER INSERT OR UPDATE OR DELETE ON guests FOR EACH ROW EXECUTE FUNCTION notify_party_change();
CREATE TRIGGER requests_realtime AFTER INSERT OR UPDATE OR DELETE ON song_requests FOR EACH ROW EXECUTE FUNCTION notify_party_change();
CREATE TRIGGER votes_realtime AFTER INSERT OR UPDATE OR DELETE ON votes FOR EACH ROW EXECUTE FUNCTION notify_party_change();
CREATE TRIGGER playback_realtime AFTER INSERT OR UPDATE OR DELETE ON party_playback FOR EACH ROW EXECUTE FUNCTION notify_party_change();
CREATE TRIGGER entries_realtime AFTER INSERT OR UPDATE OR DELETE ON playback_entries FOR EACH ROW EXECUTE FUNCTION notify_party_change();
`;
