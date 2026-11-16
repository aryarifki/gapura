export function createOriginGuard({ publicOrigin = '' } = {}) {
  return (req, res, next) => {
    const origin = req.get?.('origin');
    if (origin) {
      let parsedOrigin;
      try { parsedOrigin = new URL(origin); } catch { return res.status(403).json({ error: 'Origin request tidak valid.' }); }
      const forwardedHost = req.get?.('x-forwarded-host');
      const host = String(forwardedHost || req.get?.('host') || '').split(',')[0].trim().toLowerCase();
      const expectedOrigin = publicOrigin ? new URL(publicOrigin).origin : '';
      if ((expectedOrigin ? parsedOrigin.origin !== expectedOrigin : parsedOrigin.host.toLowerCase() !== host)
        || !['https:', 'http:'].includes(parsedOrigin.protocol)) {
        return res.status(403).json({ error: 'Cross-origin request ditolak.' });
      }
    }

    return next();
  };
}

export function redactAgentConfig(config) {
  return Object.fromEntries(Object.entries(config || {}).map(([key, value]) => {
    if (!value || typeof value !== 'object' || Array.isArray(value) || !Object.hasOwn(value, 'api_key')) return [key, value];
    return [key, { ...value, api_key: '', api_key_configured: Boolean(value.api_key) }];
  }));
}

export function mergeAgentConfig(existing, incoming) {
  const result = { ...existing, ...incoming };
  for (const [key, value] of Object.entries(incoming || {})) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
    result[key] = { ...(existing?.[key] || {}), ...value };
    if (!value.api_key && existing?.[key]?.api_key) result[key].api_key = existing[key].api_key;
  }
  return result;
}
