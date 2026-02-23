import { useMemo } from 'react';
import { useTags } from '@/hooks/use-tags';
import { useLiveValues } from '@/hooks/use-live-values';
import { useStatus } from '@/hooks/use-status';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { api } from '@/lib/api';

const GROUP_ORDER = ['Accumulator', 'Annular', 'Ram', 'Manifold', 'Control', 'Wellbore'];

export function Dashboard() {
  const { tags } = useTags();
  const status = useStatus();
  const webIds = useMemo(() => tags.map(t => t.webId), [tags]);
  const { values, connected } = useLiveValues(webIds);

  const groups = useMemo(() => {
    const map = new Map<string, typeof tags>();
    for (const t of tags) {
      const list = map.get(t.group) || [];
      list.push(t);
      map.set(t.group, list);
    }
    return GROUP_ORDER.map(g => ({ name: g, tags: map.get(g) || [] }));
  }, [tags]);

  const handleStop = async () => {
    try { await api.stopScenario(); } catch { /* ignore */ }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">Dashboard</h2>
        <div className="flex items-center gap-3">
          <span className={`h-2 w-2 rounded-full ${connected ? 'bg-green-500' : 'bg-red-500'}`} />
          <span className="text-sm text-muted-foreground">{connected ? 'Live' : 'Disconnected'}</span>
        </div>
      </div>

      {status && status.activeScenario !== 'normal' && (
        <div className="flex items-center gap-3 p-3 rounded-lg bg-accent border border-border">
          <Badge variant="default">Active Scenario</Badge>
          <span className="font-medium">{status.activeScenario}</span>
          <Button size="sm" variant="destructive" onClick={handleStop} className="ml-auto">Stop</Button>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {groups.map(group => (
          <Card key={group.name}>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">{group.name}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {group.tags.map(tag => {
                  const live = values.get(tag.webId);
                  const val = live?.Value ?? tag.currentValue?.Value;
                  const unit = tag.unit;
                  return (
                    <div key={tag.tagName} className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground truncate mr-2" title={tag.tagName}>
                        {tag.tagName.split('.').slice(-2).join('.')}
                      </span>
                      <span className="font-mono tabular-nums">
                        {val !== undefined && val !== null ? (typeof val === 'number' ? val.toFixed(2) : String(val)) : '—'}{' '}
                        <span className="text-muted-foreground text-xs">{unit}</span>
                      </span>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
