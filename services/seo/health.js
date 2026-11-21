export function buildTrendHealth(sources, { xApiConfigured = false, rssHubConfigured = false, firecrawlApiConfigured = false, now = Date.now(), staleAfterMs = 2 * 60 * 60 * 1000 } = {}) {
  const rows = Array.isArray(sources) ? sources : [];
  const active = rows.filter((source) => source.is_active);
  const successTimes = active
    .map((source) => source.last_success_at || (!source.last_error ? source.last_scanned_at : null))
    .filter(Boolean)
    .map((value) => new Date(value).getTime())
    .filter(Number.isFinite);
  const latestSuccess = successTimes
    .reduce((latest, value) => Math.max(latest, value), 0);
  const ageMs = latestSuccess ? Math.max(0, now - latestSuccess) : null;
  return {
    active_sources: active.length,
    successful_sources: successTimes.length,
    failed_sources: active.filter((source) => source.last_error).length,
    latest_success_at: latestSuccess ? new Date(latestSuccess).toISOString() : null,
    age_ms: ageMs,
    stale: ageMs === null || ageMs > staleAfterMs,
    x_api_configured: Boolean(xApiConfigured),
    rsshub_configured: Boolean(rssHubConfigured),
    firecrawl_api_configured: Boolean(firecrawlApiConfigured),
    provider_mode: firecrawlApiConfigured ? 'firecrawl_search' : xApiConfigured ? 'x_api' : rssHubConfigured ? 'rsshub_then_google_news' : 'google_trends_bluesky_forums',
  };
}
