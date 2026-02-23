import { useState, useEffect, useRef, useCallback } from 'react';

export interface LiveValue {
  Value: number | boolean | string; Timestamp: string; UnitsAbbreviation: string; Good: boolean;
}

export function useLiveValues(webIds: string[]) {
  const [values, setValues] = useState<Map<string, LiveValue>>(new Map());
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const connect = useCallback(() => {
    if (webIds.length === 0) return;
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const params = webIds.map(id => `webId=${id}`).join('&');
    const ws = new WebSocket(`${proto}//${location.host}/piwebapi/streamsets/channel?${params}`);

    ws.onopen = () => setConnected(true);
    ws.onclose = () => {
      setConnected(false);
      reconnectRef.current = setTimeout(connect, 3000);
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
    wsRef.current = ws;
  }, [webIds]);

  useEffect(() => {
    connect();
    return () => {
      clearTimeout(reconnectRef.current);
      wsRef.current?.close();
    };
  }, [connect]);

  return { values, connected };
}
