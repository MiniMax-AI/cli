import type { OAuthTokens } from './types';
import { CLIError } from '../errors/base';
import { ExitCode } from '../errors/codes';

// OAuth configuration — exact endpoints TBD pending MiniMax OAuth docs
export interface OAuthConfig {
  clientId: string;
  authorizationUrl: string;
  tokenUrl: string;
  deviceCodeUrl: string;
  scopes: string[];
  callbackPort: number;
}

const DEFAULT_OAUTH_CONFIG: OAuthConfig = {
  clientId: 'mmx-cli',
  authorizationUrl: 'https://platform.minimax.io/oauth/authorize',
  tokenUrl: 'https://api.minimax.io/v1/oauth/token',
  deviceCodeUrl: 'https://api.minimax.io/v1/oauth/device/code',
  scopes: ['api'],
  callbackPort: 18991,
};

export async function startBrowserFlow(
  config: OAuthConfig = DEFAULT_OAUTH_CONFIG,
): Promise<OAuthTokens> {
  const { randomBytes, createHash } = await import('crypto');
  const codeVerifier = randomBytes(32).toString('base64url');
  const codeChallenge = createHash('sha256')
    .update(codeVerifier)
    .digest('base64url');

  const state = randomBytes(16).toString('hex');

  const params = new URLSearchParams({
    client_id: config.clientId,
    response_type: 'code',
    redirect_uri: `http://localhost:${config.callbackPort}/callback`,
    scope: config.scopes.join(' '),
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  });

  const authUrl = `${config.authorizationUrl}?${params}`;

  // Open browser using execFile/spawn instead of exec to prevent shell injection.
  // exec() passes the string to a shell, so a crafted authUrl containing shell
  // metacharacters (e.g. from a malicious authorization server redirect) could
  // execute arbitrary commands. execFile/spawn bypass the shell entirely. (#79)
  const { execFile, spawn } = await import('child_process');
  const platform = process.platform;

  if (platform === 'darwin') {
    execFile('open', [authUrl]);
  } else if (platform === 'win32') {
    // On Windows, 'start' is a shell built-in — use cmd.exe /c start explicitly.
    spawn('cmd.exe', ['/c', 'start', '', authUrl], { shell: false, detached: true });
  } else {
    execFile('xdg-open', [authUrl]);
  }
  process.stderr.write('Opening browser to authenticate with MiniMax...\n');

  // Start local server to receive callback
  const code = await waitForCallback(config.callbackPort, state);

  // Exchange code for tokens
  const tokenRes = await fetch(config.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      client_id: config.clientId,
      redirect_uri: `http://localhost:${config.callbackPort}/callback`,
      code_verifier: codeVerifier,
    }),
  });

  if (!tokenRes.ok) {
    const body = await tokenRes.text();
    throw new CLIError(
      `OAuth token exchange failed: ${body}`,
      ExitCode.AUTH,
    );
  }

  return (await tokenRes.json()) as OAuthTokens;
}

async function waitForCallback(port: number, expectedState: string): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const timeout = setTimeout(() => {
      server.stop();
      reject(new CLIError('OAuth callback timed out.', ExitCode.TIMEOUT));
    }, 120_000);

    const server = Bun.serve({
      port,
      fetch(req) {
        const url = new URL(req.url);
        if (url.pathname !== '/callback') {
          return new Response('Not found', { status: 404 });
        }

        const code = url.searchParams.get('code');
        const state = url.searchParams.get('state');
        const error = url.searchParams.get('error');

        if (error) {
          clearTimeout(timeout);
          server.stop();
          reject(new CLIError(`OAuth error: ${error}`, ExitCode.AUTH));
          return new Response(
            '<html><body><h1>Authentication Failed</h1><p>You can close this tab.</p></body></html>',
            { headers: { 'Content-Type': 'text/html' } },
          );
        }

        if (!code || state !== expectedState) {
          clearTimeout(timeout);
          server.stop();
          reject(new CLIError('Invalid OAuth callback.', ExitCode.AUTH));
          return new Response('Invalid callback', { status: 400 });
        }

        clearTimeout(timeout);
        server.stop();
        resolve(code);
        return new Response(
          '<html><body><h1>Authentication Successful</h1><p>You can close this tab.</p></body></html>',
          { headers: { 'Content-Type': 'text/html' } },
        );
      },
    });
  });
}

export async function startDeviceCodeFlow(
  config: OAuthConfig = DEFAULT_OAUTH_CONFIG,
): Promise<OAuthTokens> {
  // Request device code
  const codeRes = await fetch(config.deviceCodeUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: config.clientId,
      scope: config.scopes.join(' '),
    }),
  });

  if (!codeRes.ok) {
    throw new CLIError(
      'Failed to start device code flow.',
      ExitCode.AUTH,
    );
  }

  const { device_code, user_code, verification_uri, interval, expires_in } =
    (await codeRes.json()) as {
      device_code: string;
      user_code: string;
      verification_uri: string;
      interval: number;
      expires_in: number;
    };

  process.stderr.write(`\nVisit: ${verification_uri}\n`);
  process.stderr.write(`Enter code: ${user_code}\n`);
  process.stderr.write('Waiting for authorization...\n');

  // Poll for authorization
  const deadline = Date.now() + expires_in * 1000;
  const pollInterval = (interval || 5) * 1000;

  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, pollInterval));

    const tokenRes = await fetch(config.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
        device_code,
        client_id: config.clientId,
      }),
    });

    if (tokenRes.ok) {
      return (await tokenRes.json()) as OAuthTokens;
    }

    const err = (await tokenRes.json()) as { error: string };
    if (err.error === 'authorization_pending') continue;
    if (err.error === 'slow_down') {
      await new Promise(r => setTimeout(r, 5000));
      continue;
    }

    throw new CLIError(
      `Device code authorization failed: ${err.error}`,
      ExitCode.AUTH,
    );
  }

  throw new CLIError('Device code authorization timed out.', ExitCode.TIMEOUT);
}
