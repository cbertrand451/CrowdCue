export const eventHistorySchema = `
ALTER TABLE playback_entries ADD COLUMN observed_at timestamptz;
CREATE INDEX playback_entries_history ON playback_entries(party_id,locked_at,sequence) WHERE locked_at IS NOT NULL;
`;
