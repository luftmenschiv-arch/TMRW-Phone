export class KeyedRegion {
  #parent; #nodes = new Map(); #metrics = { created: 0, updated: 0, removed: 0, wholeRegionReplacements: 0 };
  constructor(parent) { this.#parent = parent; }
  patch(items, { key, create, update }) {
    const wanted = new Set();
    for (const item of items) { const id = key(item); wanted.add(id); let node = this.#nodes.get(id); if (!node) { node = create(item); this.#nodes.set(id, node); this.#metrics.created += 1; } update(node, item); this.#metrics.updated += 1; this.#parent.append(node); }
    for (const [id, node] of this.#nodes) if (!wanted.has(id)) { node.remove(); this.#nodes.delete(id); this.#metrics.removed += 1; }
    return this.metrics;
  }
  get metrics() { return Object.freeze({ ...this.#metrics }); }
}
