/** Run `fn` against a stubbed fetch and hand back what the command sent. */
export async function withStubbedFetch(
  respond: () => Response,
  fn: (sent: { url: string; init: RequestInit | undefined }) => Promise<void>,
): Promise<void> {
  const originalFetch = globalThis.fetch;
  const sent = { url: '', init: undefined as RequestInit | undefined };
  globalThis.fetch = (async (input, init) => {
    sent.url = String(input);
    sent.init = init;
    return respond();
  }) as typeof fetch;

  try {
    await fn(sent);
  } finally {
    globalThis.fetch = originalFetch;
  }
}
