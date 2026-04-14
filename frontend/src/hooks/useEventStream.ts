import { useEffect, useRef, useState } from 'react';

interface UseEventStreamOptions<T> {
  url: string | null;
  onEvent: (event: T) => void;
  enabled?: boolean;
}

interface UseEventStreamResult {
  connected: boolean;
  error: string | null;
}

export function useEventStream<T>({
  url,
  onEvent,
  enabled = true,
}: UseEventStreamOptions<T>): UseEventStreamResult {
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    if (!url || !enabled) {
      setConnected(false);
      return;
    }

    const es = new EventSource(url);
    sourceRef.current = es;
    setError(null);

    es.onopen = () => setConnected(true);

    es.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data) as T;
        onEvent(data);
      } catch {
        // non-JSON message — ignore
      }
    };

    es.onerror = () => {
      setConnected(false);
      setError('Live stream unavailable — using polling mode');
      es.close();
    };

    return () => {
      es.close();
      sourceRef.current = null;
      setConnected(false);
    };
  }, [url, enabled]);

  return { connected, error };
}
