// Database row shapes. Never serialize credential or private session rows to clients.
export type PartyStatus = 'ACTIVE' | 'ENDED';
export type RequestStatus =
  'REQUESTED' | 'APPROVED' | 'QUEUED' | 'PLAYED' | 'REJECTED' | 'REMOVED';
export type QueueOperationStatus =
  'PENDING' | 'IN_FLIGHT' | 'SUCCEEDED' | 'FAILED' | 'UNKNOWN';

export interface SpotifyAccount {
  id: string;
  spotify_user_id: string;
  display_name: string | null;
  created_at: Date;
}
export interface SpotifyCredentials {
  account_id: string;
  access_token_ciphertext: Buffer;
  refresh_token_ciphertext: Buffer;
  encryption_key_id: string;
  expires_at: Date;
  scopes: string[];
  updated_at: Date;
}
export interface Party {
  id: string;
  host_account_id: string;
  name: string;
  status: PartyStatus;
  guest_join_token: string;
  admin_token_hash: string;
  display_token_hash: string;
  backup_playlist_id: string | null;
  created_at: Date;
  ended_at: Date | null;
}
export interface PartySettings {
  party_id: string;
  require_guest_names: boolean;
  voting_enabled: boolean;
  approval_required: boolean;
  max_active_requests_per_guest: number | null;
  allow_explicit_tracks: boolean;
  request_cooldown_seconds: number;
  queue_behavior: 'SPOTIFY_QUEUE' | 'BACKUP_PLAYLIST';
  updated_at: Date;
}
export interface Guest {
  id: string;
  party_id: string;
  session_token_hash: string;
  display_name: string | null;
  created_at: Date;
  last_seen_at: Date;
  expires_at: Date;
}
export interface SongRequest {
  id: string;
  party_id: string;
  requested_by: string;
  spotify_track_id: string;
  track_name: string;
  artist_name: string;
  album_name: string;
  album_art_url: string | null;
  duration_ms: number;
  is_explicit: boolean;
  status: RequestStatus;
  manual_position: number | null;
  created_at: Date;
  updated_at: Date;
}
export interface Vote {
  party_id: string;
  request_id: string;
  guest_id: string;
  created_at: Date;
}
export interface SpotifyQueueOperation {
  request_id: string;
  status: QueueOperationStatus;
  attempt_count: number;
  claimed_at: Date | null;
  completed_at: Date | null;
  created_at: Date;
  updated_at: Date;
}
