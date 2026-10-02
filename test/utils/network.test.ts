import { describe, it, expect } from 'bun:test';
import {
  isPrivateOrLoopbackIp,
  isPrivateOrLoopbackIpv4,
  isPrivateOrLoopbackIpv6,
  isDisallowedHostname,
  validateSafeUrl,
} from '../../src/utils/network';
import { CLIError } from '../../src/errors/base';

describe('network security: IP address validation', () => {
  it('detects loopback IPv4 addresses', () => {
    expect(isPrivateOrLoopbackIpv4('127.0.0.1')).toBe(true);
    expect(isPrivateOrLoopbackIpv4('127.255.255.254')).toBe(true);
    expect(isPrivateOrLoopbackIpv4('127.0.0.0')).toBe(true);
  });

  it('detects RFC 1918 private IPv4 addresses', () => {
    // 10.0.0.0/8
    expect(isPrivateOrLoopbackIpv4('10.0.0.1')).toBe(true);
    expect(isPrivateOrLoopbackIpv4('10.255.255.255')).toBe(true);

    // 172.16.0.0/12
    expect(isPrivateOrLoopbackIpv4('172.16.0.1')).toBe(true);
    expect(isPrivateOrLoopbackIpv4('172.31.255.255')).toBe(true);
    expect(isPrivateOrLoopbackIpv4('172.15.0.1')).toBe(false);
    expect(isPrivateOrLoopbackIpv4('172.32.0.1')).toBe(false);

    // 192.168.0.0/16
    expect(isPrivateOrLoopbackIpv4('192.168.1.1')).toBe(true);
    expect(isPrivateOrLoopbackIpv4('192.168.254.254')).toBe(true);
  });

  it('detects link-local and cloud metadata service (169.254.169.254)', () => {
    expect(isPrivateOrLoopbackIpv4('169.254.169.254')).toBe(true);
    expect(isPrivateOrLoopbackIpv4('169.254.0.1')).toBe(true);
  });

  it('detects current network, CGNAT, multicast, and broadcast', () => {
    expect(isPrivateOrLoopbackIpv4('0.0.0.0')).toBe(true);
    expect(isPrivateOrLoopbackIpv4('100.64.0.1')).toBe(true);
    expect(isPrivateOrLoopbackIpv4('100.127.255.255')).toBe(true);
    expect(isPrivateOrLoopbackIpv4('224.0.0.1')).toBe(true);
    expect(isPrivateOrLoopbackIpv4('255.255.255.255')).toBe(true);
  });

  it('allows public IPv4 addresses', () => {
    expect(isPrivateOrLoopbackIpv4('8.8.8.8')).toBe(false);
    expect(isPrivateOrLoopbackIpv4('1.1.1.1')).toBe(false);
    expect(isPrivateOrLoopbackIpv4('93.184.216.34')).toBe(false);
  });

  it('detects loopback, link-local, and unique-local IPv6 addresses', () => {
    expect(isPrivateOrLoopbackIpv6('::1')).toBe(true);
    expect(isPrivateOrLoopbackIpv6('::')).toBe(true);
    expect(isPrivateOrLoopbackIpv6('fe80::1')).toBe(true);
    expect(isPrivateOrLoopbackIpv6('fc00::1')).toBe(true);
    expect(isPrivateOrLoopbackIpv6('fd12:3456:789a::1')).toBe(true);
  });

  it('detects IPv4-mapped IPv6 addresses for private IPv4', () => {
    expect(isPrivateOrLoopbackIpv6('::ffff:127.0.0.1')).toBe(true);
    expect(isPrivateOrLoopbackIpv6('::ffff:10.0.0.1')).toBe(true);
    expect(isPrivateOrLoopbackIpv6('::ffff:169.254.169.254')).toBe(true);
    expect(isPrivateOrLoopbackIpv6('::ffff:8.8.8.8')).toBe(false);
  });

  it('correctly handles isPrivateOrLoopbackIp general wrapper', () => {
    expect(isPrivateOrLoopbackIp('127.0.0.1')).toBe(true);
    expect(isPrivateOrLoopbackIp('::1')).toBe(true);
    expect(isPrivateOrLoopbackIp('8.8.8.8')).toBe(false);
    expect(isPrivateOrLoopbackIp('2606:4700:4700::1111')).toBe(false);
  });
});

describe('network security: hostname validation', () => {
  it('detects disallowed hostnames', () => {
    expect(isDisallowedHostname('localhost')).toBe(true);
    expect(isDisallowedHostname('sub.localhost')).toBe(true);
    expect(isDisallowedHostname('myhost.local')).toBe(true);
    expect(isDisallowedHostname('server.internal')).toBe(true);
    expect(isDisallowedHostname('test.invalid')).toBe(true);
    expect(isDisallowedHostname('secret.onion')).toBe(true);
  });

  it('allows normal public hostnames', () => {
    expect(isDisallowedHostname('api.minimax.io')).toBe(false);
    expect(isDisallowedHostname('example.com')).toBe(false);
    expect(isDisallowedHostname('github.com')).toBe(false);
  });
});

describe('validateSafeUrl', () => {
  it('rejects unsupported protocols', async () => {
    await expect(validateSafeUrl('file:///etc/passwd')).rejects.toThrow(CLIError);
    await expect(validateSafeUrl('ftp://example.com/file')).rejects.toThrow(/Only HTTP and HTTPS/);
    await expect(validateSafeUrl('data:text/plain;base64,abc')).rejects.toThrow(/Only HTTP and HTTPS/);
  });

  it('rejects malformed URLs', async () => {
    await expect(validateSafeUrl('not a url')).rejects.toThrow(/Invalid URL/);
  });

  it('rejects loopback and private IP URLs', async () => {
    await expect(validateSafeUrl('http://127.0.0.1:8080/admin')).rejects.toThrow(/SSRF protection/);
    await expect(validateSafeUrl('http://10.1.2.3/internal')).rejects.toThrow(/SSRF protection/);
    await expect(validateSafeUrl('http://192.168.1.1/config')).rejects.toThrow(/SSRF protection/);
    await expect(validateSafeUrl('http://172.20.0.1/')).rejects.toThrow(/SSRF protection/);
    await expect(validateSafeUrl('http://169.254.169.254/latest/meta-data/')).rejects.toThrow(/SSRF protection/);
    await expect(validateSafeUrl('http://[::1]:8080/')).rejects.toThrow(/SSRF protection/);
  });

  it('rejects localhost and local hostnames', async () => {
    await expect(validateSafeUrl('http://localhost:3000/')).rejects.toThrow(/SSRF protection/);
    await expect(validateSafeUrl('http://api.local/data')).rejects.toThrow(/SSRF protection/);
    await expect(validateSafeUrl('http://db.internal:5432/')).rejects.toThrow(/SSRF protection/);
  });

  it('accepts public HTTPS URLs', async () => {
    const parsed = await validateSafeUrl('https://api.minimax.io/v1/models');
    expect(parsed.hostname).toBe('api.minimax.io');
    expect(parsed.protocol).toBe('https:');
  });

  it('allows private URLs when allowPrivate option is enabled', async () => {
    const parsed = await validateSafeUrl('http://127.0.0.1:8080/mock', { allowPrivate: true });
    expect(parsed.hostname).toBe('127.0.0.1');
  });
});
