import http from 'http';

export function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

export function readBody(req: http.IncomingMessage, cb: (body: string) => void): void {
  let body = '';
  req.on('data', (chunk: string) => (body += chunk));
  req.on('end', () => cb(body));
}
