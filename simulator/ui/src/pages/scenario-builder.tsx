import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '@/lib/api';
import type { ModifierDef, CustomScenarioDef } from '@/lib/api';
import { useTags } from '@/hooks/use-tags';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

function ModifierPreview({ modifier }: { modifier: ModifierDef }) {
  const points: string[] = [];
  const steps = 50;
  for (let i = 0; i <= steps; i++) {
    const progress = i / steps;
    const range = modifier.endValue - modifier.startValue;
    let val: number;
    switch (modifier.curveType) {
      case 'step': val = progress < 1 ? modifier.startValue : modifier.endValue; break;
      case 'exponential': val = modifier.startValue + range * progress * progress; break;
      default: val = modifier.startValue + range * progress;
    }
    const x = (i / steps) * 200;
    const yMin = Math.min(modifier.startValue, modifier.endValue);
    const yMax = Math.max(modifier.startValue, modifier.endValue);
    const yRange = yMax - yMin || 1;
    const y = 60 - ((val - yMin) / yRange) * 50;
    points.push(`${x},${y}`);
  }

  return (
    <svg viewBox="0 0 200 70" className="w-48 h-16 border border-border rounded">
      <polyline fill="none" stroke="currentColor" strokeWidth="1.5" points={points.join(' ')} className="text-primary" />
      <text x="2" y="10" className="text-[8px] fill-muted-foreground">{modifier.startValue}</text>
      <text x="2" y="68" className="text-[8px] fill-muted-foreground">{modifier.endValue}</text>
    </svg>
  );
}

export function ScenarioBuilder() {
  const { name: editName } = useParams();
  const navigate = useNavigate();
  const { tags } = useTags();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [durationMin, setDurationMin] = useState(5);
  const [modifiers, setModifiers] = useState<ModifierDef[]>([]);

  useEffect(() => {
    if (editName) {
      api.getCustomScenarios().then(({ scenarios }) => {
        const def = scenarios.find(s => s.name === editName);
        if (def) {
          setName(def.name);
          setDescription(def.description);
          setDurationMin(Math.round(def.durationMs / 60000));
          setModifiers(def.modifiers);
        }
      });
    }
  }, [editName]);

  const addModifier = () => {
    setModifiers(m => [...m, { tagName: tags[0]?.tagName ?? '', startValue: 0, endValue: 0, curveType: 'linear' }]);
  };

  const updateModifier = (index: number, updates: Partial<ModifierDef>) => {
    setModifiers(m => m.map((mod, i) => i === index ? { ...mod, ...updates } : mod));
  };

  const removeModifier = (index: number) => {
    setModifiers(m => m.filter((_, i) => i !== index));
  };

  const save = async () => {
    const def: CustomScenarioDef = { name, description, durationMs: durationMin * 60000, modifiers };
    if (editName) {
      await api.updateCustomScenario(editName, def);
    } else {
      await api.createCustomScenario(def);
    }
    navigate('/scenarios');
  };

  return (
    <div className="space-y-6 max-w-3xl">
      <h2 className="text-2xl font-bold">{editName ? 'Edit' : 'New'} Scenario</h2>

      <Card>
        <CardHeader><CardTitle className="text-base">Details</CardTitle></CardHeader>
        <CardContent className="grid gap-4">
          <div>
            <Label>Name</Label>
            <Input value={name} onChange={e => setName(e.target.value)} placeholder="my-scenario" disabled={!!editName} />
          </div>
          <div>
            <Label>Description</Label>
            <Input value={description} onChange={e => setDescription(e.target.value)} placeholder="Describe the scenario..." />
          </div>
          <div>
            <Label>Duration (minutes)</Label>
            <Input type="number" min={1} value={durationMin} onChange={e => setDurationMin(Number(e.target.value))} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">Tag Modifiers</CardTitle>
          <Button size="sm" onClick={addModifier}>Add Modifier</Button>
        </CardHeader>
        <CardContent className="space-y-4">
          {modifiers.length === 0 && <p className="text-sm text-muted-foreground">No modifiers yet. Add one to define how tag values change.</p>}
          {modifiers.map((mod, i) => (
            <div key={i} className="flex items-end gap-3 p-3 rounded-lg border border-border">
              <div className="flex-1 min-w-0 grid grid-cols-2 gap-3">
                <div className="col-span-2">
                  <Label className="text-xs">Tag</Label>
                  <Select value={mod.tagName} onValueChange={v => updateModifier(i, { tagName: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {tags.map(t => <SelectItem key={t.tagName} value={t.tagName}>{t.tagName}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs">Start Value</Label>
                  <Input type="number" value={mod.startValue} onChange={e => updateModifier(i, { startValue: Number(e.target.value) })} />
                </div>
                <div>
                  <Label className="text-xs">End Value</Label>
                  <Input type="number" value={mod.endValue} onChange={e => updateModifier(i, { endValue: Number(e.target.value) })} />
                </div>
                <div>
                  <Label className="text-xs">Curve</Label>
                  <Select value={mod.curveType} onValueChange={v => updateModifier(i, { curveType: v as ModifierDef['curveType'] })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="linear">Linear</SelectItem>
                      <SelectItem value="step">Step</SelectItem>
                      <SelectItem value="exponential">Exponential</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="flex flex-col items-center gap-1">
                <ModifierPreview modifier={mod} />
                <Button size="sm" variant="destructive" onClick={() => removeModifier(i)}>Remove</Button>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <div className="flex gap-3">
        <Button onClick={save} disabled={!name || modifiers.length === 0}>Save Scenario</Button>
        <Button variant="outline" onClick={() => navigate('/scenarios')}>Cancel</Button>
      </div>
    </div>
  );
}
