import { jest } from '@jest/globals';
import { SensorStateManager, ThresholdBreach } from '../src/sensor-state';
import { ThresholdRule } from '../src/config';

describe('SensorStateManager', () => {
  let manager: SensorStateManager;

  beforeEach(() => {
    manager = new SensorStateManager(10);
  });

  describe('registerTag / getCurrentValue / getWebId', () => {
    it('returns error for unknown tag', () => {
      const result = manager.getCurrentValue('UNKNOWN');
      expect(result).toEqual({ error: 'Unknown tag: UNKNOWN' });
    });

    it('registers a tag with initial NaN value', () => {
      manager.registerTag('BOP.ACC.PRESS.SYS', 'webId1', 'PSI');
      const result = manager.getCurrentValue('BOP.ACC.PRESS.SYS');
      expect(result.tag).toBe('BOP.ACC.PRESS.SYS');
      expect(result.value).toBeNaN();
      expect(result.unit).toBe('PSI');
      expect(result.good).toBe(false);
    });

    it('resolves webId for registered tag', () => {
      manager.registerTag('BOP.ACC.PRESS.SYS', 'webId1', 'PSI');
      expect(manager.getWebId('BOP.ACC.PRESS.SYS')).toBe('webId1');
    });

    it('returns undefined webId for unknown tag', () => {
      expect(manager.getWebId('UNKNOWN')).toBeUndefined();
    });
  });

  describe('update', () => {
    it('updates current value via webId lookup', () => {
      manager.registerTag('BOP.ACC.PRESS.SYS', 'webId1', 'PSI');
      const ts = new Date('2025-01-01T00:00:00Z');
      manager.update('webId1', 3000, ts, true);

      const result = manager.getCurrentValue('BOP.ACC.PRESS.SYS');
      expect(result.value).toBe(3000);
      expect(result.timestamp).toBe(ts.toISOString());
      expect(result.good).toBe(true);
    });

    it('ignores updates for unknown webIds', () => {
      manager.registerTag('BOP.ACC.PRESS.SYS', 'webId1', 'PSI');
      manager.update('unknownWebId', 9999, new Date(), true);
      const result = manager.getCurrentValue('BOP.ACC.PRESS.SYS');
      expect(result.value).toBeNaN();
    });

    it('maintains ring buffer up to historySize', () => {
      manager = new SensorStateManager(3);
      manager.registerTag('TAG', 'wid', 'PSI');

      for (let i = 1; i <= 5; i++) {
        manager.update('wid', i * 100, new Date(i * 1000), true);
      }

      // Buffer should contain only the last 3 values
      const snapshot = manager.getCurrentValue('TAG');
      expect(snapshot.value).toBe(500);
    });
  });

  describe('getFullSnapshot', () => {
    it('returns snapshot of all registered tags', () => {
      manager.registerTag('TAG1', 'w1', 'PSI');
      manager.registerTag('TAG2', 'w2', 'GPM');
      manager.update('w1', 100, new Date('2025-01-01T00:00:00Z'), true);
      manager.update('w2', 50, new Date('2025-01-01T00:01:00Z'), false);

      const snapshot = manager.getFullSnapshot();
      expect(Object.keys(snapshot)).toEqual(['TAG1', 'TAG2']);
      expect(snapshot['TAG1'].value).toBe(100);
      expect(snapshot['TAG1'].unit).toBe('PSI');
      expect(snapshot['TAG1'].good).toBe(true);
      expect(snapshot['TAG2'].value).toBe(50);
      expect(snapshot['TAG2'].good).toBe(false);
    });

    it('returns empty snapshot when no tags registered', () => {
      const snapshot = manager.getFullSnapshot();
      expect(snapshot).toEqual({});
    });
  });

  describe('threshold evaluation — static thresholds', () => {
    const rules: ThresholdRule[] = [
      {
        tag: 'BOP.ACC.PRESS.SYS',
        warningLow: 2200,
        criticalLow: 1200,
      },
      {
        tag: 'BOP.ACC.HYD.TEMP',
        warningHigh: 150,
        criticalHigh: 180,
      },
      {
        tag: 'BOP.MAN.PRESS.REG',
        warningLow: 1400,
        warningHigh: 1600,
        criticalLow: 1300,
        criticalHigh: 1700,
      },
    ];

    beforeEach(() => {
      manager.registerTag('BOP.ACC.PRESS.SYS', 'w1', 'PSI');
      manager.registerTag('BOP.ACC.HYD.TEMP', 'w2', '°F');
      manager.registerTag('BOP.MAN.PRESS.REG', 'w3', 'PSI');
      manager.setThresholds(rules);
    });

    it('emits CRITICAL low breach', (done) => {
      manager.on('threshold_breach', (breach: ThresholdBreach) => {
        expect(breach.tag).toBe('BOP.ACC.PRESS.SYS');
        expect(breach.level).toBe('CRITICAL');
        expect(breach.type).toBe('low');
        expect(breach.threshold).toBe(1200);
        expect(breach.value).toBe(1100);
        expect(breach.message).toContain('below');
        done();
      });
      manager.update('w1', 1100, new Date(), true);
    });

    it('emits WARNING low breach (not critical)', (done) => {
      manager.on('threshold_breach', (breach: ThresholdBreach) => {
        expect(breach.level).toBe('WARNING');
        expect(breach.type).toBe('low');
        expect(breach.threshold).toBe(2200);
        done();
      });
      manager.update('w1', 2100, new Date(), true);
    });

    it('emits CRITICAL high breach', (done) => {
      manager.on('threshold_breach', (breach: ThresholdBreach) => {
        expect(breach.level).toBe('CRITICAL');
        expect(breach.type).toBe('high');
        expect(breach.threshold).toBe(180);
        done();
      });
      manager.update('w2', 185, new Date(), true);
    });

    it('emits WARNING high breach', (done) => {
      manager.on('threshold_breach', (breach: ThresholdBreach) => {
        expect(breach.level).toBe('WARNING');
        expect(breach.type).toBe('high');
        expect(breach.threshold).toBe(150);
        done();
      });
      manager.update('w2', 155, new Date(), true);
    });

    it('does not emit breach for normal values', () => {
      const handler = jest.fn();
      manager.on('threshold_breach', handler);
      manager.update('w1', 2500, new Date(), true);
      expect(handler).not.toHaveBeenCalled();
    });

    it('does not emit breach for tags without threshold rules', () => {
      manager.registerTag('NO.RULE.TAG', 'w9', 'PSI');
      const handler = jest.fn();
      manager.on('threshold_breach', handler);
      manager.update('w9', 0, new Date(), true);
      expect(handler).not.toHaveBeenCalled();
    });

    it('critical takes precedence over warning on the same side', (done) => {
      // Value 1250 is below criticalLow=1200? No, 1250 > 1200 so only warningLow fires.
      // Value 1100 is below criticalLow=1200, so critical fires.
      manager.on('threshold_breach', (breach: ThresholdBreach) => {
        expect(breach.level).toBe('CRITICAL');
        done();
      });
      manager.update('w1', 1100, new Date(), true);
    });

    it('handles bidirectional thresholds (manifold pressure)', () => {
      const breaches: ThresholdBreach[] = [];
      manager.on('threshold_breach', (b: ThresholdBreach) => breaches.push(b));

      // Below critical low
      manager.update('w3', 1250, new Date(), true);
      expect(breaches[0].level).toBe('CRITICAL');
      expect(breaches[0].type).toBe('low');

      // Above critical high
      manager.update('w3', 1750, new Date(), true);
      expect(breaches[1].level).toBe('CRITICAL');
      expect(breaches[1].type).toBe('high');

      // Warning low range
      manager.update('w3', 1350, new Date(), true);
      expect(breaches[2].level).toBe('WARNING');
      expect(breaches[2].type).toBe('low');

      // Warning high range
      manager.update('w3', 1650, new Date(), true);
      expect(breaches[3].level).toBe('WARNING');
      expect(breaches[3].type).toBe('high');
    });
  });

  describe('threshold evaluation — rate of change', () => {
    it('emits rate_of_change breach when delta exceeds threshold over 5 min', () => {
      const rule: ThresholdRule = {
        tag: 'BOP.ACC.PRESS.SYS',
        rateOfChangePer5Min: 200,
      };
      manager.registerTag('BOP.ACC.PRESS.SYS', 'w1', 'PSI');
      manager.setThresholds([rule]);

      const breaches: ThresholdBreach[] = [];
      manager.on('threshold_breach', (b: ThresholdBreach) => breaches.push(b));

      const baseTime = Date.now();

      // Initial reading
      manager.update('w1', 3000, new Date(baseTime), true);

      // Reading 5 minutes later with >200 PSI drop
      manager.update('w1', 2700, new Date(baseTime + 300_000), true);

      expect(breaches.length).toBe(1);
      expect(breaches[0].type).toBe('rate_of_change');
      expect(breaches[0].threshold).toBe(200);
    });

    it('does not emit rate_of_change when window is too short', () => {
      const rule: ThresholdRule = {
        tag: 'BOP.ACC.PRESS.SYS',
        rateOfChangePer5Min: 200,
      };
      manager.registerTag('BOP.ACC.PRESS.SYS', 'w1', 'PSI');
      manager.setThresholds([rule]);

      const handler = jest.fn();
      manager.on('threshold_breach', handler);

      const baseTime = Date.now();
      manager.update('w1', 3000, new Date(baseTime), true);
      // Only 2 minutes later — below the 270s window
      manager.update('w1', 2700, new Date(baseTime + 120_000), true);

      expect(handler).not.toHaveBeenCalled();
    });

    it('does not emit rate_of_change when delta is within threshold', () => {
      const rule: ThresholdRule = {
        tag: 'BOP.ACC.PRESS.SYS',
        rateOfChangePer5Min: 200,
      };
      manager.registerTag('BOP.ACC.PRESS.SYS', 'w1', 'PSI');
      manager.setThresholds([rule]);

      const handler = jest.fn();
      manager.on('threshold_breach', handler);

      const baseTime = Date.now();
      manager.update('w1', 3000, new Date(baseTime), true);
      manager.update('w1', 2850, new Date(baseTime + 300_000), true);

      expect(handler).not.toHaveBeenCalled();
    });
  });
});
