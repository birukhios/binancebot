import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { num } from "./KpiStrip";

function MobilePositionCard({ p, onClose }: { p: any; onClose: (symbol: string) => void }) {
  const upnl = parseFloat(p.unrealizedProfit);
  const roi = Number(p.roiPct ?? 0);
  const netPnl = Number(p.netUnrealizedAfterCloseFee ?? upnl);
  const netRoi = Number(p.netRoiPct ?? roi);
  const liq = parseFloat(p.liquidationPrice);

  return (
    <Card>
      <CardContent className="space-y-2 p-3">
        <div className="flex items-center justify-between">
          <div className="font-mono text-sm font-semibold">
            {p.symbol} <span className="text-xs text-muted-foreground">{p.leverage}x</span>
          </div>
          <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => {
            if (confirm(`Market-close ${p.symbol}?`)) onClose(p.symbol);
          }}>Close</Button>
        </div>
        <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
          <div className="text-muted-foreground">Size</div>
          <div className={`text-right ${parseFloat(p.positionAmt) >= 0 ? "text-green-600" : "text-destructive"}`}>{p.positionAmt}</div>
          <div className="text-muted-foreground">Entry / Mark</div>
          <div className="text-right">{num(p.entryPrice)} / {num(p.markPrice)}</div>
          {p.tpTargetPrice && <>
            <div className="text-muted-foreground">TP Target</div>
            <div className="text-right">{num(p.tpTargetPrice)}</div>
          </>}
          {liq > 0 && <>
            <div className="text-muted-foreground">Liquidation</div>
            <div className="text-right text-destructive">{num(liq)}</div>
          </>}
          <div className="text-muted-foreground">Gross PnL</div>
          <div className={`text-right ${upnl >= 0 ? "text-green-600" : "text-destructive"}`}>
            {num(upnl)} ({roi >= 0 ? "+" : ""}{roi.toFixed(1)}%)
          </div>
          <div className="text-muted-foreground">Net PnL</div>
          <div className={`text-right ${netPnl >= 0 ? "text-green-600" : "text-destructive"}`}>
            {num(netPnl)} ({netRoi >= 0 ? "+" : ""}{netRoi.toFixed(1)}%)
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export function PositionsTable({
  positions,
  onClose,
}: {
  positions: any[];
  onClose: (symbol: string) => void;
}) {
  if (positions.length === 0) return null;

  return (
    <>
      {/* Mobile card layout */}
      <div className="space-y-2 md:hidden">
        {positions.map((p: any) => (
          <MobilePositionCard key={p.symbol} p={p} onClose={onClose} />
        ))}
      </div>

      {/* Desktop table */}
      <div className="hidden overflow-x-auto md:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Symbol</TableHead>
              <TableHead>Size</TableHead>
              <TableHead>Entry</TableHead>
              <TableHead>Mark</TableHead>
              <TableHead>TP Target</TableHead>
              <TableHead>Liq.</TableHead>
              <TableHead>Margin %</TableHead>
              <TableHead>Gross PnL</TableHead>
              <TableHead>Net PnL</TableHead>
              <TableHead>Funding</TableHead>
              <TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {positions.map((p: any) => {
              const upnl = parseFloat(p.unrealizedProfit);
              const roi = Number(p.roiPct ?? 0);
              const liq = parseFloat(p.liquidationPrice);
              const mr = Number(p.marginRatioPct ?? 0);
              const netPnl = Number(p.netUnrealizedAfterCloseFee ?? upnl);
              const netRoi = Number(p.netRoiPct ?? roi);
              const fee = Number(p.estFundingFee ?? 0);
              return (
                <TableRow key={p.symbol}>
                  <TableCell className="font-mono">
                    {p.symbol}
                    <span className="ml-1.5 text-xs text-muted-foreground">{p.leverage}x</span>
                  </TableCell>
                  <TableCell className={parseFloat(p.positionAmt) >= 0 ? "text-green-600" : "text-destructive"}>
                    {p.positionAmt}
                  </TableCell>
                  <TableCell>{num(p.entryPrice)}</TableCell>
                  <TableCell>{num(p.markPrice)}</TableCell>
                  <TableCell>{p.tpTargetPrice ? num(p.tpTargetPrice) : "—"}</TableCell>
                  <TableCell className="text-destructive">{liq > 0 ? num(liq) : "—"}</TableCell>
                  <TableCell className={mr >= 80 ? "text-destructive" : mr >= 50 ? "text-yellow-600" : ""}>
                    {mr.toFixed(1)}%
                  </TableCell>
                  <TableCell className={upnl >= 0 ? "text-green-600" : "text-destructive"}>
                    {num(upnl)} ({roi >= 0 ? "+" : ""}{roi.toFixed(1)}%)
                  </TableCell>
                  <TableCell className={netPnl >= 0 ? "text-green-600" : "text-destructive"}>
                    {num(netPnl)} ({netRoi >= 0 ? "+" : ""}{netRoi.toFixed(1)}%)
                  </TableCell>
                  <TableCell className={fee >= 0 ? "text-green-600" : "text-destructive"}>
                    {fee >= 0 ? "+" : ""}{fee.toFixed(4)}
                  </TableCell>
                  <TableCell>
                    <Button variant="outline" size="sm" onClick={() => {
                      if (confirm(`Market-close ${p.symbol}?`)) onClose(p.symbol);
                    }}>Close</Button>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </>
  );
}
