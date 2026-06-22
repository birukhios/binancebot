import { Card, CardContent } from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { num } from "./KpiStrip";

export function OrdersTable({
  openOrders,
  snapshotAt,
}: {
  openOrders: any[];
  snapshotAt: string | null;
}) {
  if (openOrders.length === 0) {
    return <p className="text-sm text-muted-foreground">No open grid orders.</p>;
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>{openOrders.length} live order{openOrders.length === 1 ? "" : "s"}</span>
        <span>Sync: {snapshotAt ? new Date(snapshotAt).toLocaleTimeString() : "—"}</span>
      </div>

      {/* Mobile card layout */}
      <div className="space-y-2 md:hidden">
        {openOrders.map((o: any) => (
          <Card key={`${o.symbol}-${o.orderId}`}>
            <CardContent className="p-3">
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                <div className="text-muted-foreground">Symbol</div>
                <div className="text-right font-mono">{o.symbol}</div>
                <div className="text-muted-foreground">Side</div>
                <div className={`text-right ${o.side === "BUY" ? "text-green-600" : "text-destructive"}`}>{o.side}</div>
                <div className="text-muted-foreground">Price</div>
                <div className="text-right">{num(o.price)}</div>
                <div className="text-muted-foreground">Qty</div>
                <div className="text-right">{num(o.origQty)}</div>
                <div className="text-muted-foreground">Notional</div>
                <div className="text-right">{num(o.notional)} USDT</div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Desktop table */}
      <div className="hidden overflow-x-auto md:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Symbol</TableHead>
              <TableHead>Side</TableHead>
              <TableHead>Price</TableHead>
              <TableHead>Qty</TableHead>
              <TableHead>Notional</TableHead>
              <TableHead>Est. Fee</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {openOrders.map((o: any) => (
              <TableRow key={`${o.symbol}-${o.orderId}`}>
                <TableCell className="font-mono">{o.symbol}</TableCell>
                <TableCell className={o.side === "BUY" ? "text-green-600" : "text-destructive"}>{o.side}</TableCell>
                <TableCell>{num(o.price)}</TableCell>
                <TableCell>{num(o.origQty)}</TableCell>
                <TableCell>{num(o.notional)} USDT</TableCell>
                <TableCell className="text-muted-foreground">{num(o.estMakerFeeUsdt ?? 0)}</TableCell>
                <TableCell>{o.status}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
