export function maskToken(token: string): string {
  return token.length > 8 ? `${token.slice(0, 4)}...${token.slice(-4)}` : '***';
}
