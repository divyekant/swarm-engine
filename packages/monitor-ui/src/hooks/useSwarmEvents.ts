import { useReducer, useEffect, useRef, useCallback } from 'react';
import { reducer, initialState } from '../lib/state-reducer';

const DEFAULT_URL = 'http://localhost:4820';

export function useSwarmEvents(baseUrl: string = DEFAULT_URL) {
  const [state, dispatch] = useReducer(reducer, undefined, initialState);
  const esRef = useRef<EventSource | null>(null);

  // Fetch initial state from /state endpoint
  const hydrate = useCallback(async () => {
    try {
      const res = await fetch(`${baseUrl}/state`);
      if (res.ok) {
        const data = await res.json();
        dispatch({ type: 'hydrate', state: data });
      }
    } catch {
      // Server not available yet — will hydrate from events
    }
  }, [baseUrl]);

  useEffect(() => {
    // Hydrate initial state
    hydrate();

    // Connect to SSE stream
    const es = new EventSource(`${baseUrl}/events`);
    esRef.current = es;

    es.onopen = () => {
      dispatch({ type: 'connected', connected: true });
    };

    es.onmessage = (e) => {
      try {
        const event = JSON.parse(e.data);
        dispatch({ type: 'event', event });
      } catch {
        // Ignore malformed messages (e.g. the `: connected` comment)
      }
    };

    es.onerror = () => {
      dispatch({ type: 'connected', connected: false });
      // EventSource auto-reconnects
    };

    return () => {
      es.close();
      esRef.current = null;
    };
  }, [baseUrl, hydrate]);

  return state;
}
