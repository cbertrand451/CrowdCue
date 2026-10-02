import { z } from 'zod';
import { songRequestSchema } from '../requests/contracts.js';
export const queueSnapshotSchema = z.object({
  items: z.array(
    z.object({
      position: z.number().int().positive(),
      source: z.enum(['GUEST', 'BACKUP']).default('GUEST'),
      locked: z.boolean().default(false),
      delivery: z
        .enum(['PENDING', 'SENDING', 'SENT', 'UNKNOWN'])
        .default('PENDING'),
      request: songRequestSchema,
    }),
  ),
  nextOffset: z.number().int().nullable(),
  votingEnabled: z.boolean(),
  status: z.enum(['ACTIVE', 'ENDED']),
});
export type QueueSnapshot = z.infer<typeof queueSnapshotSchema>;
