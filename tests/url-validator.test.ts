import { describe, it, expect } from 'bun:test';
import { validateServerUrl, validateUrlMatchesHost } from '../simulator/url-validator.js';

describe('validateServerUrl', () => {
  it('accepts valid HTTPS URLs', () => {
    expect(() => validateServerUrl('https://piserver.example.com')).not.toThrow();
    expect(() => validateServerUrl('https://piserver.example.com:8443')).not.toThrow();
    expect(() => validateServerUrl('https://10.0.5.100:443/piwebapi', { allowPrivate: true })).not.toThrow();
  });

  it('rejects invalid URLs', () => {
    expect(() => validateServerUrl('not-a-url')).toThrow('Invalid URL');
    expect(() => validateServerUrl('')).toThrow('Invalid URL');
  });

  it('rejects HTTP by default', () => {
    expect(() => validateServerUrl('http://piserver.example.com')).toThrow('Blocked protocol');
  });

  it('allows HTTP when opt-in', () => {
    expect(() => validateServerUrl('http://piserver.example.com', { allowHttp: true })).not.toThrow();
  });

  it('rejects non-HTTP(S) protocols', () => {
    expect(() => validateServerUrl('ftp://piserver.example.com')).toThrow('Blocked protocol');
    expect(() => validateServerUrl('file:///etc/passwd')).toThrow('Blocked protocol');
    expect(() => validateServerUrl('javascript:alert(1)', { allowHttp: true })).toThrow('Blocked protocol');
  });

  it('blocks localhost', () => {
    expect(() => validateServerUrl('https://localhost')).toThrow('Blocked hostname');
    expect(() => validateServerUrl('https://localhost:8443')).toThrow('Blocked hostname');
    expect(() => validateServerUrl('https://localhost.localdomain')).toThrow('Blocked hostname');
  });

  it('blocks loopback IPs (127.x.x.x)', () => {
    expect(() => validateServerUrl('https://127.0.0.1')).toThrow('Blocked private IP');
    expect(() => validateServerUrl('https://127.0.0.1:5432')).toThrow('Blocked private IP');
    expect(() => validateServerUrl('https://127.1.2.3')).toThrow('Blocked private IP');
  });

  it('blocks 10.x.x.x private range', () => {
    expect(() => validateServerUrl('https://10.0.0.1')).toThrow('Blocked private IP');
    expect(() => validateServerUrl('https://10.255.255.255')).toThrow('Blocked private IP');
  });

  it('blocks 172.16-31.x.x private range', () => {
    expect(() => validateServerUrl('https://172.16.0.1')).toThrow('Blocked private IP');
    expect(() => validateServerUrl('https://172.31.255.255')).toThrow('Blocked private IP');
  });

  it('allows 172.32.x.x (not in private range)', () => {
    expect(() => validateServerUrl('https://172.32.0.1')).not.toThrow();
  });

  it('blocks 192.168.x.x private range', () => {
    expect(() => validateServerUrl('https://192.168.1.1')).toThrow('Blocked private IP');
    expect(() => validateServerUrl('https://192.168.0.100')).toThrow('Blocked private IP');
  });

  it('blocks 169.254.x.x link-local range', () => {
    expect(() => validateServerUrl('https://169.254.169.254')).toThrow('Blocked private IP');
  });

  it('blocks 0.0.0.0', () => {
    expect(() => validateServerUrl('https://0.0.0.0')).toThrow('Blocked private IP');
  });

  it('blocks IPv6 loopback', () => {
    expect(() => validateServerUrl('https://[::1]')).toThrow('Blocked address');
    expect(() => validateServerUrl('https://[::1]:8443')).toThrow('Blocked address');
  });

  it('allows private IPs when allowPrivate is true', () => {
    expect(() => validateServerUrl('https://localhost', { allowPrivate: true })).not.toThrow();
    expect(() => validateServerUrl('https://127.0.0.1', { allowPrivate: true })).not.toThrow();
    expect(() => validateServerUrl('https://192.168.1.1', { allowPrivate: true })).not.toThrow();
  });
});

describe('validateUrlMatchesHost', () => {
  it('accepts matching hostnames', () => {
    expect(() =>
      validateUrlMatchesHost('https://piserver.example.com/piwebapi/points/abc', 'https://piserver.example.com/piwebapi')
    ).not.toThrow();
  });

  it('accepts matching hostnames (case insensitive)', () => {
    expect(() =>
      validateUrlMatchesHost('https://PIServer.Example.COM/path', 'https://piserver.example.com/piwebapi')
    ).not.toThrow();
  });

  it('rejects mismatched hostnames', () => {
    expect(() =>
      validateUrlMatchesHost('https://evil.com/piwebapi/points/abc', 'https://piserver.example.com/piwebapi')
    ).toThrow('does not match');
  });

  it('rejects redirect to internal host', () => {
    expect(() =>
      validateUrlMatchesHost('https://127.0.0.1/admin', 'https://piserver.example.com/piwebapi')
    ).toThrow('does not match');
  });

  it('rejects invalid URL', () => {
    expect(() => validateUrlMatchesHost('not-a-url', 'https://piserver.example.com')).toThrow('Invalid URL');
  });
});
