import { getConfigPath } from '../config/paths';

const NO_CREDENTIALS_REMEDIATION = [
  'Log in:          mmx auth login',
  'Pass per-call:   --api-key sk-xxxxx',
  'Or set env var:  MMX_CONFIG_DIR=/path/to/.mmx',
].join('\n');

export function buildNoCredentialsHint(configPath?: string): string {
  return `Looked for credentials in: ${configPath ?? getConfigPath()}\n${NO_CREDENTIALS_REMEDIATION}`;
}
