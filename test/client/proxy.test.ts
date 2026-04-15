import { describe, it, expect, beforeEach, afterEach } from 'bun:test';

// Test the proxy URL resolution logic without actually making network requests
describe('proxy module', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    // Clear all proxy-related env vars before each test
    delete process.env.HTTP_PROXY;
    delete process.env.http_proxy;
    delete process.env.HTTPS_PROXY;
    delete process.env.https_proxy;
    delete process.env.NO_PROXY;
    delete process.env.no_proxy;
  });

  afterEach(() => {
    // Restore original environment
    process.env = { ...originalEnv };
  });

  describe('getProxyUrl logic', () => {
    // We can't easily test getProxyUrl directly since it's not exported,
    // but we can test the behavior through isProxyConfigured and getConfiguredProxy

    it('detects no proxy when env vars are not set', async () => {
      const { isProxyConfigured } = await import('../../src/client/proxy');
      expect(isProxyConfigured()).toBe(false);
    });

    it('detects proxy when HTTP_PROXY is set', async () => {
      process.env.HTTP_PROXY = 'http://proxy.example.com:8080';

      // Re-import to pick up the new env
      const mod = await import('../../src/client/proxy');
      expect(mod.isProxyConfigured()).toBe(true);
      expect(mod.getConfiguredProxy()).toBe('http://proxy.example.com:8080');
    });

    it('detects proxy when HTTPS_PROXY is set', async () => {
      process.env.HTTPS_PROXY = 'http://secure-proxy.example.com:8443';

      const mod = await import('../../src/client/proxy');
      expect(mod.isProxyConfigured()).toBe(true);
      expect(mod.getConfiguredProxy()).toBe('http://secure-proxy.example.com:8443');
    });

    it('prefers HTTPS_PROXY over HTTP_PROXY', async () => {
      process.env.HTTP_PROXY = 'http://http-proxy.example.com:8080';
      process.env.HTTPS_PROXY = 'http://https-proxy.example.com:8443';

      const mod = await import('../../src/client/proxy');
      expect(mod.getConfiguredProxy()).toBe('http://https-proxy.example.com:8443');
    });

    it('detects lowercase http_proxy', async () => {
      process.env.http_proxy = 'http://lowercase-proxy.example.com:8080';

      const mod = await import('../../src/client/proxy');
      expect(mod.isProxyConfigured()).toBe(true);
      expect(mod.getConfiguredProxy()).toBe('http://lowercase-proxy.example.com:8080');
    });

    it('detects lowercase https_proxy', async () => {
      process.env.https_proxy = 'http://lowercase-https-proxy.example.com:8443';

      const mod = await import('../../src/client/proxy');
      expect(mod.isProxyConfigured()).toBe(true);
      expect(mod.getConfiguredProxy()).toBe('http://lowercase-https-proxy.example.com:8443');
    });
  });

  describe('NO_PROXY handling', () => {
    // These tests verify the NO_PROXY logic conceptually
    // The actual bypass happens inside proxyFetch

    it('recognizes NO_PROXY environment variable', async () => {
      process.env.HTTP_PROXY = 'http://proxy.example.com:8080';
      process.env.NO_PROXY = 'localhost,127.0.0.1,.internal.com';

      const mod = await import('../../src/client/proxy');
      // Proxy is still "configured" even with NO_PROXY
      // The bypass happens per-request based on the target URL
      expect(mod.isProxyConfigured()).toBe(true);
    });

    it('recognizes lowercase no_proxy', async () => {
      process.env.HTTP_PROXY = 'http://proxy.example.com:8080';
      process.env.no_proxy = 'localhost,127.0.0.1';

      const mod = await import('../../src/client/proxy');
      expect(mod.isProxyConfigured()).toBe(true);
    });
  });

  describe('proxyFetch function', () => {
    it('is exported and callable', async () => {
      const { proxyFetch } = await import('../../src/client/proxy');
      expect(typeof proxyFetch).toBe('function');
    });

    it('returns a Response when no proxy is configured', async () => {
      // Without proxy, proxyFetch should behave like regular fetch
      const { proxyFetch } = await import('../../src/client/proxy');

      // Test with a simple request that should work
      // Using a reliable public endpoint
      const response = await proxyFetch('https://httpbin.org/status/200', {
        signal: AbortSignal.timeout(5000),
      });
      expect(response.ok).toBe(true);
      expect(response.status).toBe(200);
    });
  });
});
