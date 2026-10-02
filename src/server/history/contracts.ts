import { z } from 'zod';
import { trackSchema } from '../search/contracts.js';

export const eventHistorySchema = z.object({
  items: z
    .array(
      z.object({
        id: z.uuid(),
        position: z.number().int().positive(),
        track: trackSchema,
        source: z.enum(['GUEST', 'BACKUP']),
        requestedBy: z.string().nullable(),
        committedAt: z.string().datetime(),
        observedAt: z.string().datetime().nullable(),
        delivery: z.enum(['PENDING', 'SENDING', 'SENT', 'UNKNOWN']),
      }),
    )
    .max(50),
  committedCount: z.number().int().nonnegative(),
  observedCount: z.number().int().nonnegative(),
  nextOffset: z.number().int().nullable(),
  status: z.enum(['ACTIVE', 'ENDED']),
});
export type EventHistory = z.infer<typeof eventHistorySchema>;
