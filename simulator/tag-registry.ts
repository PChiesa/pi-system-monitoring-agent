import { DEFAULT_TAGS } from './db/defaults.js';

export interface TagMeta {
  tagName: string;
  webId: string;
  unit: string;
  path: string;
}

function makeWebId(tagName: string): string {
  return 'SIM_' + Buffer.from(tagName).toString('base64url');
}

export class TagRegistry {
  private byTag = new Map<string, TagMeta>();
  private byWebId = new Map<string, TagMeta>();
  readonly dataArchive: string;

  constructor(dataArchive = 'SIMULATOR') {
    this.dataArchive = dataArchive;
  }

  /** Populate registry from pre-loaded tag data (DB or import). */
  loadFromDatabase(tags: Array<{ tagName: string; unit: string }>): void {
    for (const { tagName, unit } of tags) {
      if (this.byTag.has(tagName)) continue;
      const meta: TagMeta = {
        tagName,
        webId: makeWebId(tagName),
        unit,
        path: `\\\\${this.dataArchive}\\${tagName}`,
      };
      this.byTag.set(tagName, meta);
      this.byWebId.set(meta.webId, meta);
    }
  }

  /** Populate registry from the built-in default tag list (non-DB mode). */
  loadFromDefaults(): void {
    this.loadFromDatabase(
      Object.entries(DEFAULT_TAGS).map(([tagName, unit]) => ({ tagName, unit }))
    );
  }

  getByTagName(tagName: string): TagMeta | undefined {
    return this.byTag.get(tagName);
  }

  getByWebId(webId: string): TagMeta | undefined {
    return this.byWebId.get(webId);
  }

  /**
   * Look up by the path format sent by PIRestClient: \\\\DataArchive\\TagName
   */
  getByPath(pathParam: string): TagMeta | undefined {
    // PIRestClient sends: \\\\${dataArchive}\\${tagName}
    // URL-decoded, this arrives as: \\DataArchive\TagName
    // Strip leading backslashes and split
    const cleaned = pathParam.replace(/^\\+/, '');
    const sepIdx = cleaned.indexOf('\\');
    if (sepIdx === -1) return undefined;
    const tagName = cleaned.slice(sepIdx + 1);
    return this.byTag.get(tagName);
  }

  getAllMeta(): TagMeta[] {
    return [...this.byTag.values()];
  }

  getAllWebIds(): string[] {
    return [...this.byWebId.keys()];
  }

  /** Register a new tag at runtime. Throws if tagName already exists. */
  register(tagName: string, unit: string): TagMeta {
    if (this.byTag.has(tagName)) {
      throw new Error(`Tag "${tagName}" already exists`);
    }
    const meta: TagMeta = {
      tagName,
      webId: makeWebId(tagName),
      unit,
      path: `\\\\${this.dataArchive}\\${tagName}`,
    };
    this.byTag.set(tagName, meta);
    this.byWebId.set(meta.webId, meta);
    return meta;
  }

  /** Remove a tag at runtime. Returns false if tag not found. */
  unregister(tagName: string): boolean {
    const meta = this.byTag.get(tagName);
    if (!meta) return false;
    this.byTag.delete(tagName);
    this.byWebId.delete(meta.webId);
    return true;
  }

  get size(): number {
    return this.byTag.size;
  }
}
