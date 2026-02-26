/**
 * URL validation utilities for SSRF protection.
 *
 * Prevents the import handler from being used to reach internal network services
 * by blocking private/reserved IP ranges and enforcing protocol restrictions.
 */

const PRIVATE_IP_PATTERNS = [
  /^127\./,                             // 127.0.0.0/8 loopback
  /^10\./,                              // 10.0.0.0/8 private
  /^172\.(1[6-9]|2[0-9]|3[01])\./,     // 172.16.0.0/12 private
  /^192\.168\./,                        // 192.168.0.0/16 private
  /^169\.254\./,                        // 169.254.0.0/16 link-local
  /^0\./,                               // 0.0.0.0/8
  /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./, // 100.64.0.0/10 shared address space
];

const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'localhost.localdomain',
  'ip6-localhost',
  'ip6-loopback',
]);

/** Check whether a hostname resolves to a blocked IPv6 address. */
function isBlockedIPv6(hostname: string): boolean {
  // Strip brackets from IPv6 literals like [::1]
  const bare = hostname.replace(/^\[|\]$/g, '');
  return bare === '::1' || bare === '::' || bare === '0:0:0:0:0:0:0:1' || bare === '0:0:0:0:0:0:0:0';
}

function isPrivateIP(hostname: string): boolean {
  return PRIVATE_IP_PATTERNS.some((p) => p.test(hostname));
}

export interface ValidateUrlOptions {
  /** Allow http: in addition to https:. Default false. */
  allowHttp?: boolean;
  /** Allow private/internal IPs (for testing). Default false. */
  allowPrivate?: boolean;
}

/**
 * Validate a server URL for safety before connecting.
 * Throws an Error if the URL is invalid or targets a blocked address.
 */
export function validateServerUrl(url: string, opts: ValidateUrlOptions = {}): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Invalid URL: ${url}`);
  }

  // Protocol check
  const allowedProtocols = opts.allowHttp ? ['https:', 'http:'] : ['https:'];
  if (!allowedProtocols.includes(parsed.protocol)) {
    throw new Error(`Blocked protocol "${parsed.protocol}" — only ${allowedProtocols.join(', ')} allowed`);
  }

  if (opts.allowPrivate) return;

  const hostname = parsed.hostname.toLowerCase();

  // Blocked hostnames
  if (BLOCKED_HOSTNAMES.has(hostname)) {
    throw new Error(`Blocked hostname "${hostname}" — connections to local addresses are not allowed`);
  }

  // IPv6 check
  if (isBlockedIPv6(hostname)) {
    throw new Error(`Blocked address "${hostname}" — connections to loopback addresses are not allowed`);
  }

  // Private IP check
  if (isPrivateIP(hostname)) {
    throw new Error(`Blocked private IP "${hostname}" — connections to internal networks are not allowed`);
  }
}

/**
 * Validate that a URL's hostname matches an expected server URL.
 * Used to prevent SSRF via redirected Links.Point URLs from a remote PI server.
 * Throws an Error if the hostnames don't match.
 */
export function validateUrlMatchesHost(url: string, expectedServerUrl: string): void {
  let parsedUrl: URL;
  let parsedExpected: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    throw new Error(`Invalid URL: ${url}`);
  }
  try {
    parsedExpected = new URL(expectedServerUrl);
  } catch {
    throw new Error(`Invalid expected server URL: ${expectedServerUrl}`);
  }

  if (parsedUrl.hostname.toLowerCase() !== parsedExpected.hostname.toLowerCase()) {
    throw new Error(
      `URL hostname "${parsedUrl.hostname}" does not match expected server "${parsedExpected.hostname}" — possible SSRF attempt`
    );
  }
}
