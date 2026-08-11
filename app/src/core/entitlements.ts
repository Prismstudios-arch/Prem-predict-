/**
 * Subscriptions via RevenueCat (CLAUDE.md §8, §9.2 [HARD]).
 *
 * §9.2 is the important line: "Entitlement verified server-side against
 * RevenueCat webhook state before returning any premium field. Premium data
 * must be ABSENT from the response, not hidden in the UI."
 *
 * So this module is NOT the gate. The gate is `public.is_entitled()` inside
 * the predictions_premium view (0003_views.sql), which returns zero rows to an
 * unentitled caller. Everything here exists to decide what to *show* — whether
 * to render a paywall or a value — and a user who defeats it gains nothing,
 * because the data was never in the response.
 *
 * Treating this as convenience rather than security is what makes the whole
 * design safe. If premium content were fetched and then hidden, patching this
 * file would unlock it.
 */

import Purchases, {
  type CustomerInfo,
  type PurchasesOffering,
  type PurchasesPackage,
} from 'react-native-purchases';
import { Platform } from 'react-native';

/** Must match the entitlement identifier configured in RevenueCat. */
export const PREMIUM_ENTITLEMENT = 'premium';

const API_KEY = process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY;

let configured = false;

/**
 * @param appUserId the Supabase user id, so RevenueCat's webhook can attribute
 * the purchase to the right row. Without it a restore on a new device cannot
 * find the account.
 */
export async function configurePurchases(appUserId: string): Promise<void> {
  if (configured || Platform.OS !== 'ios') return;
  if (!API_KEY) {
    console.warn('EXPO_PUBLIC_REVENUECAT_IOS_KEY is not set; purchases disabled');
    return;
  }
  Purchases.configure({ apiKey: API_KEY, appUserID: appUserId });
  configured = true;
}

export function isPremium(info: CustomerInfo | null): boolean {
  if (!info) return false;
  return info.entitlements.active[PREMIUM_ENTITLEMENT] !== undefined;
}

export async function getCustomerInfo(): Promise<CustomerInfo | null> {
  if (!configured) return null;
  try {
    return await Purchases.getCustomerInfo();
  } catch (error) {
    console.error('getCustomerInfo failed', error);
    return null;
  }
}

export async function getOffering(): Promise<PurchasesOffering | null> {
  if (!configured) return null;
  try {
    const offerings = await Purchases.getOfferings();
    return offerings.current ?? null;
  } catch (error) {
    console.error('getOfferings failed', error);
    return null;
  }
}

export type PurchaseOutcome =
  | { status: 'purchased'; info: CustomerInfo }
  | { status: 'cancelled' }
  | { status: 'failed'; message: string };

export async function purchase(pkg: PurchasesPackage): Promise<PurchaseOutcome> {
  try {
    const { customerInfo } = await Purchases.purchasePackage(pkg);
    return { status: 'purchased', info: customerInfo };
  } catch (error) {
    // A user cancelling is not an error and must never surface as one.
    const cancelled = (error as { userCancelled?: boolean }).userCancelled;
    if (cancelled) return { status: 'cancelled' };
    console.error('purchase failed', error);
    return { status: 'failed', message: "That purchase didn't go through." };
  }
}

/**
 * §8.3 [HARD]: Restore Purchases must be present and functional on the paywall
 * AND in Settings. Its absence is a guaranteed App Store rejection.
 */
export async function restorePurchases(): Promise<PurchaseOutcome> {
  try {
    const info = await Purchases.restorePurchases();
    return { status: 'purchased', info };
  } catch (error) {
    console.error('restore failed', error);
    return { status: 'failed', message: "Couldn't restore purchases." };
  }
}
