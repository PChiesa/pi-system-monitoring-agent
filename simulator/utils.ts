import http from 'http';

const DEFAULT_MAX_BODY_BYTES = 1_048_576; // 1 MB

export function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

export function readBody(
  req: http.IncomingMessage,
  res: http.ServerResponse | null,
  cb: (body: string) => void,
  maxBytes = DEFAULT_MAX_BODY_BYTES
): void {
  let body = '';
  let bytes = 0;
  let aborted = false;

  req.on('data', (chunk: Buffer | string) => {
    if (aborted) return;
    bytes += typeof chunk === 'string' ? Buffer.byteLength(chunk) : chunk.length;
    if (bytes > maxBytes) {
      aborted = true;
      req.destroy();
      if (res && !res.headersSent) {
        sendJson(res, 413, { error: `Request body too large (max ${maxBytes} bytes)` });
      }
      return;
    }
    body += chunk;
  });

  req.on('end', () => {
    if (!aborted) cb(body);
  });
}
