import { useState, useCallback } from 'react';
import { api } from '@/lib/api';
import type { PIConnectionConfig, RemoteAssetServer, RemoteAFDatabase, RemoteAFElement, ImportResult, ImportStreamEvent } from '@/lib/api';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';

interface ImportAFDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  targetParentWebId: string;
  onImportComplete: () => void;
}

type Step = 'connect' | 'browse' | 'execute';

// Lazy-loaded remote tree node
interface RemoteTreeNode {
  element: RemoteAFElement;
  children: RemoteTreeNode[] | null; // null = not loaded yet
  loading: boolean;
}

function RemoteTreeItem({ node, depth, selected, expanded, onSelect, onToggle }: {
  node: RemoteTreeNode;
  depth: number;
  selected: string | null;
  expanded: Set<string>;
  onSelect: (webId: string, path: string) => void;
  onToggle: (webId: string) => void;
}) {
  const isSelected = selected === node.element.WebId;
  const isExpanded = expanded.has(node.element.WebId);
  return (
    <div>
      <button
        onClick={() => onSelect(node.element.WebId, node.element.Path)}
        className={`w-full text-left px-2 py-1.5 text-sm rounded hover:bg-accent/50 flex items-center gap-1 ${isSelected ? 'bg-accent text-accent-foreground font-medium' : ''}`}
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
      >
        {node.element.HasChildren && (
          <span
            className="text-xs cursor-pointer"
            onClick={e => { e.stopPropagation(); onToggle(node.element.WebId); }}
          >
            {node.loading ? '...' : isExpanded ? '▾' : '▸'}
          </span>
        )}
        <span>{node.element.Name}</span>
      </button>
      {isExpanded && node.children?.map(child => (
        <RemoteTreeItem
          key={child.element.WebId}
          node={child}
          depth={depth + 1}
          selected={selected}
          expanded={expanded}
          onSelect={onSelect}
          onToggle={onToggle}
        />
      ))}
    </div>
  );
}

export function ImportAFDialog({ open, onOpenChange, targetParentWebId, onImportComplete }: ImportAFDialogProps) {
  // Step
  const [step, setStep] = useState<Step>('connect');

  // Connection
  const [serverUrl, setServerUrl] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [testing, setTesting] = useState(false);
  const [connected, setConnected] = useState(false);
  const [serverInfo, setServerInfo] = useState('');
  const [connectionError, setConnectionError] = useState('');

  // Asset server & database selection (loaded after connect, shown in browse step)
  const [assetServers, setAssetServers] = useState<RemoteAssetServer[]>([]);
  const [selectedAssetServer, setSelectedAssetServer] = useState('');
  const [remoteDatabases, setRemoteDatabases] = useState<RemoteAFDatabase[]>([]);
  const [selectedRemoteDb, setSelectedRemoteDb] = useState('');
  const [dbLoading, setDbLoading] = useState(false);

  // Browse tree
  const [remoteTree, setRemoteTree] = useState<RemoteTreeNode[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selectedRemoteElement, setSelectedRemoteElement] = useState<string | null>(null);
  const [selectedRemotePath, setSelectedRemotePath] = useState('');
  const [browseLoading, setBrowseLoading] = useState(false);
  const [browseError, setBrowseError] = useState('');

  // Execute
  const [maxDepth, setMaxDepth] = useState(10);
  const [maxElements, setMaxElements] = useState(500);
  const [importTags, setImportTags] = useState(true);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [progressPhase, setProgressPhase] = useState<'idle' | 'counting' | 'importing' | 'done'>('idle');
  const [progressCurrent, setProgressCurrent] = useState(0);
  const [progressTotal, setProgressTotal] = useState(0);
  const [progressElement, setProgressElement] = useState('');
  const [progressElements, setProgressElements] = useState(0);
  const [progressAttributes, setProgressAttributes] = useState(0);
  const [progressTags, setProgressTags] = useState(0);

  const getConnection = (): PIConnectionConfig => ({
    serverUrl, username, password,
  });

  const reset = useCallback(() => {
    setStep('connect');
    setServerUrl('');
    setUsername('');
    setPassword('');
    setTesting(false);
    setConnected(false);
    setServerInfo('');
    setConnectionError('');
    setAssetServers([]);
    setSelectedAssetServer('');
    setRemoteDatabases([]);
    setSelectedRemoteDb('');
    setDbLoading(false);
    setRemoteTree([]);
    setExpanded(new Set());
    setSelectedRemoteElement(null);
    setSelectedRemotePath('');
    setBrowseLoading(false);
    setBrowseError('');
    setMaxDepth(10);
    setMaxElements(500);
    setImportTags(true);
    setImporting(false);
    setResult(null);
    setProgressPhase('idle');
    setProgressCurrent(0);
    setProgressTotal(0);
    setProgressElement('');
    setProgressElements(0);
    setProgressAttributes(0);
    setProgressTags(0);
  }, []);

  const handleOpenChange = (open: boolean) => {
    if (!open) reset();
    onOpenChange(open);
  };

  // ── Step 1: Connect ──────────────────────────────────────────────

  const testConnection = async () => {
    setTesting(true);
    setConnectionError('');
    setConnected(false);
    try {
      const res = await api.testPIConnection(getConnection());
      if (res.connected) {
        setConnected(true);
        setServerInfo(`${res.productTitle} ${res.productVersion}`);
      } else {
        setConnectionError(res.error || 'Connection failed');
      }
    } catch (err) {
      setConnectionError(err instanceof Error ? err.message : 'Connection failed');
    } finally {
      setTesting(false);
    }
  };

  const goToBrowse = async () => {
    setBrowseLoading(true);
    setBrowseError('');
    try {
      // Load asset servers
      const { servers } = await api.browseRemoteServers(getConnection());
      setAssetServers(servers);
      if (servers.length > 0) {
        const firstServer = servers[0].WebId;
        setSelectedAssetServer(firstServer);
        // Load databases for the first server
        await loadDatabases(firstServer);
      }
      setStep('browse');
    } catch (err) {
      setConnectionError(err instanceof Error ? err.message : 'Failed to load asset servers');
    } finally {
      setBrowseLoading(false);
    }
  };

  const loadDatabases = async (assetServerWebId: string) => {
    setDbLoading(true);
    setRemoteDatabases([]);
    setSelectedRemoteDb('');
    setRemoteTree([]);
    setSelectedRemoteElement(null);
    setSelectedRemotePath('');
    try {
      const { databases } = await api.browseRemoteDatabases(getConnection(), assetServerWebId);
      setRemoteDatabases(databases);
      if (databases.length > 0) {
        const firstDb = databases[0].WebId;
        setSelectedRemoteDb(firstDb);
        await loadRootElements(firstDb);
      }
    } catch (err) {
      setBrowseError(err instanceof Error ? err.message : 'Failed to load databases');
    } finally {
      setDbLoading(false);
    }
  };

  const handleServerChange = async (serverWebId: string) => {
    setSelectedAssetServer(serverWebId);
    setBrowseError('');
    await loadDatabases(serverWebId);
  };

  const loadRootElements = async (dbWebId: string) => {
    setBrowseLoading(true);
    setBrowseError('');
    try {
      const { elements } = await api.browseRemoteElements(getConnection(), dbWebId, true);
      setRemoteTree(elements.map(el => ({ element: el, children: null, loading: false })));
      setSelectedRemoteElement(null);
      setSelectedRemotePath('');
      setExpanded(new Set());
    } catch (err) {
      setBrowseError(err instanceof Error ? err.message : 'Failed to load elements');
    } finally {
      setBrowseLoading(false);
    }
  };

  const handleDbChange = async (dbWebId: string) => {
    setSelectedRemoteDb(dbWebId);
    setBrowseError('');
    await loadRootElements(dbWebId);
  };

  // ── Step 2: Browse ───────────────────────────────────────────────

  const updateTreeNode = (
    nodes: RemoteTreeNode[],
    webId: string,
    update: Partial<RemoteTreeNode>
  ): RemoteTreeNode[] => {
    return nodes.map(node => {
      if (node.element.WebId === webId) {
        return { ...node, ...update };
      }
      if (node.children) {
        return { ...node, children: updateTreeNode(node.children, webId, update) };
      }
      return node;
    });
  };

  const toggleNode = async (webId: string) => {
    if (expanded.has(webId)) {
      setExpanded(prev => {
        const next = new Set(prev);
        next.delete(webId);
        return next;
      });
      return;
    }

    // Find the node
    const findNode = (nodes: RemoteTreeNode[]): RemoteTreeNode | null => {
      for (const n of nodes) {
        if (n.element.WebId === webId) return n;
        if (n.children) {
          const found = findNode(n.children);
          if (found) return found;
        }
      }
      return null;
    };

    const node = findNode(remoteTree);
    if (!node) return;

    // Load children if not loaded yet
    if (node.children === null) {
      setRemoteTree(prev => updateTreeNode(prev, webId, { loading: true }));
      try {
        const { elements } = await api.browseRemoteElements(getConnection(), webId);
        const children = elements.map(el => ({ element: el, children: null, loading: false }));
        setRemoteTree(prev => updateTreeNode(prev, webId, { children, loading: false }));
      } catch {
        setRemoteTree(prev => updateTreeNode(prev, webId, { children: [], loading: false }));
      }
    }

    setExpanded(prev => {
      const next = new Set(prev);
      next.add(webId);
      return next;
    });
  };

  const selectRemoteElement = (webId: string, path: string) => {
    setSelectedRemoteElement(webId);
    setSelectedRemotePath(path);
  };

  // ── Step 3: Execute ──────────────────────────────────────────────

  const executeImport = async () => {
    if (!selectedRemoteElement) return;
    setImporting(true);
    setResult(null);
    setProgressPhase('counting');
    setProgressCurrent(0);
    setProgressTotal(0);
    setProgressElement('');
    setProgressElements(0);
    setProgressAttributes(0);
    setProgressTags(0);

    try {
      await api.executeImportStream(
        {
          connection: getConnection(),
          remoteElementWebId: selectedRemoteElement,
          targetParentWebId: targetParentWebId,
          maxDepth,
          maxElements,
          importTags,
        },
        (event: ImportStreamEvent) => {
          switch (event.type) {
            case 'counting':
              setProgressPhase('counting');
              break;
            case 'counted':
              setProgressTotal(event.total);
              setProgressPhase('importing');
              break;
            case 'progress':
              setProgressCurrent(event.current);
              setProgressTotal(event.total);
              setProgressElement(event.elementName);
              setProgressElements(event.elementsCreated);
              setProgressAttributes(event.attributesCreated);
              setProgressTags(event.tagsCreated);
              break;
            case 'result':
              setResult({
                elementsCreated: event.elementsCreated,
                attributesCreated: event.attributesCreated,
                tagsCreated: event.tagsCreated,
                errors: event.errors,
                rootElementWebId: event.rootElementWebId,
              });
              setProgressPhase('done');
              onImportComplete();
              break;
            case 'error':
              setResult({
                elementsCreated: 0,
                attributesCreated: 0,
                tagsCreated: 0,
                errors: [event.error],
                rootElementWebId: null,
              });
              setProgressPhase('done');
              break;
          }
        },
      );
    } catch (err) {
      setResult({
        elementsCreated: 0,
        attributesCreated: 0,
        tagsCreated: 0,
        errors: [err instanceof Error ? err.message : 'Import failed'],
        rootElementWebId: null,
      });
      setProgressPhase('done');
    } finally {
      setImporting(false);
    }
  };

  // ── Render ───────────────────────────────────────────────────────

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {step === 'connect' && 'Connect to PI Web API'}
            {step === 'browse' && 'Select Element to Import'}
            {step === 'execute' && 'Import AF Hierarchy'}
          </DialogTitle>
        </DialogHeader>

        {/* Step 1: Connection */}
        {step === 'connect' && (
          <div className="grid gap-4 py-4">
            <div>
              <Label>Server URL</Label>
              <Input
                value={serverUrl}
                onChange={e => setServerUrl(e.target.value)}
                placeholder="https://piserver.example.com"
              />
            </div>
            <div>
              <Label>Username</Label>
              <Input value={username} onChange={e => setUsername(e.target.value)} />
            </div>
            <div>
              <Label>Password</Label>
              <Input type="password" value={password} onChange={e => setPassword(e.target.value)} />
            </div>

            {connected && (
              <div className="text-sm text-green-600 flex items-center gap-2">
                <span className="inline-block w-2 h-2 rounded-full bg-green-500" />
                Connected to {serverInfo}
              </div>
            )}
            {connectionError && (
              <div className="text-sm text-red-600">{connectionError}</div>
            )}
          </div>
        )}

        {/* Step 2: Browse */}
        {step === 'browse' && (
          <div className="grid gap-3 py-2">
            {/* Asset server selector */}
            {assetServers.length > 1 && (
              <div>
                <Label>Asset Server</Label>
                <Select value={selectedAssetServer} onValueChange={handleServerChange}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {assetServers.map(s => (
                      <SelectItem key={s.WebId} value={s.WebId}>{s.Name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* Database selector */}
            {dbLoading ? (
              <div className="text-sm text-muted-foreground">Loading databases...</div>
            ) : remoteDatabases.length > 1 ? (
              <div>
                <Label>Database</Label>
                <Select value={selectedRemoteDb} onValueChange={handleDbChange}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {remoteDatabases.map(db => (
                      <SelectItem key={db.WebId} value={db.WebId}>{db.Name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : remoteDatabases.length === 1 ? (
              <div className="text-sm text-muted-foreground">
                Database: <span className="font-medium text-foreground">{remoteDatabases[0].Name}</span>
              </div>
            ) : null}

            {/* Element tree */}
            <ScrollArea className="h-64 border rounded-md">
              {browseLoading ? (
                <div className="flex items-center justify-center h-full text-muted-foreground text-sm p-4">
                  Loading...
                </div>
              ) : remoteTree.length === 0 ? (
                <div className="flex items-center justify-center h-full text-muted-foreground text-sm p-4">
                  No elements found
                </div>
              ) : (
                <div className="p-1">
                  {remoteTree.map(node => (
                    <RemoteTreeItem
                      key={node.element.WebId}
                      node={node}
                      depth={0}
                      selected={selectedRemoteElement}
                      expanded={expanded}
                      onSelect={selectRemoteElement}
                      onToggle={toggleNode}
                    />
                  ))}
                </div>
              )}
            </ScrollArea>

            {selectedRemotePath && (
              <div className="text-xs text-muted-foreground font-mono break-all">
                {selectedRemotePath}
              </div>
            )}
            {browseError && (
              <div className="text-sm text-red-600">{browseError}</div>
            )}
          </div>
        )}

        {/* Step 3: Execute */}
        {step === 'execute' && (
          <div className="grid gap-4 py-2">
            {/* Pre-import config */}
            {progressPhase === 'idle' && !result && (
              <>
                <div className="text-sm space-y-2">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Source:</span>
                    <span className="font-mono text-xs break-all text-right">{selectedRemotePath}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Server:</span>
                    <span className="text-xs">{serverInfo}</span>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label>Max Depth</Label>
                    <Input
                      type="number"
                      value={maxDepth}
                      onChange={e => setMaxDepth(Number(e.target.value))}
                      min={1}
                      max={50}
                    />
                  </div>
                  <div>
                    <Label>Max Elements</Label>
                    <Input
                      type="number"
                      value={maxElements}
                      onChange={e => setMaxElements(Number(e.target.value))}
                      min={1}
                      max={5000}
                    />
                  </div>
                </div>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={importTags}
                    onChange={e => setImportTags(e.target.checked)}
                    className="h-4 w-4 rounded border-input"
                  />
                  <span className="text-sm">Import PI tags</span>
                  <span className="text-xs text-muted-foreground">
                    Create simulator tags from PI Point attributes (min=50%, max=150% of current value)
                  </span>
                </label>
              </>
            )}

            {/* Progress display */}
            {(progressPhase === 'counting' || progressPhase === 'importing') && (
              <div className="space-y-3">
                {/* Progress bar */}
                <div>
                  <div className="flex justify-between text-xs text-muted-foreground mb-1">
                    <span>
                      {progressPhase === 'counting'
                        ? 'Discovering elements...'
                        : `Importing: ${progressElement}`}
                    </span>
                    <span>
                      {progressPhase === 'importing' && progressTotal > 0
                        ? `${progressCurrent} / ${progressTotal}`
                        : ''}
                    </span>
                  </div>
                  <div className="h-2 w-full bg-muted rounded-full overflow-hidden">
                    {progressPhase === 'counting' ? (
                      <div className="h-full bg-primary rounded-full animate-pulse w-full opacity-30" />
                    ) : (
                      <div
                        className="h-full bg-primary rounded-full transition-all duration-300"
                        style={{ width: progressTotal > 0 ? `${Math.round((progressCurrent / progressTotal) * 100)}%` : '0%' }}
                      />
                    )}
                  </div>
                </div>

                {/* Live counters */}
                <div className="flex items-center gap-6 text-sm">
                  <div>
                    <span className="font-mono font-bold">{progressElements}</span>
                    <span className="text-muted-foreground ml-1">elements</span>
                  </div>
                  <div>
                    <span className="font-mono font-bold">{progressAttributes}</span>
                    <span className="text-muted-foreground ml-1">attributes</span>
                  </div>
                  <div>
                    <span className="font-mono font-bold">{progressTags}</span>
                    <span className="text-muted-foreground ml-1">tags</span>
                  </div>
                </div>
              </div>
            )}

            {/* Result summary */}
            {result && (
              <div className="space-y-3">
                <div className="flex items-center gap-4">
                  <div className="text-center">
                    <div className="text-2xl font-bold">{result.elementsCreated}</div>
                    <div className="text-xs text-muted-foreground">Elements</div>
                  </div>
                  <div className="text-center">
                    <div className="text-2xl font-bold">{result.attributesCreated}</div>
                    <div className="text-xs text-muted-foreground">Attributes</div>
                  </div>
                  <div className="text-center">
                    <div className="text-2xl font-bold">{result.tagsCreated}</div>
                    <div className="text-xs text-muted-foreground">Tags</div>
                  </div>
                  <Badge variant={result.errors.length > 0 ? 'destructive' : 'default'}>
                    {result.errors.length > 0 ? `${result.errors.length} warning(s)` : 'Success'}
                  </Badge>
                </div>
                {result.errors.length > 0 && (
                  <ScrollArea className="h-32 border rounded-md p-2">
                    {result.errors.map((err, i) => (
                      <div key={i} className="text-xs text-red-600 py-0.5">{err}</div>
                    ))}
                  </ScrollArea>
                )}
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          {step === 'connect' && (
            <>
              <Button variant="outline" onClick={() => handleOpenChange(false)}>Cancel</Button>
              {!connected ? (
                <Button onClick={testConnection} disabled={testing || !serverUrl || !username}>
                  {testing ? 'Testing...' : 'Test Connection'}
                </Button>
              ) : (
                <Button onClick={goToBrowse} disabled={browseLoading}>
                  {browseLoading ? 'Loading...' : 'Next'}
                </Button>
              )}
            </>
          )}
          {step === 'browse' && (
            <>
              <Button variant="outline" onClick={() => setStep('connect')}>Back</Button>
              <Button onClick={() => setStep('execute')} disabled={!selectedRemoteElement}>
                Next
              </Button>
            </>
          )}
          {step === 'execute' && (
            <>
              {!result ? (
                <>
                  <Button variant="outline" onClick={() => setStep('browse')}>Back</Button>
                  <Button onClick={executeImport} disabled={importing}>
                    {importing ? 'Importing...' : 'Import'}
                  </Button>
                </>
              ) : (
                <Button onClick={() => handleOpenChange(false)}>Done</Button>
              )}
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
