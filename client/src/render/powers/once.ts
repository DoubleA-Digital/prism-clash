// "Has this effect just appeared?" for drawers that want a one-shot flourish (labels, bursts)
// the first frame they see an effect. Effect ids restart every round, so an entry counts as
// new again once it hasn't been drawn for a while.

const lastSeen = new Map<string, number>();
let sweepAt = 0;

/** True the first frame `key` is drawn (or the first frame after a gap of `gap` seconds). */
export function firstSight(key: string, time: number, gap = 1): boolean {
  const prev = lastSeen.get(key);
  lastSeen.set(key, time);
  if (time > sweepAt) {
    sweepAt = time + 5;
    for (const [k, t] of lastSeen) if (time - t > 5) lastSeen.delete(k);
  }
  return prev === undefined || time - prev > gap;
}

/** Stable pseudo-random 0..1 from an id and a salt (crack patterns, crust plates). */
export function hash01(id: number, salt: number): number {
  const s = Math.sin(id * 12.9898 + salt * 78.233) * 43758.5453;
  return s - Math.floor(s);
}
