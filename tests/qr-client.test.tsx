// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import jsQR from 'jsqr';
import { afterEach, expect, it } from 'vitest';
import { GuestQRCode } from '../src/client/GuestQRCode';
import { PartyLinks } from '../src/client/PartyLinks';
const url = `https://crowdcue.example/join/${'g'.repeat(43)}`;
afterEach(cleanup);
// Rasterize the emitted black SVG cells into pixels, then use an independent
// decoder to verify the actual scannable result rather than a component prop.
function decode(svg: SVGSVGElement) {
  const cells = Number(svg.getAttribute('viewBox')!.split(' ')[2]);
  const scale = 4,
    width = cells * scale;
  const pixels = new Uint8ClampedArray(width * width * 4).fill(255);
  const path = svg.querySelector('path[fill="#000000"]')!.getAttribute('d')!;
  for (const match of path.matchAll(/M(\d+)[ ,](\d+)\s*h(\d+)v1H\d+z/g)) {
    const [x, y, run] = match.slice(1).map(Number);
    for (let py = y * scale; py < (y + 1) * scale; py++)
      for (let px = x * scale; px < (x + run) * scale; px++) {
        const offset = (py * width + px) * 4;
        pixels[offset] = pixels[offset + 1] = pixels[offset + 2] = 0;
      }
  }
  // A four-module white quiet zone surrounds all sides of the QR symbol.
  for (let i = 0; i < width; i++) {
    expect(pixels[i * width * 4]).toBe(255);
    expect(pixels[i * 4]).toBe(255);
  }
  return jsQR(pixels, width, width)?.data;
}
it('generates a scannable QR containing the exact guest URL with local SVG rendering', () => {
  const { rerender } = render(<GuestQRCode url={url} />);
  expect(
    decode(
      screen.getByRole('img', {
        name: 'Guest join QR code',
      }) as unknown as SVGSVGElement,
    ),
  ).toBe(url);
  const other = `https://events.crowdcue.example/join/${'x_y-'.repeat(32)}`;
  rerender(<GuestQRCode url={other} />);
  expect(
    decode(
      screen.getByRole('img', {
        name: 'Guest join QR code',
      }) as unknown as SVGSVGElement,
    ),
  ).toBe(other);
  expect(document.querySelector('img')).toBeNull();
});
it('encodes only the guest link on active host invitations and removes codes when ended', () => {
  const links = {
    guest: url,
    admin: `https://crowdcue.example/admin/${'a'.repeat(43)}`,
    display: `https://crowdcue.example/display/${'d'.repeat(43)}`,
  };
  const { rerender } = render(<PartyLinks links={links} active />);
  expect(
    decode(
      screen.getByRole('img', {
        name: 'Guest join QR code',
      }) as unknown as SVGSVGElement,
    ),
  ).toBe(links.guest);
  expect(screen.getByRole('link', { name: 'Open admin' })).toHaveAttribute(
    'href',
    links.admin,
  );
  rerender(<PartyLinks links={links} active={false} />);
  expect(screen.queryByRole('img')).not.toBeInTheDocument();
});
it('refuses private role links, invalid schemes, credentials and malformed guest links', () => {
  const { rerender } = render(<GuestQRCode url="invalid" />);
  for (const value of [
    'invalid',
    'javascript:alert(1)',
    url.replace('/join/', '/admin/'),
    url.replace('/join/', '/display/'),
    url + '?private=true',
    url + '#fragment',
    url.replace('https://', 'https://user:password@'),
    'https://crowdcue.example/join/short',
  ]) {
    rerender(<GuestQRCode url={value} />);
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(
      screen.getByText('QR code unavailable. Use the guest link.'),
    ).toBeVisible();
  }
});
