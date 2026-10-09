import { z } from 'zod';
import { trackSchema } from '../search/contracts.js';

export const displaySnapshotSchema = z.object({
  party: z.object({
    name: z.string(),
    status: z.enum(['ACTIVE', 'ENDED']),
    guestUrl: z.string().url(),
  }),
  nowPlaying: z.object({
    locked: z.boolean().optional(),
    source: z.enum(['GUEST', 'BACKUP']).nullable().default(null),
    requestedBy: z.string().nullable().default(null),
    state: z.enum(['UNKNOWN', 'PLAYING', 'PAUSED', 'IDLE', 'UNAVAILABLE']),
    track: trackSchema.nullable(),
    progressMs: z.number().int().nonnegative().nullable(),
    observedAt: z.string().datetime().nullable(),
  }),
  queue: z
    .array(
      z.object({
        position: z.number().int().positive(),
        track: trackSchema,
        source: z.enum(['GUEST', 'BACKUP']),
        requestedBy: z.string().nullable().default(null),
        locked: z.boolean(),
        voteCount: z.number().int().nonnegative(),
      }),
    )
    .max(6),
  hasMore: z.boolean(),
  votingEnabled: z.boolean(),
  pendingCount: z.number().int().nonnegative(),
});
export type DisplaySnapshot = z.infer<typeof displaySnapshotSchema>;
