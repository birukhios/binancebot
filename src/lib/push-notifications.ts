export async function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return null;
  try {
    return await navigator.serviceWorker.register("/sw.js");
  } catch {
    return null;
  }
}

export function isIos() {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  // iPadOS 13+ reports as Mac; detect via touch points.
  return /iphone|ipad|ipod/i.test(ua) || (ua.includes("Macintosh") && "ontouchend" in document);
}

export function isStandalone() {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia?.("(display-mode: standalone)").matches ||
    (window.navigator as any).standalone === true
  );
}

/**
 * On iOS, web push only works when the PWA has been installed to the home
 * screen (standalone) on iOS 16.4+. In a Safari tab, PushManager is undefined.
 * Returns whether enabling notifications is possible right now.
 */
export function canEnableNotifications() {
  if (typeof window === "undefined") return false;
  if (!("serviceWorker" in navigator) || !("Notification" in window)) return false;
  if (isIos() && !isStandalone()) return false; // must install to home screen first
  return "PushManager" in window;
}

/**
 * Subscribe to push. MUST be called from a user gesture (tap) — iOS rejects
 * Notification.requestPermission() that isn't triggered by direct interaction.
 */
export async function subscribeToPush(): Promise<{ ok: boolean; reason?: string }> {
  if (isIos() && !isStandalone()) {
    return { ok: false, reason: "ios-not-installed" };
  }
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
    return { ok: false, reason: "unsupported" };
  }

  const registration =
    (await navigator.serviceWorker.getRegistration()) ?? (await registerServiceWorker());
  if (!registration) return { ok: false, reason: "no-sw" };
  await navigator.serviceWorker.ready;

  const existing = await registration.pushManager.getSubscription();
  if (existing) {
    await saveSubscription(existing);
    return { ok: true };
  }

  const permission = await Notification.requestPermission();
  if (permission !== "granted") return { ok: false, reason: "denied" };

  const vapidKey = await fetchVapidKey();
  if (!vapidKey) return { ok: false, reason: "no-key" };

  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(vapidKey),
  });

  await saveSubscription(subscription);
  return { ok: true };
}

async function fetchVapidKey(): Promise<string | null> {
  try {
    const res = await fetch("/api/push/vapid-key");
    if (!res.ok) return null;
    const data = await res.json();
    return data.key;
  } catch {
    return null;
  }
}

async function saveSubscription(subscription: PushSubscription) {
  await fetch("/api/push/subscribe", {
    method: "POST",
    headers: { "content-type": "application/json" },
    credentials: "include",
    body: JSON.stringify(subscription.toJSON()),
  });
}

export async function unsubscribeFromPush() {
  if (!("serviceWorker" in navigator)) return;
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  if (sub) {
    await sub.unsubscribe();
    await fetch("/api/push/unsubscribe", {
      method: "POST",
      credentials: "include",
    });
  }
}

export function isPushSupported() {
  return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

export function getNotificationPermission() {
  if (!("Notification" in window)) return "denied";
  return Notification.permission;
}

function urlBase64ToUint8Array(base64String: string) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}
