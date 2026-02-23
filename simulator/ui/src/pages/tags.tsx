import { useState, useMemo } from 'react';
import { useTags } from '@/hooks/use-tags';
import { useLiveValues } from '@/hooks/use-live-values';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { api } from '@/lib/api';
import type { TagAdmin, TagProfile } from '@/lib/api';

const BASE_GROUPS = ['Accumulator', 'Annular', 'Ram', 'Manifold', 'Control', 'Wellbore'];

type ValueType = 'number' | 'boolean' | 'string';

function formatValue(val: number | boolean | string | undefined | null): string {
  if (val === undefined || val === null) return '—';
  if (typeof val === 'number') return val.toFixed(2);
  if (typeof val === 'boolean') return val ? 'true' : 'false';
  return String(val);
}

function getValueType(profile: TagProfile | null): ValueType {
  return profile?.valueType ?? 'number';
}

export function TagsPage() {
  const { tags, refresh } = useTags();
  const webIds = useMemo(() => tags.map(t => t.webId), [tags]);
  const { values } = useLiveValues(webIds);

  // Edit dialog state
  const [editing, setEditing] = useState<TagAdmin | null>(null);
  const [form, setForm] = useState({
    valueType: 'number' as ValueType,
    nominal: 0, sigma: 0, min: '', max: '', discrete: false,
    booleanDefault: false, stringDefault: '', stringOptions: '',
  });

  // Create dialog state
  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState({
    tagName: '', group: 'Accumulator', unit: '',
    valueType: 'number' as ValueType,
    nominal: 0, sigma: 0, min: '', max: '', discrete: false,
    booleanDefault: false, stringDefault: '', stringOptions: '',
  });

  const openEdit = (tag: TagAdmin) => {
    setEditing(tag);
    const vt = getValueType(tag.profile);
    setForm({
      valueType: vt,
      nominal: tag.profile?.nominal ?? 0,
      sigma: tag.profile?.sigma ?? 0,
      min: tag.profile?.min?.toString() ?? '',
      max: tag.profile?.max?.toString() ?? '',
      discrete: tag.profile?.discrete ?? false,
      booleanDefault: tag.profile?.booleanDefault ?? false,
      stringDefault: tag.profile?.stringDefault ?? '',
      stringOptions: (tag.profile?.stringOptions ?? []).join(', '),
    });
  };

  const saveProfile = async () => {
    if (!editing) return;
    const profile: Record<string, unknown> = { valueType: form.valueType };
    if (form.valueType === 'number') {
      profile.nominal = form.nominal;
      profile.sigma = form.sigma;
      if (form.min !== '') profile.min = Number(form.min);
      if (form.max !== '') profile.max = Number(form.max);
      profile.discrete = form.discrete;
    } else if (form.valueType === 'boolean') {
      profile.nominal = 0;
      profile.sigma = 0;
      profile.booleanDefault = form.booleanDefault;
    } else {
      profile.nominal = 0;
      profile.sigma = 0;
      profile.stringDefault = form.stringDefault;
      profile.stringOptions = form.stringOptions.split(',').map(s => s.trim()).filter(Boolean);
    }
    await api.updateTagProfile(editing.tagName, profile);
    setEditing(null);
    refresh();
  };

  const handleCreateTag = async () => {
    const { tagName, group, unit, valueType } = createForm;
    if (!tagName) return;
    const profile: Record<string, unknown> = { valueType };
    if (valueType === 'number') {
      profile.nominal = createForm.nominal;
      profile.sigma = createForm.sigma;
      if (createForm.min !== '') profile.min = Number(createForm.min);
      if (createForm.max !== '') profile.max = Number(createForm.max);
      profile.discrete = createForm.discrete;
    } else if (valueType === 'boolean') {
      profile.nominal = 0;
      profile.sigma = 0;
      profile.booleanDefault = createForm.booleanDefault;
    } else {
      profile.nominal = 0;
      profile.sigma = 0;
      profile.stringDefault = createForm.stringDefault;
      profile.stringOptions = createForm.stringOptions.split(',').map(s => s.trim()).filter(Boolean);
    }
    await api.createTag({ tagName, unit, group, profile: profile as unknown as TagProfile });
    setShowCreate(false);
    setCreateForm({
      tagName: '', group: 'Accumulator', unit: '',
      valueType: 'number', nominal: 0, sigma: 0, min: '', max: '',
      discrete: false, booleanDefault: false, stringDefault: '', stringOptions: '',
    });
    refresh();
  };

  const handleDeleteTag = async (tagName: string) => {
    if (!confirm(`Delete tag "${tagName}"?`)) return;
    await api.deleteTag(tagName);
    refresh();
  };

  const grouped = useMemo(() => {
    const map = new Map<string, TagAdmin[]>();
    for (const t of tags) {
      const list = map.get(t.group) || [];
      list.push(t);
      map.set(t.group, list);
    }
    return map;
  }, [tags]);

  const activeGroups = useMemo(() => {
    const all = [...BASE_GROUPS];
    for (const g of grouped.keys()) {
      if (!all.includes(g)) all.push(g);
    }
    return all.filter(g => grouped.has(g));
  }, [grouped]);

  const allGroups = useMemo(() => {
    const all = [...BASE_GROUPS, 'Other'];
    for (const g of grouped.keys()) {
      if (!all.includes(g)) all.push(g);
    }
    return all;
  }, [grouped]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">Tag Configuration</h2>
        <Button onClick={() => setShowCreate(true)}>Create Tag</Button>
      </div>

      <Tabs defaultValue={activeGroups[0]}>
        <TabsList>
          {activeGroups.map(g => <TabsTrigger key={g} value={g}>{g}</TabsTrigger>)}
        </TabsList>
        {activeGroups.map(g => (
          <TabsContent key={g} value={g}>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Tag Name</TableHead>
                  <TableHead className="text-right">Value</TableHead>
                  <TableHead className="text-right">Nominal</TableHead>
                  <TableHead className="text-right">Sigma</TableHead>
                  <TableHead className="text-right">Min</TableHead>
                  <TableHead className="text-right">Max</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(grouped.get(g) || []).map(tag => {
                  const live = values.get(tag.webId);
                  const val = live?.Value ?? tag.currentValue?.Value;
                  const vt = getValueType(tag.profile);
                  return (
                    <TableRow key={tag.tagName}>
                      <TableCell className="font-mono text-sm">{tag.tagName}</TableCell>
                      <TableCell className="text-right font-mono tabular-nums">
                        {formatValue(val)}{' '}
                        <span className="text-muted-foreground">{tag.unit}</span>
                      </TableCell>
                      <TableCell className="text-right">{vt === 'number' ? tag.profile?.nominal : '—'}</TableCell>
                      <TableCell className="text-right">{vt === 'number' ? tag.profile?.sigma : '—'}</TableCell>
                      <TableCell className="text-right">{vt === 'number' ? (tag.profile?.min ?? '—') : '—'}</TableCell>
                      <TableCell className="text-right">{vt === 'number' ? (tag.profile?.max ?? '—') : '—'}</TableCell>
                      <TableCell>
                        {vt === 'boolean'
                          ? <Badge variant="outline">Boolean</Badge>
                          : vt === 'string'
                          ? <Badge variant="outline">String</Badge>
                          : tag.profile?.discrete
                          ? <Badge variant="outline">Discrete</Badge>
                          : <Badge variant="secondary">Continuous</Badge>}
                        {tag.hasOverride && <Badge variant="destructive" className="ml-1">Override</Badge>}
                      </TableCell>
                      <TableCell className="space-x-1">
                        <Button size="sm" variant="outline" onClick={() => openEdit(tag)}>Edit</Button>
                        <Button size="sm" variant="destructive" onClick={() => handleDeleteTag(tag.tagName)}>Delete</Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </TabsContent>
        ))}
      </Tabs>

      {/* Edit Tag Dialog */}
      <Dialog open={!!editing} onOpenChange={() => setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Tag Profile: {editing?.tagName}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div>
              <Label>Value Type</Label>
              <Select value={form.valueType} onValueChange={(v: ValueType) => setForm(f => ({ ...f, valueType: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="number">Number</SelectItem>
                  <SelectItem value="boolean">Boolean</SelectItem>
                  <SelectItem value="string">String</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {form.valueType === 'number' && (
              <>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label>Nominal</Label>
                    <Input type="number" value={form.nominal} onChange={e => setForm(f => ({ ...f, nominal: Number(e.target.value) }))} />
                  </div>
                  <div>
                    <Label>Sigma (noise)</Label>
                    <Input type="number" value={form.sigma} onChange={e => setForm(f => ({ ...f, sigma: Number(e.target.value) }))} />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label>Min</Label>
                    <Input type="number" placeholder="None" value={form.min} onChange={e => setForm(f => ({ ...f, min: e.target.value }))} />
                  </div>
                  <div>
                    <Label>Max</Label>
                    <Input type="number" placeholder="None" value={form.max} onChange={e => setForm(f => ({ ...f, max: e.target.value }))} />
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Switch checked={form.discrete} onCheckedChange={v => setForm(f => ({ ...f, discrete: v }))} />
                  <Label>Discrete (integer)</Label>
                </div>
              </>
            )}

            {form.valueType === 'boolean' && (
              <div className="flex items-center gap-2">
                <Switch checked={form.booleanDefault} onCheckedChange={v => setForm(f => ({ ...f, booleanDefault: v }))} />
                <Label>Default Value: {form.booleanDefault ? 'true' : 'false'}</Label>
              </div>
            )}

            {form.valueType === 'string' && (
              <>
                <div>
                  <Label>Default Value</Label>
                  <Input value={form.stringDefault} onChange={e => setForm(f => ({ ...f, stringDefault: e.target.value }))} />
                </div>
                <div>
                  <Label>Options (comma-separated)</Label>
                  <Input placeholder="OPEN, CLOSED, FAULT" value={form.stringOptions} onChange={e => setForm(f => ({ ...f, stringOptions: e.target.value }))} />
                </div>
              </>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
            <Button onClick={saveProfile}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Create Tag Dialog */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create New Tag</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div>
              <Label>Tag Name</Label>
              <Input placeholder="MY.CUSTOM.TAG" value={createForm.tagName}
                onChange={e => setCreateForm(f => ({ ...f, tagName: e.target.value }))} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Group</Label>
                <Select value={createForm.group} onValueChange={v => setCreateForm(f => ({ ...f, group: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {allGroups.map(g => <SelectItem key={g} value={g}>{g}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Unit</Label>
                <Input placeholder="PSI, V, sec..." value={createForm.unit}
                  onChange={e => setCreateForm(f => ({ ...f, unit: e.target.value }))} />
              </div>
            </div>
            <div>
              <Label>Value Type</Label>
              <Select value={createForm.valueType} onValueChange={(v: ValueType) => setCreateForm(f => ({ ...f, valueType: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="number">Number</SelectItem>
                  <SelectItem value="boolean">Boolean</SelectItem>
                  <SelectItem value="string">String</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {createForm.valueType === 'number' && (
              <>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label>Nominal</Label>
                    <Input type="number" value={createForm.nominal}
                      onChange={e => setCreateForm(f => ({ ...f, nominal: Number(e.target.value) }))} />
                  </div>
                  <div>
                    <Label>Sigma (noise)</Label>
                    <Input type="number" value={createForm.sigma}
                      onChange={e => setCreateForm(f => ({ ...f, sigma: Number(e.target.value) }))} />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label>Min</Label>
                    <Input type="number" placeholder="None" value={createForm.min}
                      onChange={e => setCreateForm(f => ({ ...f, min: e.target.value }))} />
                  </div>
                  <div>
                    <Label>Max</Label>
                    <Input type="number" placeholder="None" value={createForm.max}
                      onChange={e => setCreateForm(f => ({ ...f, max: e.target.value }))} />
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Switch checked={createForm.discrete} onCheckedChange={v => setCreateForm(f => ({ ...f, discrete: v }))} />
                  <Label>Discrete (integer)</Label>
                </div>
              </>
            )}

            {createForm.valueType === 'boolean' && (
              <div className="flex items-center gap-2">
                <Switch checked={createForm.booleanDefault} onCheckedChange={v => setCreateForm(f => ({ ...f, booleanDefault: v }))} />
                <Label>Default Value: {createForm.booleanDefault ? 'true' : 'false'}</Label>
              </div>
            )}

            {createForm.valueType === 'string' && (
              <>
                <div>
                  <Label>Default Value</Label>
                  <Input value={createForm.stringDefault}
                    onChange={e => setCreateForm(f => ({ ...f, stringDefault: e.target.value }))} />
                </div>
                <div>
                  <Label>Options (comma-separated)</Label>
                  <Input placeholder="OPEN, CLOSED, FAULT" value={createForm.stringOptions}
                    onChange={e => setCreateForm(f => ({ ...f, stringOptions: e.target.value }))} />
                </div>
              </>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)}>Cancel</Button>
            <Button onClick={handleCreateTag}>Create</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
