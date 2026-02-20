import { execSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

export interface TlsCredentials {
  key: string;
  cert: string;
}

export function generateSelfSignedCert(): TlsCredentials {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-sim-'));
  const keyPath = path.join(tmpDir, 'key.pem');
  const certPath = path.join(tmpDir, 'cert.pem');

  try {
    execSync(
      `openssl req -x509 -newkey rsa:2048 -keyout "${keyPath}" -out "${certPath}" ` +
        `-days 365 -nodes -subj "/CN=PI Web API Simulator" ` +
        `-addext "subjectAltName=DNS:localhost,IP:127.0.0.1" 2>/dev/null`,
      { stdio: 'pipe' }
    );

    const key = fs.readFileSync(keyPath, 'utf8');
    const cert = fs.readFileSync(certPath, 'utf8');
    return { key, cert };
  } finally {
    // Clean up temp files
    try {
      fs.unlinkSync(keyPath);
      fs.unlinkSync(certPath);
      fs.rmdirSync(tmpDir);
    } catch {
      // Ignore cleanup errors
    }
  }
}
