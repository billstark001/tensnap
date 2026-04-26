/**
 * LazyEventTarget.test.ts — usage examples & manual smoke tests
 * Run with:  npx ts-node LazyEventTarget.test.ts
 */
import { LazyEventTarget } from "./LazyEventTarget";

let passed = 0;
let failed = 0;
function assert(condition: boolean, msg: string) {
  if (condition) { console.log(`  ✅  ${msg}`); passed++; }
  else           { console.error(`  ❌  ${msg}`); failed++; }
}

// ── 1. Basic lazy dispatch ──────────────────────────────────────────────────
console.log("\n[1] Basic lazy dispatch");
{
  const t = new LazyEventTarget();
  let factoryCalled = false;
  // No listeners — factory must NOT be called
  t.dispatchLazy("ping", () => { factoryCalled = true; return new Event("ping"); });
  assert(!factoryCalled, "factory NOT called when no listener");

  let received = false;
  t.addEventListener("ping", () => { received = true; });
  t.dispatchLazy("ping", () => { factoryCalled = true; return new Event("ping"); });
  assert(factoryCalled, "factory called when listener present");
  assert(received,      "listener received the event");
}

// ── 2. listenerCount / hasListeners ────────────────────────────────────────
console.log("\n[2] listenerCount / hasListeners");
{
  const t = new LazyEventTarget();
  assert(t.listenerCount("x") === 0, "count starts at 0");
  const fn = () => {};
  t.addEventListener("x", fn);
  assert(t.listenerCount("x") === 1, "count is 1 after add");
  assert(t.hasListeners("x"),        "hasListeners() true");
  t.removeEventListener("x", fn);
  assert(t.listenerCount("x") === 0, "count back to 0 after remove");
  assert(!t.hasListeners("x"),       "hasListeners() false");
}

// ── 3. Deduplication ───────────────────────────────────────────────────────
console.log("\n[3] Deduplication (same listener twice)");
{
  const t = new LazyEventTarget();
  const fn = () => {};
  t.addEventListener("click", fn);
  t.addEventListener("click", fn);  // duplicate — must be ignored
  assert(t.listenerCount("click") === 1, "duplicate ignored, count stays 1");
}

// ── 4. once option ──────────────────────────────────────────────────────────
console.log("\n[4] once option");
{
  const t = new LazyEventTarget();
  let callCount = 0;
  t.addEventListener("ev", () => { callCount++; }, { once: true });
  assert(t.listenerCount("ev") === 1, "count 1 before fire");
  t.dispatchEvent(new Event("ev"));
  assert(callCount === 1,             "listener called once");
  assert(t.listenerCount("ev") === 0, "count 0 after once-listener fires");
  t.dispatchEvent(new Event("ev"));
  assert(callCount === 1,             "listener NOT called a second time");
}

// ── 5. once removed before firing ──────────────────────────────────────────
console.log("\n[5] once listener removed before firing");
{
  const t = new LazyEventTarget();
  let callCount = 0;
  const fn = () => { callCount++; };
  t.addEventListener("ev", fn, { once: true });
  t.removeEventListener("ev", fn);
  assert(t.listenerCount("ev") === 0, "count 0 after explicit remove");
  t.dispatchEvent(new Event("ev"));
  assert(callCount === 0,             "listener never invoked");
}

// ── 6. AbortSignal ──────────────────────────────────────────────────────────
console.log("\n[6] AbortSignal removes listener");
{
  const t  = new LazyEventTarget();
  const ac = new AbortController();
  let callCount = 0;
  t.addEventListener("ev", () => { callCount++; }, { signal: ac.signal });
  assert(t.listenerCount("ev") === 1, "count 1 before abort");
  t.dispatchEvent(new Event("ev"));
  assert(callCount === 1,             "fires before abort");
  ac.abort();
  assert(t.listenerCount("ev") === 0, "count 0 after abort");
  t.dispatchEvent(new Event("ev"));
  assert(callCount === 1,             "does NOT fire after abort");
}

// ── 7. Pre-aborted signal ───────────────────────────────────────────────────
console.log("\n[7] Pre-aborted signal — registration is a no-op");
{
  const t  = new LazyEventTarget();
  const ac = new AbortController();
  ac.abort();
  t.addEventListener("ev", () => {}, { signal: ac.signal });
  assert(t.listenerCount("ev") === 0, "already-aborted signal: count stays 0");
}

// ── 8. Capture vs bubble are independent registrations ─────────────────────
console.log("\n[8] Capture vs bubble counted separately");
{
  const t = new LazyEventTarget();
  const fn = () => {};
  t.addEventListener("ev", fn, { capture: false });
  t.addEventListener("ev", fn, { capture: true });
  assert(t.listenerCount("ev") === 2, "bubble + capture = 2");
  t.removeEventListener("ev", fn, { capture: true });
  assert(t.listenerCount("ev") === 1, "removing capture leaves 1");
}

// ── 9. EventListenerObject (handleEvent) ───────────────────────────────────
console.log("\n[9] EventListenerObject");
{
  const t = new LazyEventTarget();
  let called = false;
  const obj = { handleEvent: () => { called = true; } };
  t.addEventListener("ev", obj);
  t.dispatchEvent(new Event("ev"));
  assert(called,                      "handleEvent invoked");
  t.removeEventListener("ev", obj);
  assert(t.listenerCount("ev") === 0, "count 0 after remove");
}

// ── 10. dispatchLazyCustom ─────────────────────────────────────────────────
console.log("\n[10] dispatchLazyCustom<T>");
{
  const t = new LazyEventTarget();
  let factoryCalled = false;
  type Payload = { value: number };

  const skipped = t.dispatchLazyCustom<Payload>("data", () => {
    factoryCalled = true;
    return { value: 42 };
  });
  assert(!factoryCalled && !skipped, "factory skipped, returns false");

  let detail: Payload | undefined;
  t.addEventListener("data", (e) => { detail = (e as CustomEvent<Payload>).detail; });
  t.dispatchLazyCustom<Payload>("data", () => { factoryCalled = true; return { value: 42 }; });
  assert(factoryCalled,              "factory called when listener present");
  assert(detail?.value === 42,       "detail.value received correctly");
}

// ── 11. once + AbortSignal ─────────────────────────────────────────────────
console.log("\n[11] once + AbortSignal — abort wins");
{
  const t  = new LazyEventTarget();
  const ac = new AbortController();
  let callCount = 0;
  t.addEventListener("ev", () => { callCount++; }, { once: true, signal: ac.signal });
  assert(t.listenerCount("ev") === 1, "count 1 before abort");
  ac.abort();
  assert(t.listenerCount("ev") === 0, "count 0 after abort");
  t.dispatchEvent(new Event("ev"));
  assert(callCount === 0,             "listener not called after abort");
}

// ── 12. Multiple event types are tracked independently ─────────────────────
console.log("\n[12] Multiple event types — independent counts");
{
  const t = new LazyEventTarget();
  const a = () => {}, b = () => {};
  t.addEventListener("foo", a);
  t.addEventListener("bar", b);
  t.addEventListener("bar", () => {});
  assert(t.listenerCount("foo") === 1, "foo count = 1");
  assert(t.listenerCount("bar") === 2, "bar count = 2");
}

// ── Summary ────────────────────────────────────────────────────────────────
console.log(`\n${"─".repeat(40)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
