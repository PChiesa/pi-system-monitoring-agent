export interface Alert {
  severity: string;
  title: string;
  description: string;
  affectedComponents?: string[];
  recommendedAction: string;
  timestamp: string;
}

export interface Recommendation {
  category: string;
  component: string;
  recommendation: string;
  priority: string;
  dueWithinDays?: number;
  timestamp: string;
}

export class AlertManager {
  private alertLog: Alert[] = [];
  private recommendationLog: Recommendation[] = [];

  async send(alert: Alert): Promise<string> {
    this.alertLog.push(alert);
    console.log(`\n[ALERT ${alert.severity}] ${alert.title}`);
    console.log(`   ${alert.description}`);
    console.log(`   Action: ${alert.recommendedAction}\n`);

    // Production integrations:
    // - SCADA alarm via OPC-UA write-back
    // - Email via SMTP/SendGrid
    // - SMS via Twilio
    // - Log to PI AF Event Frame for compliance
    // - Push to rig dashboard WebSocket

    return `Alert sent at ${alert.timestamp}`;
  }

  async logRecommendation(rec: Recommendation): Promise<string> {
    this.recommendationLog.push(rec);
    console.log(`\n[REC ${rec.priority}] ${rec.component}: ${rec.recommendation}\n`);
    return `Recommendation logged at ${rec.timestamp}`;
  }

  getActiveAlerts(): Alert[] {
    return this.alertLog.slice(-50);
  }

  getRecommendations(): Recommendation[] {
    return this.recommendationLog.slice(-100);
  }
}
