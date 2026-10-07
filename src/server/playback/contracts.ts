import { z } from 'zod';
export const playbackStatusSchema = z.object({
  enabled: z.boolean(),
  mode: z.enum(['QUEUE', 'PLAYLIST']),
  playlistUrl: z.string().url().nullable(),
  playlistRemoved: z.boolean(),
  creation: z.enum(['NEW', 'CREATING', 'UNKNOWN', 'READY']),
  error: z
    .enum([
      'reauthenticate',
      'permissions',
      'rate_limited',
      'unavailable',
      'no_active_device',
      'queue_unknown',
      'creation_unknown',
      'backup_empty',
      'backup_required',
      'too_many_tracks',
    ])
    .nullable(),
  retryAt: z.string().nullable(),
  syncedAt: z.string().nullable(),
  lockedCount: z.number().int().nonnegative(),
  guestCount: z.number().int().nonnegative(),
  backupCount: z.number().int().nonnegative(),
  backupSourceUrl: z.string().url().nullable().default(null),
  backupTrackCount: z.number().int().nonnegative().default(0),
  saveAtCreation: z.boolean(),
  saveAtClose: z.boolean().nullable(),
  closeDecided: z.boolean(),
  ended: z.boolean(),
});
export type PlaybackStatus = z.infer<typeof playbackStatusSchema>;
export const recapMarker = (id: string) =>
  `CrowdCue session ${id}. Managed party playlist.`;
export const playbackActionSchema = z.discriminatedUnion('action', [
  z
    .object({
      action: z.literal('start'),
      name: z.string().trim().min(1).max(100).optional(),
      description: z.string().trim().max(200).optional(),
    })
    .strict(),
  z.object({ action: z.literal('retry') }).strict(),
  z.object({ action: z.literal('refresh-backup') }).strict(),
  z
    .object({ action: z.literal('recreate'), confirm: z.literal(true) })
    .strict(),
]);

export function playlistIdFromInput(value: string): string | null | undefined {
  const input = value.trim();
  if (!input) return null;
  if (/^[A-Za-z0-9]{22}$/.test(input)) return input;
  if (/^spotify:playlist:[A-Za-z0-9]{22}$/.test(input)) return input.slice(17);
  try {
    const url = new URL(input);
    if (
      url.protocol !== 'https:' ||
      url.hostname !== 'open.spotify.com' ||
      url.username ||
      url.password
    )
      return undefined;
    return url.pathname.match(
      /^\/(?:intl-[a-z]{2}\/)?playlist\/([A-Za-z0-9]{22})\/?$/,
    )?.[1];
  } catch {
    return undefined;
  }
}
