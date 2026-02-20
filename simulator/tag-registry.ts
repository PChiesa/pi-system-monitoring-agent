export interface TagMeta {
  tagName: string;
  webId: string;
  unit: string;
  path: string;
}

/**
 * All 25 monitored tags — duplicated from src/config.ts to avoid importing
 * production code (which pulls in dotenv and requires a .env file).
 */
const TAGS: Record<string, string> = {
  // Accumulator system
  'BOP.ACC.PRESS.SYS': 'PSI',
  'BOP.ACC.PRESS.PRCHG': 'PSI',
  'BOP.ACC.HYD.LEVEL': 'gal',
  'BOP.ACC.HYD.TEMP': '°F',

  // Annular preventer
  'BOP.ANN01.PRESS.CL': 'PSI',
  'BOP.ANN01.POS': '',
  'BOP.ANN01.CLOSETIME': 'sec',

  // Ram preventers
  'BOP.RAM.PIPE01.POS': '',
  'BOP.RAM.PIPE01.CLOSETIME': 'sec',
  'BOP.RAM.BSR01.POS': '',
  'BOP.RAM.BSR01.CLOSETIME': 'sec',

  // Manifold & lines
  'BOP.MAN.PRESS.REG': 'PSI',
  'BOP.CHOKE.PRESS': 'PSI',
  'BOP.KILL.PRESS': 'PSI',

  // Control system
  'BOP.CTRL.POD.BLUE.STATUS': '',
  'BOP.CTRL.POD.YELLOW.STATUS': '',
  'BOP.CTRL.BATT.BLUE.VOLTS': 'V',
  'BOP.CTRL.BATT.YELLOW.VOLTS': 'V',

  // Wellbore
  'WELL.PRESS.CASING': 'PSI',
  'WELL.PRESS.SPP': 'PSI',
  'WELL.FLOW.IN': 'GPM',
  'WELL.FLOW.OUT': 'GPM',
  'WELL.FLOW.DELTA': 'GPM',
  'WELL.PIT.VOL.TOTAL': 'bbl',
  'WELL.PIT.VOL.DELTA': 'bbl',
};

function makeWebId(tagName: string): string {
  return 'SIM_' + Buffer.from(tagName).toString('base64url');
}

export class TagRegistry {
  private byTag = new Map<string, TagMeta>();
  private byWebId = new Map<string, TagMeta>();
  readonly dataArchive: string;

  constructor(dataArchive = 'SIMULATOR') {
    this.dataArchive = dataArchive;

    for (const [tagName, unit] of Object.entries(TAGS)) {
      const meta: TagMeta = {
        tagName,
        webId: makeWebId(tagName),
        unit,
        path: `\\\\${dataArchive}\\${tagName}`,
      };
      this.byTag.set(tagName, meta);
      this.byWebId.set(meta.webId, meta);
    }
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

  get size(): number {
    return this.byTag.size;
  }
}
