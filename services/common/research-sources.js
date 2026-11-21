import { validatePublicSourceUrl } from './sources.js';

// Group subdomains of one publisher. This is a source-diversity check, not a
// corporate-ownership or truth assessment; editorial review still checks both.
export function publisherIdentity(value) {
  if (validatePublicSourceUrl(value)) return null;
  const host = new URL(value).hostname.toLowerCase().replace(/^www\./u, '');
  const labels = host.split('.');
  const twoLevelSuffix = /^(?:co|com|org|net|ac|go)\.(?:id|uk|jp|au|nz)$/u.test(labels.slice(-2).join('.'));
  return labels.slice(twoLevelSuffix ? -3 : -2).join('.');
}

export function distinctPublishers(facts) {
  return new Set((facts || []).map((fact) => publisherIdentity(fact.source_url || fact.url)).filter(Boolean));
}
