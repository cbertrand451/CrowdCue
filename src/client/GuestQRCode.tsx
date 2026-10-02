import { QRCodeSVG } from 'qrcode.react';

export function GuestQRCode({ url }: { url: string }) {
  // Only guest joining links belong on a shared screen or printed invitation.
  let valid = false;
  try {
    const parsed = new URL(url);
    valid =
      ['http:', 'https:'].includes(parsed.protocol) &&
      !parsed.username &&
      !parsed.password &&
      !parsed.search &&
      !parsed.hash &&
      /^\/join\/[A-Za-z0-9_-]{32,128}$/.test(parsed.pathname) &&
      url.length <= 2048;
  } catch {
    /* Keep the text link available when a QR cannot be rendered. */
  }
  if (!valid)
    return <p className="muted">QR code unavailable. Use the guest link.</p>;
  return (
    <figure className="guest-qr">
      <QRCodeSVG
        value={url}
        size={216}
        level="M"
        marginSize={4}
        bgColor="#ffffff"
        fgColor="#000000"
        role="img"
        aria-label="Guest join QR code"
        title="Scan to join this party"
      />
      <figcaption>Scan to join this party</figcaption>
    </figure>
  );
}
