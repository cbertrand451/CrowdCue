import { z } from 'zod';
const count = z.number().int().nonnegative();
export const partyStatisticsSchema = z.object({
  status: z.enum(['ACTIVE', 'ENDED']),
  durationSeconds: count,
  guestSessions: count,
  requests: z.object({
    total: count,
    pending: count,
    approved: count,
    queued: count,
    played: count,
    rejected: count,
    removed: count,
  }),
  votes: count,
  voters: count,
  committed: z.object({
    total: count,
    guest: count,
    backup: count,
    observed: count,
  }),
  topSongs: z
    .array(
      z.object({
        spotifyTrackId: z.string().regex(/^[A-Za-z0-9]{22}$/),
        title: z.string(),
        artist: z.string(),
        votes: count,
      }),
    )
    .max(5),
});
export type PartyStatistics = z.infer<typeof partyStatisticsSchema>;
