import { describe, it, expect, spyOn } from 'bun:test';
import { EventEmitter } from 'events';
import http from 'http';
import { readBody, sendJson } from '../simulator/utils.js';

function createMockRequest(): http.IncomingMessage {
  const emitter = new EventEmitter() as any;
  emitter.destroy = () => {};
  return emitter as http.IncomingMessage;
}

function createMockResponse(): http.ServerResponse {
  const res = new EventEmitter() as any;
  res.headersSent = false;
  res.writeHead = () => res;
  res.end = () => {};
  return res as http.ServerResponse;
}

describe('readBody', () => {
  it('reads body data', (done) => {
    const req = createMockRequest();
    readBody(req, null, (body) => {
      expect(body).toBe('hello world');
      done();
    });
    req.emit('data', 'hello ');
    req.emit('data', 'world');
    req.emit('end');
  });

  it('enforces body size limit and sends 413', (done) => {
    const req = createMockRequest();
    const res = createMockResponse();
    const writeHeadSpy = spyOn(res, 'writeHead').mockReturnValue(res);
    const endSpy = spyOn(res, 'end');
    const destroySpy = spyOn(req, 'destroy');

    let callbackCalled = false;
    readBody(req, res, () => { callbackCalled = true; }, 10);

    req.emit('data', 'AAAAAAAAAAAAA'); // 13 bytes > 10 limit

    // Give it a tick for the destroy/response to happen
    setTimeout(() => {
      expect(destroySpy).toHaveBeenCalled();
      expect(writeHeadSpy).toHaveBeenCalledWith(413, { 'Content-Type': 'application/json' });
      expect(callbackCalled).toBe(false);
      done();
    }, 10);
  });

  it('does not call callback when body exceeds limit', (done) => {
    const req = createMockRequest();
    let callbackCalled = false;

    readBody(req, null, () => { callbackCalled = true; }, 5);

    req.emit('data', 'ABCDEFGHIJ'); // 10 bytes > 5 limit
    req.emit('end');

    setTimeout(() => {
      expect(callbackCalled).toBe(false);
      done();
    }, 10);
  });

  it('allows body within size limit', (done) => {
    const req = createMockRequest();
    readBody(req, null, (body) => {
      expect(body).toBe('OK');
      done();
    }, 100);

    req.emit('data', 'OK');
    req.emit('end');
  });
});
