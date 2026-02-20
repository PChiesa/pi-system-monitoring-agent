import { describe, it, expect, beforeEach, afterEach, jest, spyOn } from 'bun:test';
import { AlertManager, Alert, Recommendation } from '../src/alert-manager';

describe('AlertManager', () => {
  let alertManager: AlertManager;

  beforeEach(() => {
    alertManager = new AlertManager();
    spyOn(console, 'log').mockImplementation((() => {}) as any);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('send', () => {
    it('stores alert and returns confirmation string', async () => {
      const alert: Alert = {
        severity: 'CRITICAL',
        title: 'Low accumulator pressure',
        description: 'System pressure dropped below MOP',
        affectedComponents: ['Accumulator'],
        recommendedAction: 'Check hydraulic system for leaks',
        timestamp: '2025-01-01T00:00:00.000Z',
      };

      const result = await alertManager.send(alert);
      expect(result).toBe('Alert sent at 2025-01-01T00:00:00.000Z');
      expect(alertManager.getActiveAlerts()).toHaveLength(1);
      expect(alertManager.getActiveAlerts()[0]).toEqual(alert);
    });

    it('logs alert to console', async () => {
      const alert: Alert = {
        severity: 'WARNING',
        title: 'Test alert',
        description: 'Test description',
        recommendedAction: 'Test action',
        timestamp: '2025-01-01T00:00:00.000Z',
      };

      await alertManager.send(alert);
      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('[ALERT WARNING]')
      );
    });

    it('caps active alerts at 50', async () => {
      for (let i = 0; i < 60; i++) {
        await alertManager.send({
          severity: 'INFO',
          title: `Alert ${i}`,
          description: `Desc ${i}`,
          recommendedAction: 'None',
          timestamp: new Date(i * 1000).toISOString(),
        });
      }

      const active = alertManager.getActiveAlerts();
      expect(active).toHaveLength(50);
      expect(active[0].title).toBe('Alert 10');
      expect(active[49].title).toBe('Alert 59');
    });
  });

  describe('logRecommendation', () => {
    it('stores recommendation and returns confirmation', async () => {
      const rec: Recommendation = {
        category: 'MAINTENANCE',
        component: 'Annular Preventer #1',
        recommendation: 'Inspect sealing element',
        priority: 'HIGH',
        dueWithinDays: 7,
        timestamp: '2025-01-01T00:00:00.000Z',
      };

      const result = await alertManager.logRecommendation(rec);
      expect(result).toBe('Recommendation logged at 2025-01-01T00:00:00.000Z');
      expect(alertManager.getRecommendations()).toHaveLength(1);
      expect(alertManager.getRecommendations()[0]).toEqual(rec);
    });

    it('caps recommendations at 100', async () => {
      for (let i = 0; i < 110; i++) {
        await alertManager.logRecommendation({
          category: 'TESTING',
          component: `Component ${i}`,
          recommendation: `Rec ${i}`,
          priority: 'LOW',
          timestamp: new Date(i * 1000).toISOString(),
        });
      }

      const recs = alertManager.getRecommendations();
      expect(recs).toHaveLength(100);
      expect(recs[0].component).toBe('Component 10');
      expect(recs[99].component).toBe('Component 109');
    });
  });

  describe('getActiveAlerts / getRecommendations', () => {
    it('returns empty arrays initially', () => {
      expect(alertManager.getActiveAlerts()).toEqual([]);
      expect(alertManager.getRecommendations()).toEqual([]);
    });
  });
});
