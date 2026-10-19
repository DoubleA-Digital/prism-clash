// Snapshot delta compression. A snapshot is a map of entity id -> integer array
// ([kind, ...fields]). Against a baseline the client acknowledged, we send:
//   new entity:      id, length, ...fields
//   changed entity: -id, bitmask of changed fields, ...changed values
//   removed:         listed separately
// Unchanged entities cost nothing.

export type EntityMap = Map<number, number[]>;

export function encodeDelta(base: EntityMap | null, cur: EntityMap): { e: number[]; r: number[] } {
  const e: number[] = [];
  const r: number[] = [];
  for (const [id, arr] of cur) {
    const prev = base?.get(id);
    if (!prev || prev.length !== arr.length || prev[0] !== arr[0]) {
      e.push(id, arr.length, ...arr);
      continue;
    }
    let mask = 0;
    const vals: number[] = [];
    for (let i = 1; i < arr.length && i < 31; i++) {
      if (arr[i] !== prev[i]) {
        mask |= 1 << i;
        vals.push(arr[i] ?? 0);
      }
    }
    if (mask !== 0) e.push(-id, mask >>> 0, ...vals);
  }
  if (base) for (const id of base.keys()) if (!cur.has(id)) r.push(id);
  return { e, r };
}

/** Rebuilds the full entity map from a baseline plus a delta. Throws on malformed data. */
export function applyDelta(base: EntityMap | null, e: readonly number[], r: readonly number[]): EntityMap {
  const out: EntityMap = new Map();
  if (base) for (const [id, arr] of base) out.set(id, arr);
  for (const id of r) out.delete(id);
  let i = 0;
  while (i < e.length) {
    const head = e[i++] ?? 0;
    if (head > 0) {
      const n = e[i++] ?? 0;
      if (n <= 0 || n > 64 || i + n > e.length) throw new Error("bad delta length");
      out.set(head, e.slice(i, i + n));
      i += n;
    } else {
      const id = -head;
      const mask = e[i++] ?? 0;
      const prev = out.get(id);
      if (!prev) throw new Error(`delta for unknown entity ${id}`);
      const next = prev.slice();
      for (let b = 1; b < 31; b++) {
        if (mask & (1 << b)) next[b] = e[i++] ?? 0;
      }
      out.set(id, next);
    }
  }
  return out;
}
