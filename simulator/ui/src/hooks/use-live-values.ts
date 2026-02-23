import { useState, useEffect, useRef } from 'react';

export interface LiveValue {
  Value: number | boolean | string; Timestamp: string; UnitsAbbreviation: string; Good: boolean;
}

export function useLiveValues(webIds: string[]) {
  const [values, setValues] = useState<Map<string, LiveValue>>(new Map());
  const [connected, setConnected] = useState(false);

  // Stabilise the webIds reference — only change when the actual IDs change
  const webIdsKey = webIds.join(',');
  const stableWebIds = useRef(webIds);
  if (stableWebIds.current.join(',') !== webIdsKey) {
    stableWebIds.current = webIds;
  }

  useEffect(() => {
    const ids = stableWebIds.current;
    if (ids.length === 0) return;

    let ws: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
    let disposed = false;

    function connect() {
      if (disposed) return;
      const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
      const params = ids.map(id => `webId=${id}`).join('&');
      ws = new WebSocket(`${proto}//${location.host}/piwebapi/streamsets/channel?${params}`);

      ws.onopen = () => { if (!disposed) setConnected(true); };
      ws.onclose = () => {
        if (disposed) return;
        setConnected(false);
        reconnectTimer = setTimeout(connect, 3000);
      };
      ws.onmessage = (e) => {
        try {
          const data = JSON.parse(e.data as string) as { Items?: { WebId: string; Items?: LiveValue[] }[] };
          if (data.Items) {
            setValues(prev => {
              const next = new Map(prev);
              for (const item of data.Items!) {
                if (item.Items?.[0]) {
                  next.set(item.WebId, item.Items[0]);
                }
              }
              return next;
            });
          }
        } catch { /* ignore parse errors */ }
      };
    }

    connect();

    return () => {
      disposed = true;
      clearTimeout(reconnectTimer);
      ws?.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [webIdsKey]);

  return { values, connected };
}
