// Keep local disposable HTTP API tests available while forbidding external fetches.
const fetch = globalThis.fetch;
globalThis.fetch = (input, options) => {
  const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
  if (!['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname)) {
    throw new Error(`External requests disabled in render tests: ${url.origin}`);
  }
  return fetch(input, options);
};
