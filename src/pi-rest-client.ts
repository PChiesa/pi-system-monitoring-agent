import axios, { AxiosInstance } from 'axios';
import https from 'https';

export class PIRestClient {
  private client: AxiosInstance;

  constructor(server: string, username: string, password: string) {
    this.client = axios.create({
      baseURL: `https://${server}/piwebapi`,
      auth: { username, password },
      headers: { 'X-Requested-With': 'XMLHttpRequest' },
      httpsAgent: new https.Agent({ rejectUnauthorized: false }),
    });
  }

  async getPointWebId(dataArchive: string, tagName: string): Promise<string> {
    const path = `\\\\${dataArchive}\\${tagName}`;
    const res = await this.client.get('/points', { params: { path } });
    return res.data.WebId;
  }

  async getStreamValue(webId: string): Promise<any> {
    const res = await this.client.get(`/streams/${webId}/value`);
    return res.data;
  }

  async getRecordedValues(
    webId: string,
    startTime: string = '*-1h',
    endTime: string = '*',
    maxCount: number = 100
  ): Promise<any[]> {
    const res = await this.client.get(`/streams/${webId}/recorded`, {
      params: { startTime, endTime, maxCount },
    });
    return res.data.Items;
  }

  async resolveTagsToWebIds(
    dataArchive: string,
    tagNames: string[]
  ): Promise<Map<string, string>> {
    const map = new Map<string, string>();
    for (const tag of tagNames) {
      try {
        const webId = await this.getPointWebId(dataArchive, tag);
        map.set(tag, webId);
      } catch (err: any) {
        console.warn(`Failed to resolve tag "${tag}": ${err.message}`);
      }
    }
    return map;
  }
}
