import { useState, useEffect, useCallback } from 'react';
import { api } from '@/lib/api';
import type { TagAdmin } from '@/lib/api';

export function useTags() {
  const [tags, setTags] = useState<TagAdmin[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const data = await api.getTags();
      setTags(data.tags);
    } catch (e) { console.error('Failed to fetch tags', e); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  return { tags, loading, refresh };
}
