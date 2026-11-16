export async function mapLimit(items, limit, mapper) {
  if (!Number.isInteger(limit) || limit < 1) throw new RangeError('Concurrency limit must be a positive integer.');
  const input = Array.from(items || []);
  const results = new Array(input.length);
  let cursor = 0;
  async function worker() {
    while (true) {
      const index = cursor++;
      if (index >= input.length) return;
      results[index] = await mapper(input[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, input.length) }, worker));
  return results;
}
