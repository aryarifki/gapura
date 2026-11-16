export function runtimeSecret(name, { testValue = '' } = {}) {
  const value = String(process.env[name] || '').trim();
  if (value) return value;
  if (process.env.NODE_ENV === 'production') throw new Error(`${name} wajib dikonfigurasi.`);
  return testValue;
}
