// Shop client. Buying: the browser asks the project's shop server for a Stripe Checkout page and
// goes there. Stripe sends the buyer back with ?shop_session=…; the browser claims the signed
// receipt from the shop server and hands it to the hub, which verifies it and unlocks the item.

import { useSyncExternalStore } from 'react';
import { owns, type Deal } from '../../../shared/cosmetics.ts';
import { api } from './api.ts';

export interface ShopInfo {
  configured: boolean;
  serverUrl: string;
  installId: string;
  owned: string[];
  day: string;
  deals: Deal[];
}

let info: ShopInfo | null = null;
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function refreshShop() {
  loading = api
    .get<ShopInfo>('/api/shop')
    .then((s) => {
      info = s;
      emit();
    })
    .catch(() => undefined)
    .finally(() => (loading = null));
  return loading;
}

/** Shop state (owned items, today's deals); loads on first use. */
export function useShop(): ShopInfo | null {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      if (!info && !loading) void refreshShop();
      return () => listeners.delete(cb);
    },
    () => info,
  );
}

export const isOwned = (s: ShopInfo | null, id: string) => owns(s?.owned ?? [], id);

/** Starts checkout for an item; resolves only on error (success leaves the page). */
export async function buy(id: string): Promise<string> {
  const s = info ?? (await api.get<ShopInfo>('/api/shop'));
  if (!s.configured) return 'Purchases are not set up in this build of AI Village.';
  try {
    const r = await fetch(`${s.serverUrl}/checkout`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ item: id, install: s.installId, returnUrl: `${location.origin}/` }),
    });
    const j = (await r.json()) as { url?: string; error?: string };
    if (!r.ok || !j.url) return j.error ?? 'The shop is not reachable right now.';
    location.assign(j.url);
    return '';
  } catch {
    return 'The shop is not reachable right now. Check your internet connection.';
  }
}

/**
 * Finishes a purchase when Stripe has just sent the buyer back. Returns the unlocked item id, an
 * error message, or null when this page load is not a checkout return.
 */
export async function finishPurchase(): Promise<{ item?: string; error?: string } | null> {
  const q = new URLSearchParams(location.search);
  const session = q.get('shop_session');
  const cancelled = q.has('shop_cancelled');
  if (!session && !cancelled) return null;
  history.replaceState(null, '', location.pathname);
  if (cancelled) return { error: 'Checkout cancelled. You were not charged.' };
  try {
    const s = await api.get<ShopInfo>('/api/shop');
    const r = await fetch(`${s.serverUrl}/claim?session=${encodeURIComponent(session!)}`);
    const j = (await r.json()) as { receipt?: string; error?: string };
    if (!r.ok || !j.receipt) return { error: j.error ?? 'Could not confirm the payment yet. Reload this page in a minute.' };
    const done = await api.post<{ item: string }>('/api/shop/redeem', { receipt: j.receipt });
    await refreshShop();
    return { item: done.item };
  } catch (e) {
    return { error: (e as Error).message || 'Could not finish the purchase.' };
  }
}
