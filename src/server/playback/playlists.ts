import { createHash } from 'node:crypto';
import type { PoolClient } from 'pg';
import { SpotifyMutationError } from '../spotify/playback.js';
import { recapMarker, sessionPlaylistDescription } from './contracts.js';
import type { Session } from './store.js';
import type { PlaybackProvider } from './service.js';
import { upcoming } from './ordering.js';

export class NightlyPlaylists {
  constructor(private readonly spotify: PlaybackProvider) {}
  async ensure(client: PoolClient, s: Session) {
    const description = sessionPlaylistDescription(s.playlist_description);
    const name = (s.playlist_name ?? s.name).slice(0, 100);
    if (s.playlist_id) {
      if (!s.playlist_credit_updated) {
        await this.spotify.updatePlaylistDescription(
          s.host_account_id,
          s.playlist_id,
          description,
        );
        await client.query(
          'UPDATE party_playback SET playlist_credit_updated=true WHERE party_id=$1',
          [s.party_id],
        );
      }
      return s.playlist_id;
    }
    if (
      s.playlist_creation === 'CREATING' ||
      s.playlist_creation === 'UNKNOWN'
    ) {
      const legacy = s.playlist_creation_baseline === null;
      const legacyDescription = `${s.playlist_description ? s.playlist_description + '\n' : ''}${recapMarker(s.party_id)}`;
      const id = legacy
        ? await this.spotify.findPlaylist(s.host_account_id, legacyDescription)
        : await this.spotify.findPlaylist(
            s.host_account_id,
            description,
            name,
            s.playlist_creation_baseline!,
          );
      if (!id) {
        await client.query(
          "UPDATE party_playback SET playlist_creation='UNKNOWN',error_code='creation_unknown',retry_at=now()+interval '30 seconds' WHERE party_id=$1",
          [s.party_id],
        );
        return null;
      }
      await client.query(
        "UPDATE party_playback SET playlist_id=$2,playlist_creation='READY',playlist_credit_updated=$3,error_code=null WHERE party_id=$1",
        [s.party_id, id, !legacy],
      );
      return id;
    }
    // Persist matching existing IDs before the non-idempotent create call.
    // This distinguishes a new session from older playlists with the same credit.
    const baseline = await this.spotify.matchingPlaylistIds(
      s.host_account_id,
      description,
      name,
    );
    await client.query(
      "UPDATE party_playback SET playlist_creation='CREATING',playlist_creation_baseline=$2 WHERE party_id=$1",
      [s.party_id, baseline],
    );
    let created = false;
    try {
      const id = await this.spotify.createPlaylist(
        s.host_account_id,
        name,
        description,
      );
      created = true;
      await client.query(
        "UPDATE party_playback SET playlist_id=$2,playlist_creation='READY',playlist_credit_updated=true WHERE party_id=$1",
        [s.party_id, id],
      );
      return id;
    } catch (error) {
      const uncertain =
        error instanceof SpotifyMutationError && error.uncertain;
      if (created) throw error;
      await client.query(
        'UPDATE party_playback SET playlist_creation=$2 WHERE party_id=$1',
        [s.party_id, uncertain ? 'UNKNOWN' : 'NEW'],
      );
      throw error;
    }
  }
  async sync(client: PoolClient, s: Session, id: string) {
    if (s.playlist_id && s.playlist_id !== id)
      throw new Error('Unmanaged playlist');
    const committed = (
      await client.query<{ track: { id: string } }>(
        "SELECT track FROM playback_entries WHERE party_id=$1 AND status IN ('PLAYED','PLAYING') ORDER BY locked_at,sequence",
        [s.party_id],
      )
    ).rows.map((x) => `spotify:track:${x.track.id}`);
    committed.push(
      ...(await upcoming(client, s.party_id, s.voting_enabled)).map(
        (e) => `spotify:track:${e.track.id}`,
      ),
    );
    if (committed.length > 10000) {
      await client.query(
        "UPDATE party_playback SET error_code='too_many_tracks' WHERE party_id=$1",
        [s.party_id],
      );
      return false;
    }
    const digest = createHash('sha256')
      .update(JSON.stringify(committed))
      .digest('hex');
    // Verify provider contents on every pass: a cached digest cannot prove
    // Spotify still has the two songs after the current occurrence.
    const actual = await this.spotify.playlistUris(s.host_account_id, id);
    // Reconcile by occurrence, preserving the already matching history/current/next
    // prefix. Never replace the whole playlist while it is being played.
    for (let i = 0; i < committed.length; i++) {
      if (actual[i] === committed[i]) continue;
      const later = actual.indexOf(committed[i], i + 1);
      if (later !== -1) {
        await this.spotify.moveItem(s.host_account_id, id, later, i);
        actual.splice(i, 0, actual.splice(later, 1)[0]);
      } else {
        const additions = [committed[i]];
        while (
          additions.length < 100 &&
          i + additions.length < committed.length &&
          !actual.includes(committed[i + additions.length], i)
        )
          additions.push(committed[i + additions.length]);
        await this.spotify.writeItems(
          s.host_account_id,
          id,
          additions,
          false,
          i,
        );
        actual.splice(i, 0, ...additions);
        i += additions.length - 1;
      }
    }
    while (actual.length > committed.length) {
      const offset = Math.max(committed.length, actual.length - 100);
      await this.spotify.removeItems(
        s.host_account_id,
        id,
        actual
          .slice(offset)
          .map((uri, index) => ({ uri, positions: [offset + index] })),
      );
      actual.splice(offset);
    }
    await client.query(
      "UPDATE playback_entries SET delivery='SENT' WHERE party_id=$1 AND status IN ('WAITING','LOCKED','PLAYING') AND delivery!='SENT'",
      [s.party_id],
    );
    await client.query(
      'UPDATE party_playback SET playlist_synced_at=now(),playlist_digest=$2 WHERE party_id=$1',
      [s.party_id, digest],
    );
    return true;
  }
}
