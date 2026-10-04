const validatedDefinitions = new WeakSet<object>();

/** Mark a definition produced from a binding whose topology was compiled. */
export function markCompiledTopology(definition: object): void {
  validatedDefinitions.add(definition);
}

export function hasCompiledTopology(definition: object): boolean {
  return validatedDefinitions.has(definition);
}

export function sameDependencyLayerIds(
  left: Record<string, string> | undefined,
  right: Record<string, string> | undefined,
): boolean {
  const a = left ?? {};
  const b = right ?? {};
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((role) => a[role] === b[role]);
}

/** Resolve explicit layer dependencies within one environment, preserving peer order. */
export function orderLayers<T>(
  environmentId: string,
  layers: readonly T[],
  idOf: (layer: T) => string,
  typeOf: (layer: T) => string,
  dependenciesOf: (layer: T) => Record<string, string> | undefined,
): T[] {
  const byId = new Map<string, T>();
  const position = new Map<string, number>();
  for (const [index, layer] of layers.entries()) {
    const id = idOf(layer);
    if (!id || byId.has(id)) throw new Error(`Empty or duplicate layer id: ${environmentId}/${id}`);
    byId.set(id, layer);
    position.set(id, index);
  }
  const ordered: T[] = [];
  const state = new Map<string, 'active' | 'done'>();
  const visit = (id: string): void => {
    if (state.get(id) === 'done') return;
    if (state.get(id) === 'active')
      throw new Error(`Cyclic layer dependency: ${environmentId}/${id}`);
    state.set(id, 'active');
    const layer = byId.get(id)!;
    const refs = Object.entries(dependenciesOf(layer) ?? {}).sort(
      (a, b) => (position.get(a[1]) ?? -1) - (position.get(b[1]) ?? -1),
    );
    for (const [role, dependencyId] of refs) {
      const dependency = byId.get(dependencyId);
      if (!dependency)
        throw new Error(`Layer ${environmentId}/${id} depends on missing layer ${dependencyId}`);
      if (role === 'agent' && typeOf(dependency) !== 'agent') {
        throw new Error(`Layer ${environmentId}/${id} requires agent layer ${dependencyId}`);
      }
      visit(dependencyId);
    }
    state.set(id, 'done');
    ordered.push(layer);
  };
  for (const layer of layers) visit(idOf(layer));
  return ordered;
}
