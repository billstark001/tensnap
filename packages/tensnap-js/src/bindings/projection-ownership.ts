/** Private borrowed views of built-in producers; never exposed as public output. */
const borrowedViews = new WeakMap<object, object>();

export function registerBorrowedView<T extends object>(owned: T, borrowed?: object): T {
  if (borrowed) borrowedViews.set(owned, borrowed);
  return owned;
}

export function borrowedView<T>(owned: object): T | undefined {
  return borrowedViews.get(owned) as T | undefined;
}
