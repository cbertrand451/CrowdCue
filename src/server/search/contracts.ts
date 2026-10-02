import { isSpotifyArtworkUrl } from '../security/urls.js';
import { z } from 'zod';
export const searchQuerySchema = z
  .object({
    q: z
      .string()
      .trim()
      .min(2)
      .max(200)
      .refine((value) =>
        Array.from(value).every(
          (c) => c.charCodeAt(0) >= 32 && c.charCodeAt(0) !== 127,
        ),
      ),
    offset: z.coerce.number().int().min(0).max(990).default(0),
  })
  .strict();
export const trackSchema = z
  .object({
    id: z.string().regex(/^[A-Za-z0-9]{22}$/),
    title: z.string(),
    artists: z.array(z.string()),
    album: z.string(),
    artworkUrl: z
      .string()
      .nullable()
      .transform((value) =>
        value && isSpotifyArtworkUrl(value) ? value : null,
      ),
    durationMs: z.number().int().nonnegative(),
    explicit: z.boolean(),
    spotifyUrl: z.string().url(),
  })
  .refine(
    (track) =>
      track.spotifyUrl === `https://open.spotify.com/track/${track.id}`,
    { message: 'Use the canonical Spotify track link.' },
  );
export const searchResultSchema = z.object({
  tracks: z.array(trackSchema),
  nextOffset: z.number().int().nullable(),
});
export type SearchResult = z.infer<typeof searchResultSchema>;
