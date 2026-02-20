import { jest } from '@jest/globals';

const mockGet = jest.fn<(...args: any[]) => any>();

jest.unstable_mockModule('axios', () => ({
  __esModule: true,
  default: {
    create: jest.fn(() => ({ get: mockGet })),
  },
}));

const { PIRestClient } = await import('../src/pi-rest-client');

describe('PIRestClient', () => {
  let piRest: InstanceType<typeof PIRestClient>;

  beforeEach(() => {
    piRest = new PIRestClient('piwebapi.example.com', 'user', 'pass');
    jest.clearAllMocks();
  });

  describe('getPointWebId', () => {
    it('returns WebId for a tag', async () => {
      mockGet.mockResolvedValue({ data: { WebId: 'ABC123' } });

      const webId = await piRest.getPointWebId('PISRV01', 'BOP.ACC.PRESS.SYS');

      expect(webId).toBe('ABC123');
      expect(mockGet).toHaveBeenCalledWith('/points', {
        params: { path: '\\\\PISRV01\\BOP.ACC.PRESS.SYS' },
      });
    });

    it('throws on API error', async () => {
      mockGet.mockRejectedValue(new Error('404 Not Found'));

      await expect(
        piRest.getPointWebId('PISRV01', 'INVALID.TAG')
      ).rejects.toThrow('404 Not Found');
    });
  });

  describe('getStreamValue', () => {
    it('returns stream value data', async () => {
      const mockData = {
        Timestamp: '2025-01-01T00:00:00Z',
        Value: 3000,
        Good: true,
      };
      mockGet.mockResolvedValue({ data: mockData });

      const result = await piRest.getStreamValue('WEBID1');

      expect(result).toEqual(mockData);
      expect(mockGet).toHaveBeenCalledWith('/streams/WEBID1/value');
    });
  });

  describe('getRecordedValues', () => {
    it('returns recorded values with default params', async () => {
      const items = [
        { Timestamp: 'T1', Value: 3000 },
        { Timestamp: 'T2', Value: 2950 },
      ];
      mockGet.mockResolvedValue({ data: { Items: items } });

      const result = await piRest.getRecordedValues('WEBID1');

      expect(result).toEqual(items);
      expect(mockGet).toHaveBeenCalledWith('/streams/WEBID1/recorded', {
        params: { startTime: '*-1h', endTime: '*', maxCount: 100 },
      });
    });

    it('passes custom time range and maxCount', async () => {
      mockGet.mockResolvedValue({ data: { Items: [] } });

      await piRest.getRecordedValues('WEBID1', '*-24h', '*-1h', 50);

      expect(mockGet).toHaveBeenCalledWith('/streams/WEBID1/recorded', {
        params: { startTime: '*-24h', endTime: '*-1h', maxCount: 50 },
      });
    });
  });

  describe('resolveTagsToWebIds', () => {
    it('resolves multiple tags to webIds', async () => {
      mockGet
        .mockResolvedValueOnce({ data: { WebId: 'W1' } })
        .mockResolvedValueOnce({ data: { WebId: 'W2' } });

      const map = await piRest.resolveTagsToWebIds('PISRV01', ['TAG1', 'TAG2']);

      expect(map.size).toBe(2);
      expect(map.get('TAG1')).toBe('W1');
      expect(map.get('TAG2')).toBe('W2');
    });

    it('skips tags that fail to resolve', async () => {
      jest.spyOn(console, 'warn').mockImplementation((() => {}) as any);

      mockGet
        .mockResolvedValueOnce({ data: { WebId: 'W1' } })
        .mockRejectedValueOnce(new Error('Not found'))
        .mockResolvedValueOnce({ data: { WebId: 'W3' } });

      const map = await piRest.resolveTagsToWebIds('PISRV01', [
        'TAG1',
        'BAD_TAG',
        'TAG3',
      ]);

      expect(map.size).toBe(2);
      expect(map.get('TAG1')).toBe('W1');
      expect(map.has('BAD_TAG')).toBe(false);
      expect(map.get('TAG3')).toBe('W3');
      expect(console.warn).toHaveBeenCalledWith(
        expect.stringContaining('Failed to resolve tag "BAD_TAG"')
      );
    });

    it('returns empty map for empty tag list', async () => {
      const map = await piRest.resolveTagsToWebIds('PISRV01', []);
      expect(map.size).toBe(0);
    });
  });
});
