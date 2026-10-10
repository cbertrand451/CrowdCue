import sharp from 'sharp';
import { z } from 'zod';
// Bounded input, decoded and re-encoded on the server; no SVG or metadata survives.
export const coverInputSchema = z
  .string()
  .min(4)
  .max(8 * 1024 * 1024)
  .regex(/^[A-Za-z0-9+/]+={0,2}$/);
export async function normalizeCover(value: string): Promise<Buffer> {
  const source = Buffer.from(coverInputSchema.parse(value), 'base64');
  if (source.toString('base64') !== value) throw new Error('Invalid base64');
  const jpeg = source[0] === 0xff && source[1] === 0xd8 && source[2] === 0xff;
  const png = source
    .subarray(0, 8)
    .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const webp =
    source.subarray(0, 4).toString() === 'RIFF' &&
    source.subarray(8, 12).toString() === 'WEBP';
  if (!jpeg && !png && !webp) throw new Error('Unsupported image');
  const image = sharp(source, {
    limitInputPixels: 24000000,
    failOn: 'warning',
  });
  const meta = await image.metadata();
  if (
    !['jpeg', 'png', 'webp'].includes(meta.format ?? '') ||
    (meta.pages ?? 1) !== 1
  )
    throw new Error('Unsupported cover');
  const result = await image
    .rotate()
    .resize(512, 512, { fit: 'cover' })
    .flatten({ background: '#000000' })
    .jpeg({ quality: 80 })
    .toBuffer();
  if (result.toString('base64').length > 256 * 1024)
    throw new Error('Cover too large');
  return result;
}
