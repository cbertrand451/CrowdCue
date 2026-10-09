export const playlistCreditSchema = `
ALTER TABLE party_playback ADD COLUMN playlist_creation_baseline text[];
ALTER TABLE party_playback ADD COLUMN playlist_credit_updated boolean NOT NULL DEFAULT false;
`;
