const BASE = '';  // Proxy handles routing

export async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(BASE + path, { ...init, headers: { 'Content-Type': 'application/json', ...init?.headers } });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json() as Promise<T>;
}

export const api = {
  getTags: () => fetchJson<{ tags: TagAdmin[] }>('/admin/tags'),
  createTag: (data: { tagName: string; unit: string; group: string; profile: TagProfile }) =>
    fetchJson('/admin/tags', { method: 'POST', body: JSON.stringify(data) }),
  deleteTag: (tagName: string) =>
    fetchJson(`/admin/tags/${encodeURIComponent(tagName)}`, { method: 'DELETE' }),
  updateTagProfile: (tagName: string, profile: Record<string, unknown>) =>
    fetchJson(`/admin/tags/${encodeURIComponent(tagName)}/profile`, { method: 'PUT', body: JSON.stringify(profile) }),
  setOverride: (tagName: string, value: number | boolean | string) =>
    fetchJson(`/admin/tags/${encodeURIComponent(tagName)}/override`, { method: 'POST', body: JSON.stringify({ value }) }),
  clearOverride: (tagName: string) =>
    fetchJson(`/admin/tags/${encodeURIComponent(tagName)}/override`, { method: 'DELETE' }),
  getStatus: () => fetchJson<SimStatus>('/admin/status'),
  getScenarios: () => fetchJson<{ scenarios: ScenarioInfo[] }>('/admin/scenarios'),
  getCustomScenarios: () => fetchJson<{ scenarios: CustomScenarioDef[] }>('/admin/scenarios/custom'),
  activateScenario: (name: string) =>
    fetchJson('/admin/scenario', { method: 'POST', body: JSON.stringify({ name }) }),
  stopScenario: () => fetchJson('/admin/scenario/stop', { method: 'POST' }),
  createCustomScenario: (def: CustomScenarioDef) =>
    fetchJson('/admin/scenarios/custom', { method: 'POST', body: JSON.stringify(def) }),
  updateCustomScenario: (name: string, def: CustomScenarioDef) =>
    fetchJson(`/admin/scenarios/custom/${encodeURIComponent(name)}`, { method: 'PUT', body: JSON.stringify(def) }),
  deleteCustomScenario: (name: string) =>
    fetchJson(`/admin/scenarios/custom/${encodeURIComponent(name)}`, { method: 'DELETE' }),
  // AF
  getAFDatabases: () => fetchJson<{ Items: AFDatabaseResp[] }>('/piwebapi/assetdatabases'),
  getAFRootElements: (dbWebId: string) =>
    fetchJson<{ Items: AFElementResp[] }>(`/piwebapi/assetdatabases/${dbWebId}/elements`),
  getAFElement: (webId: string) => fetchJson<AFElementResp>(`/piwebapi/elements/${webId}`),
  getAFChildElements: (webId: string) =>
    fetchJson<{ Items: AFElementResp[] }>(`/piwebapi/elements/${webId}/elements`),
  getAFAttributes: (webId: string) =>
    fetchJson<{ Items: AFAttributeResp[] }>(`/piwebapi/elements/${webId}/attributes`),
  getAFAttributeValue: (webId: string) =>
    fetchJson(`/piwebapi/attributes/${webId}/value`),
  // AF admin
  createAFElement: (parentWebId: string, name: string, description: string) =>
    fetchJson('/admin/af/elements', { method: 'POST', body: JSON.stringify({ parentWebId, name, description }) }),
  deleteAFElement: (webId: string) =>
    fetchJson(`/admin/af/elements/${webId}`, { method: 'DELETE' }),
  createAFAttribute: (data: { elementWebId: string; name: string; type: string; defaultUOM: string; piPointName: string | null }) =>
    fetchJson('/admin/af/attributes', { method: 'POST', body: JSON.stringify(data) }),
  updateAFAttribute: (webId: string, updates: Record<string, unknown>) =>
    fetchJson(`/admin/af/attributes/${webId}`, { method: 'PUT', body: JSON.stringify(updates) }),
  deleteAFAttribute: (webId: string) =>
    fetchJson(`/admin/af/attributes/${webId}`, { method: 'DELETE' }),
  // AF import from remote PI Web API
  testPIConnection: (config: PIConnectionConfig) =>
    fetchJson<PIConnectionResult>('/admin/import/test-connection', {
      method: 'POST', body: JSON.stringify(config),
    }),
  browseRemoteServers: (config: PIConnectionConfig) =>
    fetchJson<{ servers: RemoteAssetServer[] }>('/admin/import/browse/servers', {
      method: 'POST', body: JSON.stringify(config),
    }),
  browseRemoteDatabases: (config: PIConnectionConfig, assetServerWebId: string) =>
    fetchJson<{ databases: RemoteAFDatabase[] }>('/admin/import/browse/databases', {
      method: 'POST', body: JSON.stringify({ ...config, assetServerWebId }),
    }),
  browseRemoteElements: (config: PIConnectionConfig, parentWebId: string, isDatabase?: boolean) =>
    fetchJson<{ elements: RemoteAFElement[] }>('/admin/import/browse/elements', {
      method: 'POST', body: JSON.stringify({ ...config, parentWebId, isDatabase }),
    }),
  executeImportStream: (
    data: {
      connection: PIConnectionConfig;
      remoteElementWebId: string;
      targetParentWebId?: string;
      remoteDatabaseName?: string;
      maxDepth?: number;
      maxElements?: number;
      importTags?: boolean;
    },
    onEvent: (event: ImportStreamEvent) => void,
  ): Promise<void> => {
    return new Promise(async (resolve, reject) => {
      try {
        const res = await fetch(BASE + '/admin/import/execute', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
        });
        if (!res.ok) {
          const text = await res.text();
          try { reject(new Error(JSON.parse(text).error)); } catch { reject(new Error(`${res.status} ${res.statusText}`)); }
          return;
        }
        const reader = res.body!.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop()!; // keep incomplete line in buffer
          for (const line of lines) {
            if (line.trim()) {
              try { onEvent(JSON.parse(line) as ImportStreamEvent); } catch { /* skip malformed */ }
            }
          }
        }
        // Process any remaining buffer
        if (buffer.trim()) {
          try { onEvent(JSON.parse(buffer) as ImportStreamEvent); } catch { /* skip */ }
        }
        resolve();
      } catch (err) {
        reject(err);
      }
    });
  },
};

export interface TagProfile {
  valueType?: 'number' | 'boolean' | 'string';
  nominal: number; sigma: number; min?: number; max?: number; discrete?: boolean;
  booleanDefault?: boolean; stringDefault?: string; stringOptions?: string[];
}

export interface TagAdmin {
  tagName: string; webId: string; unit: string; path: string; group: string;
  profile: TagProfile | null;
  currentValue: { Timestamp: string; Value: number | boolean | string; UnitsAbbreviation: string; Good: boolean } | null;
  hasOverride: boolean;
}

export interface SimStatus {
  status: string; uptime: number; tags: number; wsClients: number;
  activeScenario: string; mode: string;
}

export interface ScenarioInfo { name: string; description: string; durationMs: number; }

export interface ModifierDef {
  tagName: string; startValue: number; endValue: number;
  curveType: 'linear' | 'step' | 'exponential';
}

export interface CustomScenarioDef {
  name: string; description: string; durationMs: number; modifiers: ModifierDef[];
}

export interface AFDatabaseResp { WebId: string; Name: string; Description: string; Path: string; Links: Record<string, string>; }
export interface AFElementResp { WebId: string; Name: string; Description: string; Path: string; HasChildren: boolean; Links: Record<string, string>; }
export interface AFAttributeResp { WebId: string; Name: string; Description: string; Path: string; Type: string; DefaultUnitsOfMeasure: string; DataReferencePlugIn: string; ConfigString: string; Links: Record<string, string>; }

// AF Import types
export interface PIConnectionConfig { serverUrl: string; username: string; password: string; }
export interface RemoteAssetServer { WebId: string; Name: string; Description: string; Path: string; IsConnected: boolean; }
export interface RemoteAFDatabase { WebId: string; Name: string; Description: string; Path: string; }
export interface RemoteAFElement { WebId: string; Name: string; Description: string; Path: string; HasChildren: boolean; }
export interface PIConnectionResult { connected: boolean; productTitle?: string; productVersion?: string; error?: string; }
export interface ImportResult { elementsCreated: number; attributesCreated: number; tagsCreated: number; errors: string[]; rootElementWebId: string | null; }
export type ImportStreamEvent =
  | { type: 'counting'; message: string }
  | { type: 'counted'; total: number; truncated: boolean }
  | { type: 'progress'; current: number; total: number; elementName: string; elementsCreated: number; attributesCreated: number; tagsCreated: number }
  | { type: 'result'; elementsCreated: number; attributesCreated: number; tagsCreated: number; errors: string[]; rootElementWebId: string | null }
  | { type: 'error'; error: string };
