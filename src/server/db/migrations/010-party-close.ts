export const partyCloseSchema = `
ALTER TABLE parties ADD COLUMN closed_at timestamptz;
CREATE INDEX parties_visible_host ON parties(host_account_id,created_at DESC,id DESC) WHERE closed_at IS NULL;
`;
