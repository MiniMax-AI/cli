/**
 * Proxy-aware fetch wrapper.
 *
 * Node.js native fetch() does not respect HTTP_PROXY/HTTPS_PROXY environment
 * variables. This module provides a drop-in replacement that routes requests
 * through the configured proxy when present.
 *
 * Environment variables checked (in order of precedence):
 * - HTTPS_PROXY / https_proxy — for HTTPS requests
 * - HTTP_PROXY / http_proxy — for HTTP requests (or as fallback for HTTPS)
 * - NO_PROXY / no_proxy — comma-separated list of hosts to bypass
 */

import { ProxyAgent, fetch as undiciFetch, type Dispatcher } from 'undici';

/**
 * Get the proxy URL for a given request URL.
 * Returns undefined if no proxy should be used.
 */
function getProxyUrl(targetUrl: string): string | undefined {
  const url = new URL(targetUrl);
  const hostname = url.hostname.toLowerCase();

  // Check NO_PROXY
  const noProxy = process.env.NO_PROXY || process.env.no_proxy;
  if (noProxy) {
    const noProxyList = noProxy.split(',').map(h => h.trim().toLowerCase());
    for (const pattern of noProxyList) {
      if (!pattern) continue;
      // Handle wildcard patterns like *.example.com or .example.com
      if (pattern.startsWith('*.')) {
        const suffix = pattern.slice(1); // .example.com
        if (hostname.endsWith(suffix) || hostname === pattern.slice(2)) {
          return undefined;
        }
      } else if (pattern.startsWith('.')) {
        if (hostname.endsWith(pattern) || hostname === pattern.slice(1)) {
          return undefined;
        }
      } else if (hostname === pattern || hostname.endsWith('.' + pattern)) {
        return undefined;
      }
      // Special case: * means no proxy for anything
      if (pattern === '*') {
        return undefined;
      }
    }
  }

  // Select proxy based on protocol
  if (url.protocol === 'https:') {
    return process.env.HTTPS_PROXY || process.env.https_proxy ||
           process.env.HTTP_PROXY || process.env.http_proxy;
  }

  return process.env.HTTP_PROXY || process.env.http_proxy;
}

// Cache the proxy agent to avoid creating a new one for each request
let cachedProxyAgent: ProxyAgent | undefined;
let cachedProxyUrl: string | undefined;

function getProxyAgent(proxyUrl: string): ProxyAgent {
  if (cachedProxyAgent && cachedProxyUrl === proxyUrl) {
    return cachedProxyAgent;
  }
  cachedProxyAgent = new ProxyAgent(proxyUrl);
  cachedProxyUrl = proxyUrl;
  return cachedProxyAgent;
}

/**
 * Proxy-aware fetch function.
 * Drop-in replacement for global fetch() that respects HTTP_PROXY/HTTPS_PROXY.
 */
export async function proxyFetch(
  input: string | URL | Request,
  init?: RequestInit,
): Promise<Response> {
  const url = typeof input === 'string' ? input :
              input instanceof URL ? input.toString() :
              input.url;

  const proxyUrl = getProxyUrl(url);

  if (proxyUrl) {
    // Use undici fetch with proxy dispatcher
    const dispatcher = getProxyAgent(proxyUrl);
    // Cast through unknown because undici Response type differs slightly from global Response
    return undiciFetch(url, {
      ...init,
      dispatcher,
    } as Parameters<typeof undiciFetch>[1]) as unknown as Promise<Response>;
  }

  // No proxy configured, use native fetch
  return fetch(input, init);
}

/**
 * Check if proxy is configured for the current environment.
 */
export function isProxyConfigured(): boolean {
  return !!(
    process.env.HTTP_PROXY ||
    process.env.http_proxy ||
    process.env.HTTPS_PROXY ||
    process.env.https_proxy
  );
}

/**
 * Get the currently configured proxy URL (for debugging/logging).
 */
export function getConfiguredProxy(): string | undefined {
  return process.env.HTTPS_PROXY ||
         process.env.https_proxy ||
         process.env.HTTP_PROXY ||
         process.env.http_proxy;
}
