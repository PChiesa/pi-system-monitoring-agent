import { useState, useEffect } from 'react';
import { api } from '@/lib/api';
import type { SimStatus } from '@/lib/api';

export function useStatus() {
  const [status, setStatus] = useState<SimStatus | null>(null);

  useEffect(() => {
    const poll = async () => {
      try { setStatus(await api.getStatus()); } catch { /* ignore */ }
    };
    poll();
    const id = setInterval(poll, 5000);
    return () => clearInterval(id);
  }, []);

  return status;
}
