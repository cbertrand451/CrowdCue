import type { Pool } from 'pg';
import { hashToken } from '../auth/crypto.js';
import { inTransaction } from '../db/index.js';
import { upcoming } from '../playback/ordering.js';
import { queueOrder } from '../queue/ordering.js';
import { trackSchema } from '../search/contracts.js';
import { displaySnapshotSchema, type DisplaySnapshot } from './contracts.js';
export class DisplayError extends Error {
  constructor() {
    super('Party not found.');
  }
}
export class PostgresDisplayStore {
  constructor(
    private readonly pool: Pool,
    private readonly appOrigin: string,
  ) {}
  async snapshot(token: string): Promise<DisplaySnapshot> {
    return inTransaction(this.pool, async (client) => {
      const party = (
        await client.query<{
          id: string;
          name: string;
          status: 'ACTIVE' | 'ENDED';
          guest_join_token: string;
        }>(
          'SELECT id,name,status,guest_join_token FROM parties WHERE display_token_hash=$1 FOR SHARE',
          [hashToken(token)],
        )
      ).rows[0];
      if (!party) throw new DisplayError();
      const state = (
        await client.query<{
          initialized: boolean;
          voting_enabled: boolean;
          display_state: DisplaySnapshot['nowPlaying']['state'];
          display_track: unknown;
          display_progress_ms: number | null;
          display_observed_at: Date | null;
        }>(
          'SELECT b.initialized,b.display_state,b.display_track,b.display_progress_ms,b.display_observed_at,s.voting_enabled FROM party_playback b JOIN party_settings s ON s.party_id=b.party_id WHERE b.party_id=$1',
          [party.id],
        )
      ).rows[0];
      let queue: DisplaySnapshot['queue'];
      let hasMore: boolean;
      if (state.initialized) {
        const entries = await upcoming(client, party.id, state.voting_enabled);
        queue = entries.slice(0, 6).map((e, i) => ({
          position: i + 1,
          track: trackSchema.parse(e.track),
          source: e.source,
          locked: e.locked_at !== null,
          voteCount: e.vote_count,
        }));
        hasMore = entries.length > 6;
      } else {
        const rows = (
          await client.query<{
            spotify_track_id: string;
            track_name: string;
            artist_name: string;
            album_name: string;
            album_art_url: string | null;
            duration_ms: number;
            is_explicit: boolean;
            vote_count: number;
          }>(
            `SELECT r.*, (SELECT count(*)::int FROM votes v WHERE v.request_id=r.id) AS vote_count FROM song_requests r WHERE r.party_id=$1 AND r.status='APPROVED' ORDER BY ${queueOrder(state.voting_enabled)} LIMIT 7`,
            [party.id],
          )
        ).rows;
        queue = rows.slice(0, 6).map((r, i) => ({
          position: i + 1,
          source: 'GUEST',
          locked: false,
          voteCount: r.vote_count,
          track: {
            id: r.spotify_track_id,
            title: r.track_name,
            artists: [r.artist_name],
            album: r.album_name,
            artworkUrl: r.album_art_url,
            durationMs: r.duration_ms,
            explicit: r.is_explicit,
            spotifyUrl: `https://open.spotify.com/track/${r.spotify_track_id}`,
          },
        }));
        hasMore = rows.length > 6;
      }
      const pendingCount = (
        await client.query<{ count: number }>(
          "SELECT count(*)::int AS count FROM song_requests WHERE party_id=$1 AND status='REQUESTED'",
          [party.id],
        )
      ).rows[0].count;
      const playing = (
        await client.query<{ track: { id: string } }>(
          "SELECT track FROM playback_entries WHERE party_id=$1 AND status='PLAYING'",
          [party.id],
        )
      ).rows[0];
      const parsedTrack = trackSchema.safeParse(state.display_track);
      return displaySnapshotSchema.parse({
        party: {
          name: party.name,
          status: party.status,
          guestUrl: `${this.appOrigin}/join/${party.guest_join_token}`,
        },
        nowPlaying:
          party.status === 'ENDED'
            ? {
                state: 'UNKNOWN',
                track: null,
                progressMs: null,
                observedAt: null,
              }
            : {
                locked:
                  !!playing &&
                  parsedTrack.success &&
                  playing.track.id === parsedTrack.data.id,
                state: state.display_state,
                track: state.display_track,
                progressMs: state.display_progress_ms,
                observedAt: state.display_observed_at?.toISOString() ?? null,
              },
        queue,
        hasMore,
        votingEnabled: state.voting_enabled,
        pendingCount,
      });
    });
  }
}
