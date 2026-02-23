import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '@/lib/api';
import type { ScenarioInfo, CustomScenarioDef } from '@/lib/api';
import { useStatus } from '@/hooks/use-status';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

const BUILT_IN = ['normal', 'accumulator-decay', 'kick-detection', 'ram-slowdown', 'pod-failure'];

export function ScenariosPage() {
  const [scenarios, setScenarios] = useState<ScenarioInfo[]>([]);
  const [custom, setCustom] = useState<CustomScenarioDef[]>([]);
  const status = useStatus();
  const navigate = useNavigate();

  const refresh = useCallback(async () => {
    const [s, c] = await Promise.all([api.getScenarios(), api.getCustomScenarios()]);
    setScenarios(s.scenarios);
    setCustom(c.scenarios);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const activate = async (name: string) => { await api.activateScenario(name); };
  const stop = async () => { await api.stopScenario(); };
  const remove = async (name: string) => { await api.deleteCustomScenario(name); refresh(); };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">Scenarios</h2>
        <Button onClick={() => navigate('/scenarios/new')}>New Scenario</Button>
      </div>

      {status && status.activeScenario !== 'normal' && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Active Scenario</CardTitle>
          </CardHeader>
          <CardContent className="flex items-center gap-3">
            <Badge>{status.activeScenario}</Badge>
            <Button size="sm" variant="destructive" onClick={stop}>Stop</Button>
          </CardContent>
        </Card>
      )}

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Description</TableHead>
            <TableHead>Duration</TableHead>
            <TableHead>Type</TableHead>
            <TableHead></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {scenarios.filter(s => s.name !== 'normal').map(s => (
            <TableRow key={s.name}>
              <TableCell className="font-medium">{s.name}</TableCell>
              <TableCell className="text-muted-foreground">{s.description}</TableCell>
              <TableCell>{s.durationMs > 0 ? `${Math.round(s.durationMs / 60000)} min` : '∞'}</TableCell>
              <TableCell>
                {BUILT_IN.includes(s.name) ? <Badge variant="secondary">Built-in</Badge> : <Badge variant="outline">Custom</Badge>}
              </TableCell>
              <TableCell className="text-right space-x-2">
                <Button size="sm" variant="outline"
                  disabled={status?.activeScenario === s.name}
                  onClick={() => activate(s.name)}>
                  Activate
                </Button>
                {!BUILT_IN.includes(s.name) && (
                  <>
                    <Button size="sm" variant="outline" onClick={() => navigate(`/scenarios/edit/${s.name}`)}>Edit</Button>
                    <Button size="sm" variant="destructive" onClick={() => remove(s.name)}>Delete</Button>
                  </>
                )}
              </TableCell>
            </TableRow>
          ))}
          {custom.filter(c => !scenarios.some(s => s.name === c.name)).map(c => (
            <TableRow key={c.name}>
              <TableCell className="font-medium">{c.name}</TableCell>
              <TableCell className="text-muted-foreground">{c.description}</TableCell>
              <TableCell>{Math.round(c.durationMs / 60000)} min</TableCell>
              <TableCell><Badge variant="outline">Custom</Badge></TableCell>
              <TableCell className="text-right space-x-2">
                <Button size="sm" variant="outline" onClick={() => activate(c.name)}>Activate</Button>
                <Button size="sm" variant="outline" onClick={() => navigate(`/scenarios/edit/${c.name}`)}>Edit</Button>
                <Button size="sm" variant="destructive" onClick={() => remove(c.name)}>Delete</Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
