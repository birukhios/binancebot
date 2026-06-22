import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";
import { AlertTriangle, LogOut, Moon, Power, RefreshCw, SunMedium } from "lucide-react";

type ThemeMode = "light" | "dark";

export function DashboardHeader({
  cfg,
  isTestnet,
  credsReady,
  email,
  entryPauseActive,
  entryPauseUntil,
  marketSession,
  theme,
  onToggleTheme,
  onStartStop,
  startStopPending,
  onKill,
  onTestConnection,
  testConnPending,
  onSignOut,
}: {
  cfg: any;
  isTestnet: boolean;
  credsReady: boolean;
  email?: string;
  entryPauseActive: boolean;
  entryPauseUntil: number;
  marketSession: any;
  theme: ThemeMode;
  onToggleTheme: () => void;
  onStartStop: () => void;
  startStopPending: boolean;
  onKill: () => void;
  onTestConnection: () => void;
  testConnPending: boolean;
  onSignOut: () => void;
}) {
  const isRunning = !!cfg?.is_running;

  return (
    <header className="flex h-auto min-h-[3.5rem] flex-wrap items-center gap-2 border-b bg-background px-3 py-2 sm:h-14 sm:flex-nowrap sm:gap-3 sm:px-4 sm:py-0">
      <SidebarTrigger className="-ml-1" />
      <Separator orientation="vertical" className="hidden h-6 sm:block" />

      <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
        <h1 className="text-sm font-semibold">Grid Bot</h1>
        <Badge variant={isTestnet ? "secondary" : "destructive"} className="text-[10px] sm:text-xs">
          {isTestnet ? "TESTNET" : "LIVE"}
        </Badge>
        <Badge
          variant={isRunning ? "default" : "outline"}
          className={`text-[10px] sm:text-xs ${isRunning ? "bg-green-600 hover:bg-green-700" : ""}`}
        >
          {isRunning ? "RUNNING" : "STOPPED"}
        </Badge>
        {entryPauseActive && (
          <Badge variant="outline" className="text-[10px] text-amber-600 sm:text-xs">
            Paused until {new Date(entryPauseUntil).toLocaleTimeString()}
          </Badge>
        )}
        {marketSession && (
          <span className="hidden text-xs text-muted-foreground lg:inline">
            {marketSession.name.replace(/_/g, " ")}
          </span>
        )}
      </div>

      <div className="ml-auto flex items-center gap-1 sm:gap-1.5">
        <span className="hidden text-xs text-muted-foreground lg:inline">{email}</span>
        <Button variant="ghost" size="icon" onClick={onToggleTheme} className="h-7 w-7 sm:h-8 sm:w-8">
          {theme === "dark" ? <SunMedium className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
        </Button>
        <Button variant="outline" size="sm" onClick={onTestConnection} disabled={testConnPending} className="hidden h-7 px-2 text-xs sm:inline-flex sm:h-8">
          <RefreshCw className="mr-1 h-3 w-3" /> Test
        </Button>
        <Button
          variant={isRunning ? "destructive" : "default"}
          size="sm"
          className="h-7 px-2 text-xs sm:h-8"
          onClick={onStartStop}
          disabled={startStopPending || (!isRunning && !credsReady)}
        >
          <Power className="mr-1 h-3 w-3 sm:mr-1.5 sm:h-3.5 sm:w-3.5" />
          {isRunning ? "Stop" : "Start"}
        </Button>
        <Button variant="destructive" size="sm" className="h-7 w-7 px-0 sm:h-8 sm:w-8" onClick={onKill}>
          <AlertTriangle className="h-3 w-3 sm:h-3.5 sm:w-3.5" />
        </Button>
        <Button variant="ghost" size="icon" onClick={onSignOut} className="h-7 w-7 sm:h-8 sm:w-8">
          <LogOut className="h-3.5 w-3.5" />
        </Button>
      </div>
    </header>
  );
}
