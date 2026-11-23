import type { OutboxMutation, PosBootstrapState } from '../types/pos';

const CACHE_KEY = 'la_dieta_pos_state_v1';
const OUTBOX_KEY = 'la_dieta_pos_outbox_v1';

export function loadCachedState(): PosBootstrapState | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? (JSON.parse(raw) as PosBootstrapState) : null;
  } catch {
    return null;
  }
}

export function saveCachedState(state: PosBootstrapState): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(state));
  } catch {
    // Storage quota guard
  }
}

export function loadOutbox(): OutboxMutation[] {
  try {
    const raw = localStorage.getItem(OUTBOX_KEY);
    return raw ? (JSON.parse(raw) as OutboxMutation[]) : [];
  } catch {
    return [];
  }
}

export function saveOutbox(queue: OutboxMutation[]): void {
  try {
    localStorage.setItem(OUTBOX_KEY, JSON.stringify(queue));
  } catch {
    // Storage quota guard
  }
}

export function enqueueOutboxMutation(
  method: OutboxMutation['method'],
  url: string,
  body: unknown,
  description: string
): OutboxMutation[] {
  const queue = loadOutbox();
  const entry: OutboxMutation = {
    id: crypto.randomUUID(),
    method,
    url,
    body,
    description,
    createdAt: new Date().toISOString(),
    retryCount: 0,
  };
  const updated = [...queue, entry];
  saveOutbox(updated);
  return updated;
}

export async function flushOutboxQueue(
  userId: string,
  simulatedOffline: boolean
): Promise<{ remaining: OutboxMutation[]; syncedCount: number }> {
  const queue = loadOutbox();
  if (queue.length === 0 || simulatedOffline || !navigator.onLine) {
    return { remaining: queue, syncedCount: 0 };
  }

  const remaining: OutboxMutation[] = [];
  let syncedCount = 0;

  for (let i = 0; i < queue.length; i++) {
    const item = queue[i];
    try {
      const res = await fetch(item.url, {
        method: item.method,
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': userId,
          'Idempotency-Key': item.id,
        },
        body: JSON.stringify(item.body),
      });

      if (res.ok) {
        syncedCount++;
      } else if (res.status >= 400 && res.status < 500) {
        // Business rule error (do not infinitely retry invalid client payload, keep diagnostic or drop if duplicate)
        const errBody = (await res.json().catch(() => ({}))) as { error?: string };
        remaining.push({ ...item, retryCount: item.retryCount + 1, lastError: errBody.error ?? `HTTP ${res.status}` });
      } else {
        // Server unavailable -> keep untouched and stop flushing order-dependently
        remaining.push({ ...item, retryCount: item.retryCount + 1, lastError: `HTTP ${res.status}` }, ...queue.slice(i + 1));
        break;
      }
    } catch (err) {
      // Network offline -> never delete pending data
      remaining.push({ ...item, retryCount: item.retryCount + 1, lastError: (err as Error).message }, ...queue.slice(i + 1));
      break;
    }
  }

  saveOutbox(remaining);
  return { remaining, syncedCount };
}
