import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Bell, X } from "lucide-react";
import { toast } from "sonner";
import {
  subscribeToPush,
  getNotificationPermission,
  canEnableNotifications,
} from "@/lib/push-notifications";

const DISMISS_KEY = "bkbot-notif-dismissed";

export function NotificationPrompt() {
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("Notification" in window)) return;
    if (getNotificationPermission() !== "default") return; // granted or blocked
    // Only offer when push can actually be enabled now: any non-iOS browser, or
    // an iOS PWA that has been installed to the Home Screen and opened from it.
    if (!canEnableNotifications()) return;
    if (window.sessionStorage.getItem(DISMISS_KEY)) return;
    setVisible(true);
  }, []);

  const dismiss = () => {
    setVisible(false);
    window.sessionStorage.setItem(DISMISS_KEY, "1");
  };

  const enable = async () => {
    setBusy(true);
    try {
      const res = await subscribeToPush();
      if (res.ok) {
        toast.success("Notifications enabled 🔔");
        setVisible(false);
      } else if (res.reason === "denied") {
        toast.error("Notifications blocked — enable them in your browser settings.");
        setVisible(false);
      } else {
        toast.error("Could not enable notifications.");
      }
    } finally {
      setBusy(false);
    }
  };

  if (!visible) return null;

  return (
    <div className="fixed inset-x-0 bottom-24 z-40 p-3 sm:bottom-24 sm:left-1/2 sm:right-auto sm:-translate-x-1/2">
      <div className="mx-auto flex max-w-md items-center gap-3 rounded-xl border bg-card p-4 shadow-lg">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10">
          <Bell className="h-5 w-5 text-primary" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">Trade alerts</p>
          <p className="text-xs text-muted-foreground">
            Get notified on big wins, losses & daily summaries
          </p>
        </div>
        <Button size="sm" onClick={enable} disabled={busy} className="shrink-0">
          {busy ? "…" : "Enable"}
        </Button>
        <Button
          variant="ghost"
          size="icon"
          onClick={dismiss}
          className="h-8 w-8 shrink-0"
          aria-label="Dismiss"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
