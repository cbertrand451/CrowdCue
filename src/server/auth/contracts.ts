import { z } from 'zod';
export const authorizationStartSchema = z.object({
  authorizationUrl: z
    .string()
    .url()
    .refine((value) => {
      const url = new URL(value);
      return (
        url.origin === 'https://accounts.spotify.com' &&
        url.pathname === '/authorize' &&
        !url.username &&
        !url.password &&
        !url.hash
      );
    }),
});
