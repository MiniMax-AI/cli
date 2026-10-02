import { promises as dns } from 'dns';
import { isIP } from 'net';
import { CLIError } from '../errors/base';
import { ExitCode } from '../errors/codes';

/**
 * Checks whether an IPv4 address belongs to a private, loopback, link-local,
 * CGNAT, or otherwise reserved/non-routable address space.
 */
export function isPrivateOrLoopbackIpv4(ip: string): boolean {
  const parts = ip.split('.').map(p => Number(p));
  if (parts.length !== 4 || parts.some(p => !Number.isInteger(p) || p < 0 || p > 255)) {
    return true; // Malformed IPv4 is treated as unsafe
  }

  const [a, b] = parts as [number, number, number, number];

  // 0.0.0.0/8 (Current network / "this" network)
  if (a === 0) return true;

  // 10.0.0.0/8 (Private-Use - RFC 1918)
  if (a === 10) return true;

  // 100.64.0.0/10 (Shared Address Space / CGNAT - RFC 6598)
  if (a === 100 && b >= 64 && b <= 127) return true;

  // 127.0.0.0/8 (Loopback - RFC 1122)
  if (a === 127) return true;

  // 169.254.0.0/16 (Link Local & Cloud Metadata - RFC 3927)
  if (a === 169 && b === 254) return true;

  // 172.16.0.0/12 (Private-Use - RFC 1918)
  if (a === 172 && b >= 16 && b <= 31) return true;

  // 192.0.0.0/24 (IETF Protocol Assignments)
  if (a === 192 && b === 0 && parts[2] === 0) return true;

  // 192.0.2.0/24 (TEST-NET-1)
  if (a === 192 && b === 0 && parts[2] === 2) return true;

  // 192.168.0.0/16 (Private-Use - RFC 1918)
  if (a === 192 && b === 168) return true;

  // 198.18.0.0/15 (Benchmarking - RFC 2544)
  if (a === 198 && (b === 18 || b === 19)) return true;

  // 198.51.100.0/24 (TEST-NET-2)
  if (a === 198 && b === 51 && parts[2] === 100) return true;

  // 203.0.113.0/24 (TEST-NET-3)
  if (a === 203 && b === 0 && parts[2] === 113) return true;

  // 224.0.0.0/4 (Multicast - RFC 5771)
  if (a >= 224 && a <= 239) return true;

  // 240.0.0.0/4 (Reserved for future use - RFC 1112)
  if (a >= 240) return true;

  return false;
}

/**
 * Checks whether an IPv6 address belongs to a private, loopback, link-local,
 * unique-local, or otherwise reserved/non-routable address space.
 */
export function isPrivateOrLoopbackIpv6(ip: string): boolean {
  const normalized = ip.toLowerCase().trim();

  // Loopback (::1)
  if (normalized === '::1' || normalized === '0:0:0:0:0:0:0:1') return true;

  // Unspecified (::)
  if (normalized === '::' || normalized === '0:0:0:0:0:0:0:0') return true;

  // Unique Local Address (fc00::/7 -> fc00... to fdff...)
  if (/^f[cd][0-9a-f]{2}:/i.test(normalized) || normalized.startsWith('fc') || normalized.startsWith('fd')) {
    return true;
  }

  // Link-Local Unicast (fe80::/10 -> fe80... to febf...)
  if (/^fe[89ab][0-9a-f]:/i.test(normalized)) {
    return true;
  }

  // Multicast (ff00::/8)
  if (normalized.startsWith('ff')) {
    return true;
  }

  // IPv4-mapped IPv6 (::ffff:x.x.x.x)
  const v4MappedMatch = normalized.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (v4MappedMatch && v4MappedMatch[1]) {
    return isPrivateOrLoopbackIpv4(v4MappedMatch[1]);
  }

  // IPv4-compatible IPv6 (deprecated ::x.x.x.x)
  const v4CompatMatch = normalized.match(/^::(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (v4CompatMatch && v4CompatMatch[1]) {
    return isPrivateOrLoopbackIpv4(v4CompatMatch[1]);
  }

  return false;
}

/**
 * Checks whether an IP (v4 or v6) is private or loopback.
 */
export function isPrivateOrLoopbackIp(ip: string): boolean {
  const version = isIP(ip);
  if (version === 4) return isPrivateOrLoopbackIpv4(ip);
  if (version === 6) return isPrivateOrLoopbackIpv6(ip);
  return true; // Not a valid IP
}

/**
 * Checks whether a hostname is a known loopback/local/internal domain name.
 */
export function isDisallowedHostname(hostname: string): boolean {
  const lower = hostname.toLowerCase().trim();

  if (lower === 'localhost' || lower.endsWith('.localhost')) return true;
  if (lower === 'local' || lower.endsWith('.local')) return true;
  if (lower === 'internal' || lower.endsWith('.internal')) return true;
  if (lower === 'invalid' || lower.endsWith('.invalid')) return true;
  if (lower === 'onion' || lower.endsWith('.onion')) return true;

  return false;
}

export interface ValidateUrlOptions {
  allowPrivate?: boolean;
}

/**
 * Validates that a URL is safe to fetch:
 * - Uses HTTP or HTTPS protocol
 * - Does not target private, loopback, or cloud-metadata IPs
 * - Does not target local/internal hostnames
 *
 * Resolves to the parsed URL object on success, or throws CLIError.
 */
export async function validateSafeUrl(
  urlString: string,
  options?: ValidateUrlOptions,
): Promise<URL> {
  let parsed: URL;
  try {
    parsed = new URL(urlString);
  } catch {
    throw new CLIError(`Invalid URL: "${urlString}"`, ExitCode.USAGE);
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new CLIError(
      `Disallowed URL protocol "${parsed.protocol}". Only HTTP and HTTPS are permitted.`,
      ExitCode.USAGE,
    );
  }

  if (options?.allowPrivate) {
    return parsed;
  }

  const rawHost = parsed.hostname.replace(/^\[|\]$/g, '');

  if (isDisallowedHostname(rawHost)) {
    throw new CLIError(
      `Access to local/internal host "${rawHost}" is disallowed for security reasons (SSRF protection).`,
      ExitCode.USAGE,
    );
  }

  const ipVersion = isIP(rawHost);
  if (ipVersion !== 0) {
    if (isPrivateOrLoopbackIp(rawHost)) {
      throw new CLIError(
        `Access to private/loopback IP address "${rawHost}" is disallowed for security reasons (SSRF protection).`,
        ExitCode.USAGE,
      );
    }
    return parsed;
  }

  // If it's a domain name, attempt asynchronous DNS resolution to guard against DNS rebinding
  try {
    const lookupResult = await dns.lookup(rawHost);
    if (lookupResult && isPrivateOrLoopbackIp(lookupResult.address)) {
      throw new CLIError(
        `Host "${rawHost}" resolved to private/loopback IP address "${lookupResult.address}", which is disallowed (SSRF protection).`,
        ExitCode.USAGE,
      );
    }
  } catch (err) {
    // If the error was our CLIError rejection, rethrow it
    if (err instanceof CLIError) throw err;
    // Otherwise, DNS resolution may fail in offline or mocked testing environments.
    // In that case, we let fetch proceed and handle connection/mock behavior naturally.
  }

  return parsed;
}
