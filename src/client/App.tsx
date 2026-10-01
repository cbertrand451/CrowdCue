import { useEffect, useState } from 'react';

export function App() {
  const [status, setStatus] = useState<'checking' | 'ready' | 'unavailable'>(
    'checking',
  );
  useEffect(() => {
    const controller = new AbortController();
    async function check() {
      try {
        const response = await fetch('/api/health', {
          signal: controller.signal,
        });
        const data: unknown = await response.json();
        if (
          !response.ok ||
          typeof data !== 'object' ||
          data === null ||
          !('status' in data) ||
          data.status !== 'ok'
        )
          throw new Error('Unavailable');
        setStatus('ready');
      } catch {
        if (!controller.signal.aborted) setStatus('unavailable');
      }
    }
    void check();
    return () => controller.abort();
  }, []);
  return (
    <main>
      <p className="wordmark">CrowdCue</p>
      <h1>
        Good music.
        <br />
        Together.
      </h1>
      <p className="intro">The foundation for your shared party queue.</p>
      <p role="status" className={`status ${status}`}>
        {status === 'checking'
          ? 'Checking connection…'
          : status === 'ready'
            ? 'CrowdCue is running.'
            : 'Unable to reach CrowdCue. Please refresh to try again.'}
      </p>
    </main>
  );
}
