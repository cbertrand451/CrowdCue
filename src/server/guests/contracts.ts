import { z } from 'zod';
export const guestNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .refine((value) =>
    Array.from(value).every(
      (character) =>
        character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127,
    ),
  );
export const guestInputSchema = z
  .object({ displayName: guestNameSchema.nullable().optional() })
  .strict();
export const guestSessionSchema = z.object({
  id: z.uuid(),
  displayName: z.string().nullable(),
  expiresAt: z.string(),
});
export type GuestSession = z.infer<typeof guestSessionSchema>;
export class GuestError extends Error {
  constructor(
    public readonly statusCode: 400 | 404 | 409,
    message: string,
  ) {
    super(message);
  }
}
