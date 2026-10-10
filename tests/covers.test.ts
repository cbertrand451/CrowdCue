import sharp from 'sharp';
import { expect, it } from 'vitest';
import { normalizeCover } from '../src/server/parties/covers.js';
it('rejects corrupt images and active vector formats, and bounds decoding', async () => {
  for (const value of [
    Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>').toString('base64'),
    '!bad',
    'AAAA',
    '/9j/2Q==',
    'A'.repeat(8 * 1024 * 1024 + 4),
  ])
    await expect(normalizeCover(value)).rejects.toThrow();
});
it('converts supported media to a square JPEG within Spotify’s encoded payload limit', async () => {
  const png = await sharp({
    create: { width: 16, height: 32, channels: 4, background: '#65b32e' },
  })
    .png()
    .toBuffer();
  const image = await normalizeCover(png.toString('base64'));
  expect(await sharp(image).metadata()).toMatchObject({
    width: 512,
    height: 512,
    format: 'jpeg',
  });
  expect(image.toString('base64').length).toBeLessThanOrEqual(256 * 1024);
});
