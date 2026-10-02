import { z } from 'zod';
const count = z.number().int().nonnegative();
const entry = z.object({
  rank: z.number().int().positive(),
  name: z.string(),
  points: count,
  songsObserved: count,
  votesReceived: count,
  isYou: z.boolean(),
});
export const leaderboardSchema = z.object({
  status: z.enum(['ACTIVE', 'ENDED']),
  entries: z.array(entry).max(50),
  yourEntry: entry.nullable(),
  participants: count,
});
export type Leaderboard = z.infer<typeof leaderboardSchema>;
