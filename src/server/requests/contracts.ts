import { z } from 'zod';
import { trackSchema } from '../search/contracts.js';
export const requestInputSchema = z
  .object({
    trackId: z.string().regex(/^[A-Za-z0-9]{22}$/),
    confirmPlayedRepeat: z.boolean().default(false),
  })
  .strict();
export const songRequestSchema = z.object({
  id: z.uuid(),
  track: trackSchema,
  status: z.enum([
    'REQUESTED',
    'APPROVED',
    'QUEUED',
    'PLAYED',
    'REJECTED',
    'REMOVED',
  ]),
  requestedBy: z.string().nullable(),
  isOwn: z.boolean(),
  voteCount: z.number().int().nonnegative().default(0),
  hasVoted: z.boolean().default(false),
  locked: z.boolean().default(false),
  createdAt: z.string(),
});
export const requestResultSchema = z.object({
  request: songRequestSchema,
  created: z.boolean(),
});
export const playedRepeatConfirmationSchema = z.object({
  confirmationRequired: z.literal(true),
  message: z.literal('Song already played...proceed?'),
});
export const requestResponseSchema = z.union([
  requestResultSchema,
  playedRepeatConfirmationSchema,
]);
export const requestListSchema = z.object({
  requests: z.array(songRequestSchema),
  nextOffset: z.number().int().nullable(),
});
export type SongRequest = z.infer<typeof songRequestSchema>;
export class RequestError extends Error {
  constructor(
    public readonly statusCode: 400 | 401 | 404 | 409 | 429,
    message: string,
    public readonly retryAfter?: number,
  ) {
    super(message);
  }
}
