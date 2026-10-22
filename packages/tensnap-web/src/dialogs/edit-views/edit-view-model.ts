import type { AnyView } from '@tensnap/core/persistence';

/** Merge only user edits, retaining unrelated changes made while the editor was open. */
export function applyViewEdit(current: AnyView, baseline: AnyView, edited: AnyView): AnyView {
  if (current.id !== baseline.id || edited.id !== baseline.id || current.type !== edited.type)
    throw new Error('The edited view is no longer available.');
  const next = structuredClone(current) as AnyView & Record<string, unknown>;
  const merge = (
    target: Record<string, unknown>,
    before: Record<string, unknown>,
    after: Record<string, unknown>,
    live: Record<string, unknown>,
  ) => {
    for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
      if (key === 'id' || key === 'views' || key === 'type' || key === 'data') continue;
      if (JSON.stringify(before[key]) === JSON.stringify(after[key])) continue;
      if (
        JSON.stringify(live[key]) !== JSON.stringify(before[key]) &&
        JSON.stringify(live[key]) !== JSON.stringify(after[key])
      )
        throw new Error(`The view field changed while editing: ${key}. Reopen the editor.`);
      if (after[key] === undefined) delete target[key];
      else target[key] = structuredClone(after[key]);
    }
  };
  merge(
    next,
    baseline as unknown as Record<string, unknown>,
    edited as unknown as Record<string, unknown>,
    current as unknown as Record<string, unknown>,
  );
  // Data fields are independent: resizing a view must not overwrite a changed binding or title.
  next.data = structuredClone(current.data ?? {});
  const before = baseline.data ?? {},
    after = edited.data ?? {},
    live = current.data ?? {};
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (
      JSON.stringify((before as Record<string, unknown>)[key]) ===
      JSON.stringify((after as Record<string, unknown>)[key])
    )
      continue;
    const source = live as Record<string, unknown>;
    if (
      JSON.stringify(source[key]) !== JSON.stringify((before as Record<string, unknown>)[key]) &&
      JSON.stringify(source[key]) !== JSON.stringify((after as Record<string, unknown>)[key])
    )
      throw new Error(`The view field changed while editing: data.${key}. Reopen the editor.`);
    const value = (after as Record<string, unknown>)[key];
    if (value === undefined) delete (next.data as Record<string, unknown>)[key];
    else (next.data as Record<string, unknown>)[key] = structuredClone(value);
  }
  return next;
}
