import { useEffect, useId, useRef, useState } from 'react';
import { LoadingStatus } from './LoadingButton';
import { AlertMessage } from './AlertMessage';
export function CoverUpload({
  value,
  onChange,
  onBusyChange,
  partyId,
  disabled = false,
}: {
  value?: string;
  onChange?: (value: string | undefined) => void;
  onBusyChange?: (busy: boolean) => void;
  partyId?: string;
  disabled?: boolean;
}) {
  const id = useId();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [saved, setSaved] = useState(false);
  const [preview, setPreview] = useState<string>();
  const pending = useRef(false);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  async function select(file: File | undefined) {
    if (!file || pending.current) return;
    if (
      !['image/jpeg', 'image/png', 'image/webp'].includes(file.type) ||
      file.size > 6 * 1024 * 1024
    ) {
      setError('Choose a JPEG, PNG, or WebP image under 6 MB.');
      return;
    }
    pending.current = true;
    setBusy(true);
    onBusyChange?.(true);
    setError(undefined);
    setSaved(false);
    const c = new AbortController();
    controller.current = c;
    try {
      const data = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      const cover = data.split(',')[1];
      if (c.signal.aborted) return;
      if (partyId) {
        const response = await fetch(`/api/parties/${partyId}/cover`, {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ cover }),
          signal: c.signal,
        });
        if (!response.ok || (await response.json()).saved !== true)
          throw new Error();
        if (c.signal.aborted) return;
        setPreview(data);
        setSaved(true);
      } else {
        onChange?.(cover);
        setPreview(data);
      }
    } catch {
      if (!c.signal.aborted)
        setError(
          'Could not save the cover. Choose a valid image and try again.',
        );
    } finally {
      pending.current = false;
      if (!c.signal.aborted) {
        setBusy(false);
        onBusyChange?.(false);
      }
    }
  }
  return (
    <div className="cover-upload">
      <label htmlFor={id}>
        Cover Image <span className="muted">(optional)</span>
      </label>
      <input
        id={id}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        disabled={disabled || busy}
        onChange={(e) => {
          void select(e.target.files?.[0]);
          e.target.value = '';
        }}
      />
      <p className="muted">
        Upload media: JPEG, PNG, or WebP, up to 6 MB and 24 megapixels. Cropped
        square for your gallery and Spotify playlist.
      </p>
      {preview && (partyId || value) && (
        <img
          className="cover-preview"
          src={preview}
          alt="Selected playlist cover"
        />
      )}
      {!partyId && value && (
        <button
          type="button"
          className="secondary"
          disabled={disabled || busy}
          onClick={() => {
            onChange?.(undefined);
            setPreview(undefined);
          }}
        >
          Remove cover
        </button>
      )}
      {busy && <LoadingStatus>Saving cover…</LoadingStatus>}
      {saved && (
        <p role="status" className="ready">
          Cover saved. It will sync to your session playlist.
        </p>
      )}
      {error && <AlertMessage>{error}</AlertMessage>}
    </div>
  );
}
