import { EventEmitter } from 'events';
import { ThresholdRule } from './config.js';

interface SensorReading {
  value: number;
  timestamp: Date;
  good: boolean;
}

interface TagState {
  tag: string;
  webId: string;
  unit: string;
  currentValue: number;
  currentTimestamp: Date;
  good: boolean;
  history: SensorReading[];
  historyMaxSize: number;
}

export interface ThresholdBreach {
  tag: string;
  value: number;
  level: 'CRITICAL' | 'WARNING';
  type: 'low' | 'high' | 'rate_of_change';
  threshold: number;
  message: string;
}

export class SensorStateManager extends EventEmitter {
  private tags = new Map<string, TagState>();
  private webIdToTag = new Map<string, string>();
  private thresholds: ThresholdRule[] = [];
  private historySize: number;

  constructor(historySize = 300) {
    // 300 readings = 5 min at 1 Hz
    super();
    this.historySize = historySize;
  }

  registerTag(tag: string, webId: string, unit: string): void {
    this.tags.set(tag, {
      tag,
      webId,
      unit,
      currentValue: NaN,
      currentTimestamp: new Date(0),
      good: false,
      history: [],
      historyMaxSize: this.historySize,
    });
    this.webIdToTag.set(webId, tag);
  }

  setThresholds(rules: ThresholdRule[]): void {
    this.thresholds = rules;
  }

  /** Called on every PI channel value event */
  update(webId: string, value: number, timestamp: Date, good: boolean): void {
    const tag = this.webIdToTag.get(webId);
    if (!tag) return;
    const state = this.tags.get(tag);
    if (!state) return;

    state.currentValue = value;
    state.currentTimestamp = timestamp;
    state.good = good;

    // Ring buffer
    state.history.push({ value, timestamp, good });
    if (state.history.length > state.historyMaxSize) {
      state.history.shift();
    }

    this.evaluateThresholds(tag, value, state);
  }

  private evaluateThresholds(tag: string, value: number, state: TagState): void {
    const rule = this.thresholds.find((r) => r.tag === tag);
    if (!rule) return;

    // Static thresholds
    if (rule.criticalLow !== undefined && value < rule.criticalLow) {
      this.emitBreach(tag, value, 'CRITICAL', 'low', rule.criticalLow);
    } else if (rule.criticalHigh !== undefined && value > rule.criticalHigh) {
      this.emitBreach(tag, value, 'CRITICAL', 'high', rule.criticalHigh);
    } else if (rule.warningLow !== undefined && value < rule.warningLow) {
      this.emitBreach(tag, value, 'WARNING', 'low', rule.warningLow);
    } else if (rule.warningHigh !== undefined && value > rule.warningHigh) {
      this.emitBreach(tag, value, 'WARNING', 'high', rule.warningHigh);
    }

    // Rate of change check (over ~5 minute window)
    if (rule.rateOfChangePer5Min !== undefined && state.history.length >= 2) {
      const recent = state.history[state.history.length - 1];
      const fiveMinAgo = state.history.find(
        (r) => recent.timestamp.getTime() - r.timestamp.getTime() >= 270_000
      );
      if (fiveMinAgo) {
        const roc = Math.abs(recent.value - fiveMinAgo.value);
        if (roc > rule.rateOfChangePer5Min) {
          this.emitBreach(tag, value, 'WARNING', 'rate_of_change', rule.rateOfChangePer5Min);
        }
      }
    }
  }

  private emitBreach(
    tag: string,
    value: number,
    level: 'CRITICAL' | 'WARNING',
    type: 'low' | 'high' | 'rate_of_change',
    threshold: number
  ): void {
    const breach: ThresholdBreach = {
      tag,
      value,
      level,
      type,
      threshold,
      message: `${tag} = ${value} — ${type === 'rate_of_change' ? 'rate of change exceeds' : type === 'low' ? 'below' : 'above'} ${level.toLowerCase()} threshold ${threshold}`,
    };
    this.emit('threshold_breach', breach);
  }

  getCurrentValue(tag: string): Record<string, unknown> {
    const state = this.tags.get(tag);
    if (!state) return { error: `Unknown tag: ${tag}` };
    return {
      tag: state.tag,
      value: state.currentValue,
      timestamp: state.currentTimestamp.toISOString(),
      unit: state.unit,
      good: state.good,
    };
  }

  getWebId(tag: string): string | undefined {
    return this.tags.get(tag)?.webId;
  }

  getFullSnapshot(): Record<string, Record<string, unknown>> {
    const snapshot: Record<string, Record<string, unknown>> = {};
    for (const [tag, state] of this.tags) {
      snapshot[tag] = {
        value: state.currentValue,
        timestamp: state.currentTimestamp.toISOString(),
        unit: state.unit,
        good: state.good,
      };
    }
    return snapshot;
  }
}
