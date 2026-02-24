import { useState, useEffect, useCallback, useMemo } from 'react';
import { api } from '@/lib/api';
import type { AFElementResp, AFAttributeResp, AFDatabaseResp } from '@/lib/api';
import { useTags } from '@/hooks/use-tags';
import { useLiveValues } from '@/hooks/use-live-values';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { ImportAFDialog } from './import-af-dialog';

interface TreeNode {
  element: AFElementResp;
  children: TreeNode[];
}

function TreeItem({ node, depth, selected, collapsed, onSelect, onToggle }: {
  node: TreeNode; depth: number; selected: string | null; collapsed: Set<string>;
  onSelect: (webId: string) => void; onToggle: (webId: string) => void;
}) {
  const isSelected = selected === node.element.WebId;
  const isCollapsed = collapsed.has(node.element.WebId);
  return (
    <div>
      <button
        onClick={() => onSelect(node.element.WebId)}
        className={`w-full text-left px-2 py-1.5 text-sm rounded hover:bg-accent/50 flex items-center gap-1 ${isSelected ? 'bg-accent text-accent-foreground' : ''}`}
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
      >
        {node.element.HasChildren && (
          <span className="text-xs" onClick={e => { e.stopPropagation(); onToggle(node.element.WebId); }}>
            {isCollapsed ? '▸' : '▾'}
          </span>
        )}
        <span>{node.element.Name}</span>
      </button>
      {!isCollapsed && node.children.map(child => (
        <TreeItem key={child.element.WebId} node={child} depth={depth + 1}
          selected={selected} collapsed={collapsed} onSelect={onSelect} onToggle={onToggle} />
      ))}
    </div>
  );
}

export function AFPage() {
  const [databases, setDatabases] = useState<AFDatabaseResp[]>([]);
  const [tree, setTree] = useState<TreeNode[]>([]);
  const [selectedDb, setSelectedDb] = useState<string>('');
  const [selectedElement, setSelectedElement] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [attributes, setAttributes] = useState<AFAttributeResp[]>([]);
  const [elementDetail, setElementDetail] = useState<AFElementResp | null>(null);
  const [showCreateElement, setShowCreateElement] = useState(false);
  const [showCreateAttr, setShowCreateAttr] = useState(false);
  const [showImportDialog, setShowImportDialog] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [newAttrName, setNewAttrName] = useState('');
  const [newAttrType, setNewAttrType] = useState('Double');
  const [newAttrUOM, setNewAttrUOM] = useState('');
  const [newAttrTag, setNewAttrTag] = useState('__none__');

  const { tags } = useTags();
  const webIds = useMemo(() => tags.map(t => t.webId), [tags]);
  const { values } = useLiveValues(webIds);

  const tagWebIdMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const t of tags) m.set(t.tagName, t.webId);
    return m;
  }, [tags]);

  const loadDatabases = useCallback(async () => {
    const { Items } = await api.getAFDatabases();
    setDatabases(Items);
    if (Items.length > 0 && !selectedDb) setSelectedDb(Items[0].WebId);
    return Items;
  }, [selectedDb]);

  useEffect(() => { loadDatabases(); }, []);

  const loadTree = useCallback(async (dbWebId: string) => {
    async function loadRecursive(elements: AFElementResp[]): Promise<TreeNode[]> {
      return Promise.all(elements.map(async (el): Promise<TreeNode> => {
        if (!el.HasChildren) return { element: el, children: [] };
        const { Items } = await api.getAFChildElements(el.WebId);
        return { element: el, children: await loadRecursive(Items) };
      }));
    }
    const { Items } = await api.getAFRootElements(dbWebId);
    setTree(await loadRecursive(Items));
  }, []);

  useEffect(() => {
    if (selectedDb) loadTree(selectedDb);
  }, [selectedDb, loadTree]);

  const toggleNode = useCallback((webId: string) => {
    setCollapsed(prev => {
      const next = new Set(prev);
      if (next.has(webId)) next.delete(webId); else next.add(webId);
      return next;
    });
  }, []);

  const selectElement = useCallback(async (webId: string) => {
    setSelectedElement(webId);
    const [el, attrs] = await Promise.all([
      api.getAFElement(webId),
      api.getAFAttributes(webId),
    ]);
    setElementDetail(el);
    setAttributes(attrs.Items);
  }, []);

  const createChildElement = async () => {
    if (!selectedElement || !newName) return;
    await api.createAFElement(selectedElement, newName, newDesc);
    setShowCreateElement(false);
    setNewName(''); setNewDesc('');
    if (selectedDb) loadTree(selectedDb);
  };

  const createAttribute = async () => {
    if (!selectedElement || !newAttrName) return;
    await api.createAFAttribute({
      elementWebId: selectedElement,
      name: newAttrName,
      type: newAttrType,
      defaultUOM: newAttrUOM,
      piPointName: newAttrTag === '__none__' ? null : newAttrTag,
    });
    setShowCreateAttr(false);
    setNewAttrName(''); setNewAttrType('Double'); setNewAttrUOM(''); setNewAttrTag('__none__');
    selectElement(selectedElement);
  };

  const deleteAttribute = async (webId: string) => {
    await api.deleteAFAttribute(webId);
    if (selectedElement) selectElement(selectedElement);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">Asset Framework</h2>
        <Button variant="outline" size="sm" onClick={() => setShowImportDialog(true)}>
          Import from PI Web API
        </Button>
      </div>

      {databases.length > 1 && (
        <Select value={selectedDb} onValueChange={setSelectedDb}>
          <SelectTrigger className="w-64"><SelectValue placeholder="Select database" /></SelectTrigger>
          <SelectContent>
            {databases.map(db => <SelectItem key={db.WebId} value={db.WebId}>{db.Name}</SelectItem>)}
          </SelectContent>
        </Select>
      )}

      <div className="flex gap-4 h-[calc(100vh-10rem)]">
        {/* Tree panel */}
        <Card className="w-72 flex flex-col">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Hierarchy</CardTitle>
          </CardHeader>
          <CardContent className="flex-1 p-0">
            <ScrollArea className="h-full px-2">
              {tree.map(node => (
                <TreeItem key={node.element.WebId} node={node} depth={0}
                  selected={selectedElement} collapsed={collapsed} onSelect={selectElement} onToggle={toggleNode} />
              ))}
            </ScrollArea>
          </CardContent>
        </Card>

        {/* Detail panel */}
        <div className="flex-1 space-y-4">
          {elementDetail ? (
            <>
              <Card>
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base">{elementDetail.Name}</CardTitle>
                    <div className="flex gap-2">
                      <Button size="sm" variant="outline" onClick={() => setShowCreateElement(true)}>Add Child</Button>
                      <Button size="sm" variant="outline" onClick={() => setShowCreateAttr(true)}>Add Attribute</Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground">{elementDetail.Description || 'No description'}</p>
                  <p className="text-xs text-muted-foreground mt-1 font-mono">{elementDetail.Path}</p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">Attributes</CardTitle>
                </CardHeader>
                <CardContent>
                  {attributes.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No attributes</p>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Name</TableHead>
                          <TableHead>Type</TableHead>
                          <TableHead>PI Point</TableHead>
                          <TableHead className="text-right">Value</TableHead>
                          <TableHead></TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {attributes.map(attr => {
                          const tagWid = attr.ConfigString ? tagWebIdMap.get(attr.ConfigString.replace(/^\\+/, '')) : undefined;
                          const live = tagWid ? values.get(tagWid) : undefined;
                          return (
                            <TableRow key={attr.WebId}>
                              <TableCell className="font-medium">{attr.Name}</TableCell>
                              <TableCell><Badge variant="outline">{attr.Type}</Badge></TableCell>
                              <TableCell className="font-mono text-xs">{attr.ConfigString ? attr.ConfigString.replace(/^\\+/, '') : '—'}</TableCell>
                              <TableCell className="text-right font-mono tabular-nums">
                                {live ? `${typeof live.Value === 'number' ? live.Value.toFixed(2) : String(live.Value)} ${attr.DefaultUnitsOfMeasure}` : '—'}
                              </TableCell>
                              <TableCell>
                                <Button size="sm" variant="destructive" onClick={() => deleteAttribute(attr.WebId)}>Delete</Button>
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  )}
                </CardContent>
              </Card>
            </>
          ) : (
            <div className="flex items-center justify-center h-full text-muted-foreground">
              Select an element from the tree
            </div>
          )}
        </div>
      </div>

      {/* Create element dialog */}
      <Dialog open={showCreateElement} onOpenChange={setShowCreateElement}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add Child Element</DialogTitle></DialogHeader>
          <div className="grid gap-4 py-4">
            <div><Label>Name</Label><Input value={newName} onChange={e => setNewName(e.target.value)} /></div>
            <div><Label>Description</Label><Input value={newDesc} onChange={e => setNewDesc(e.target.value)} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreateElement(false)}>Cancel</Button>
            <Button onClick={createChildElement}>Create</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Create attribute dialog */}
      <Dialog open={showCreateAttr} onOpenChange={setShowCreateAttr}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add Attribute</DialogTitle></DialogHeader>
          <div className="grid gap-4 py-4">
            <div><Label>Name</Label><Input value={newAttrName} onChange={e => setNewAttrName(e.target.value)} /></div>
            <div>
              <Label>Type</Label>
              <Select value={newAttrType} onValueChange={setNewAttrType}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="Double">Double</SelectItem>
                  <SelectItem value="Int32">Int32</SelectItem>
                  <SelectItem value="Boolean">Boolean</SelectItem>
                  <SelectItem value="String">String</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div><Label>Unit of Measure</Label><Input value={newAttrUOM} onChange={e => setNewAttrUOM(e.target.value)} placeholder="PSI, V, sec..." /></div>
            <div>
              <Label>Map to PI Tag</Label>
              <Select value={newAttrTag} onValueChange={setNewAttrTag}>
                <SelectTrigger><SelectValue placeholder="None (static)" /></SelectTrigger>
                <SelectContent position="popper" className="max-h-60">
                  <SelectItem value="__none__">None (static)</SelectItem>
                  {tags.map(t => <SelectItem key={t.tagName} value={t.tagName}>{t.tagName} ({t.unit})</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreateAttr(false)}>Cancel</Button>
            <Button onClick={createAttribute}>Create</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Import from PI Web API dialog */}
      <ImportAFDialog
        open={showImportDialog}
        onOpenChange={setShowImportDialog}
        targetParentWebId={selectedElement || selectedDb}
        onImportComplete={async () => {
          const dbs = await loadDatabases();
          const dbWebId = selectedDb || (dbs.length > 0 ? dbs[0].WebId : '');
          if (dbWebId) {
            if (!selectedDb) setSelectedDb(dbWebId);
            loadTree(dbWebId);
          }
        }}
      />
    </div>
  );
}
