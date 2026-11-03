import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, useMemo } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/")({
  component: Index,
  head: () => ({
    meta: [
      { title: "The Chatterbox — Commission Calculator" },
      { name: "description", content: "A professional commission calculator for sales teams with real-time bracket analysis and GWP projections." },
    ],
  }),
});

// November 2026 model (Matrix Vas Comm Model_November26.xlsx + Motor Warranty Comm Model_November26.xlsx),
// generated from the workbooks by tools/gen-comm-model.mjs — never retyped (spec 040, 2026-11-03).
// Matrix VAS: gwp thresholds are ex-VAT totals (SPD × average premium × 20 dial days ÷ 1.15) — November has
// 20 dialling days (4 Nov is a public holiday, the elections); same comm amounts as October.
// Motor Warranty (MOW_*): gwp is the workbook's Net Premium Collected (gross sales × 60% FTC × R425), so the
// same pro-rata maths runs on it; the agent types gross SALES and each one is worth MOW_SALE_VALUE of premium.
const BRACKETS: Record<string, { gwp: number; comm: number }[]> = {
  EXP_DOWNUP: [
    { gwp: 4173.91, comm: 1250 }, // SPD 6
    { gwp: 4869.57, comm: 1750 }, // SPD 7
    { gwp: 5565.22, comm: 2500 }, // SPD 8
    { gwp: 6260.87, comm: 3500 }, // SPD 9
    { gwp: 6956.52, comm: 5000 }, // SPD 10
    { gwp: 8347.83, comm: 6250 }, // SPD 12
    { gwp: 9739.13, comm: 7500 }, // SPD 14
    { gwp: 11130.43, comm: 9000 }, // SPD 16
  ],
  M1: [
    { gwp: 4643.48, comm: 1250 }, // SPD 3
    { gwp: 5417.39, comm: 1833.33 }, // SPD 3.5
    { gwp: 6191.3, comm: 3000 }, // SPD 4
    { gwp: 6965.22, comm: 4136.36 }, // SPD 4.5
    { gwp: 7739.13, comm: 5000 }, // SPD 5
    { gwp: 8513.04, comm: 5785.71 }, // SPD 5.5
    { gwp: 9286.96, comm: 6875 }, // SPD 6
    { gwp: 10060.87, comm: 8087.39 }, // SPD 6.5
  ],
  M2: [
    { gwp: 6191.3, comm: 1500 }, // SPD 4
    { gwp: 6965.22, comm: 2333.33 }, // SPD 4.5
    { gwp: 7739.13, comm: 4000 }, // SPD 5
    { gwp: 8513.04, comm: 5318.18 }, // SPD 5.5
    { gwp: 9286.96, comm: 6250 }, // SPD 6
    { gwp: 10060.87, comm: 7071.43 }, // SPD 6.5
    { gwp: 10834.78, comm: 8250 }, // SPD 7
    { gwp: 11608.7, comm: 10293.04 }, // SPD 7.5
  ],
  EXP_COURTESY: [
    { gwp: 7739.13, comm: 2000 }, // SPD 5
    { gwp: 8513.04, comm: 3000 }, // SPD 5.5
    { gwp: 9286.96, comm: 5000 }, // SPD 6
    { gwp: 10060.87, comm: 6500 }, // SPD 6.5
    { gwp: 10834.78, comm: 7500 }, // SPD 7
    { gwp: 12382.61, comm: 9000 }, // SPD 8
    { gwp: 13930.43, comm: 11000 }, // SPD 9
    { gwp: 15478.26, comm: 15478.26 }, // SPD 10
  ],
  EXP_CUDDLE: [
    { gwp: 9286.96, comm: 4000 }, // SPD 6
    { gwp: 10834.78, comm: 6000 }, // SPD 7
    { gwp: 12382.61, comm: 7500 }, // SPD 8
    { gwp: 13930.43, comm: 10000 }, // SPD 9
    { gwp: 15478.26, comm: 11500 }, // SPD 10
    { gwp: 17026.09, comm: 14000 }, // SPD 11
    { gwp: 18573.91, comm: 17500 }, // SPD 12
    { gwp: 20121.74, comm: 20121.74 }, // SPD 13
    { gwp: 21669.57, comm: 21669.57 }, // SPD 14
    { gwp: 23217.39, comm: 23217.39 }, // SPD 15
  ],
  MOW_M1: [
    { gwp: 5100, comm: 1600 }, // SPD 1
    { gwp: 7650, comm: 3272.73 }, // SPD 1.5
    { gwp: 10200, comm: 5000 }, // SPD 2
    { gwp: 12750, comm: 7307.69 }, // SPD 2.5
    { gwp: 15300, comm: 9857.14 }, // SPD 3
    { gwp: 17850, comm: 12250 }, // SPD 3.5
    { gwp: 20400, comm: 14666.67 }, // SPD 4
    { gwp: 22950, comm: 18000 }, // SPD 4.5
  ],
  MOW_M2: [
    { gwp: 7650, comm: 2400 }, // SPD 1.5
    { gwp: 10200, comm: 4363.64 }, // SPD 2
    { gwp: 12750, comm: 6250 }, // SPD 2.5
    { gwp: 15300, comm: 8769.23 }, // SPD 3
    { gwp: 16575, comm: 10678.57 }, // SPD 3.25
    { gwp: 17850, comm: 12250 }, // SPD 3.5
    { gwp: 20400, comm: 14666.67 }, // SPD 4
    { gwp: 22950, comm: 18000 }, // SPD 4.5
  ],
  MOW_EXP: [
    { gwp: 12750, comm: 4000 }, // SPD 2.5
    { gwp: 14025, comm: 6000 }, // SPD 2.75
    { gwp: 15300, comm: 7500 }, // SPD 3
    { gwp: 16575, comm: 9500 }, // SPD 3.25
    { gwp: 17850, comm: 11500 }, // SPD 3.5
    { gwp: 20400, comm: 14000 }, // SPD 4
    { gwp: 22950, comm: 16500 }, // SPD 4.5
    { gwp: 25500, comm: 20000 }, // SPD 5
  ],
};
// One sale is worth R89 ÷ 1.15 on every plan except Download & Test, whose average premium
// is R40, and Motor Warranty, where one gross sale collects 60% × R425 — the what-if ("one more
// sale a day") must add THAT plan's sale value.
const MOW_SALE_VALUE = 0.6 * 425;
const SALE_VALUES: Record<string, number> = { EXP_DOWNUP: 40 / 1.15, MOW_M1: 0.6 * 425, MOW_M2: 0.6 * 425, MOW_EXP: 0.6 * 425 };

// "If Average Premium is under R425 then 20% of total earnings" (Motor Warranty workbook). Read as a 20%
// DEDUCTION — the VT workbook writes the same rule's penalty tier as -0.2 of total comm earnings
// (spec 040 §4). Commission figures are multiplied by `keep` while the entered average premium is under `under`.
const PREMIUM_FLOOR: Record<string, { under: number; keep: number }> = {
  MOW_M1: { under: 425, keep: 0.8 },
  MOW_M2: { under: 425, keep: 0.8 },
  MOW_EXP: { under: 425, keep: 0.8 },
};

const TenureType = ["M1", "M2", "EXP_COURTESY", "EXP_CUDDLE", "EXP_DOWNUP", "MOW_M1", "MOW_M2", "MOW_EXP"] as const;
type TenureType = (typeof TenureType)[number];
const isMowPlan = (t: string) => t.startsWith("MOW_");


function Index() {
  const [tenure, setTenure] = useState<TenureType | "">("");
  const [completedDays, setCompletedDays] = useState<string>("");
  const [totalDays, setTotalDays] = useState<string>("20");
  const [totalGWP, setTotalGWP] = useState<string>("");
  const [grossSales, setGrossSales] = useState<string>("");
  const [avgPremium, setAvgPremium] = useState<string>("425");
  const [extraSales, setExtraSales] = useState<number>(1);

  // Motor Warranty: the agent types gross SALES; the formulas below run on their collected premium.
  const isMow = isMowPlan(tenure);
  const salesTyped = parseFloat(grossSales);
  // premium to the cent (no float noise at a bracket edge); a negative or blank sales count is no input
  const gwpInput = isMow
    ? (grossSales.trim() === "" || isNaN(salesTyped) || salesTyped < 0 ? "" : String(Math.round(salesTyped * MOW_SALE_VALUE * 100) / 100))
    : totalGWP;
  const floor = PREMIUM_FLOOR[tenure];
  const premiumEntered = parseFloat(avgPremium);
  const premiumKnown = !isNaN(premiumEntered) && premiumEntered > 0;
  const floorApplies = !!floor && premiumKnown && premiumEntered < floor.under;
  const pay = (amount: number) => (floorApplies && floor ? amount * floor.keep : amount);   // commission after the R425 rule
  const floorRule = floor ? `An average premium under R${floor.under} reduces commission by ${Math.round((1 - floor.keep) * 100)}%.` : "";

  const formatCurrency = (value: number) =>
    `R ${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const formatSales = (sales: number) =>
    `${sales.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} sales`;
  // A premium figure on screen: rand on Matrix VAS, gross sales on Motor Warranty (premium ÷ MOW_SALE_VALUE).
  const formatWritten = (value: number) => (isMow ? formatSales(value / MOW_SALE_VALUE) : formatCurrency(value));
  // What is still NEEDED: on Motor Warranty rounded UP to the tenth of a sale, so a target never reads short
  // (17.647 sales needed must not show as 17.6).
  const formatNeeded = (value: number) =>
    isMow ? formatSales(Math.ceil((value / MOW_SALE_VALUE) * 10 - 1e-9) / 10) : formatCurrency(value);

  const metrics = useMemo(() => {
    const cDays = parseFloat(completedDays);
    const tDays = parseFloat(totalDays);
    const gwp = parseFloat(gwpInput);
    if (isNaN(cDays) || isNaN(tDays) || isNaN(gwp) || cDays <= 0) return null;
    return {
      averageGWP: gwp / cDays,
      premiumProjected: (gwp / cDays) * tDays,
      remainingDays: tDays - cDays,
    };
  }, [completedDays, totalDays, gwpInput]);

  const getCommissionForProjected = (projected: number) => {
    if (!tenure) return 0;
    const brackets = BRACKETS[tenure];
    if (!brackets) return 0;
    let activeBracket = null;
    for (let i = brackets.length - 1; i >= 0; i--) {
      if (projected >= brackets[i].gwp) {
        activeBracket = brackets[i];
        break;
      }
    }
    return activeBracket ? projected * (activeBracket.comm / activeBracket.gwp) : 0;
  };

  const projection = useMemo(() => {
    if (!tenure || !metrics) return null;
    return getCommissionForProjected(metrics.premiumProjected);
  }, [tenure, metrics]);

  const nextMoveData = useMemo(() => {
    if (!tenure || !metrics) return null;
    const brackets = BRACKETS[tenure];
    if (!brackets) return null;
    const gwp = parseFloat(gwpInput);
    const projected = metrics.premiumProjected;
    let nextBracket = null;
    for (const bracket of brackets) {
      if (projected < bracket.gwp) {
        nextBracket = bracket;
        break;
      }
    }
    if (!nextBracket) return null;
    const gap = nextBracket.gwp - gwp;
    const neededPerDay = metrics.remainingDays > 0 ? gap / metrics.remainingDays : null;
    const extraComm = nextBracket.comm - (projection ?? 0);
    return { nextComm: nextBracket.comm, gap, neededPerDay, extraComm };
  }, [tenure, metrics, gwpInput, projection]);

  const SALE_VALUE = 89 / 1.15; // R89 avg premium inc VAT — what-if adds its ex-VAT value onto the ex-VAT projection
  // the selected plan's own sale value (SALE_VALUES), else R89 ÷ 1.15 — Download & Test and Motor Warranty differ
  const saleValue = (tenure ? SALE_VALUES[tenure] : undefined) ?? SALE_VALUE;

  const whatIfData = useMemo(() => {
    if (!metrics || !tenure) return null;
    const gwp = parseFloat(gwpInput);
    const remDays = metrics.remainingDays;
    const extraGWP = extraSales * saleValue * remDays;
    const newProjected = metrics.premiumProjected + extraGWP;
    const newComm = getCommissionForProjected(newProjected);
    const extraVsCurrent = newComm - (projection ?? 0);
    return { newPremium: newProjected, newComm, extraVsCurrent };
  }, [metrics, tenure, extraSales, projection, gwpInput]);

  const finalAnalysis = useMemo(() => {
    if (!tenure || !metrics) return null;
    const brackets = BRACKETS[tenure];
    if (!brackets) return null;
    const gwp = parseFloat(gwpInput);
    const remDays = metrics.remainingDays;
    const projected = metrics.premiumProjected;

    let activeIndex = -1;
    for (let i = brackets.length - 1; i >= 0; i--) {
      if (projected >= brackets[i].gwp) {
        activeIndex = i;
        break;
      }
    }

    return brackets.map((bracket, index) => {
      const gwpGapTotal = bracket.gwp - gwp;
      const gwpGapPerRemainingDay = remDays > 0 ? gwpGapTotal / remDays : null;
      let status: "beat" | "current" | "next_target" | "not_reached" = "not_reached";
      if (index === activeIndex) status = "current";
      else if (activeIndex >= 0 && index < activeIndex) status = "beat";
      else if (gwpGapTotal <= 0) status = "beat";
      else if (activeIndex >= 0 && index === activeIndex + 1) status = "next_target";
      return {
        ...bracket,
        targetIncVat: bracket.gwp,
        gwpGapTotal,
        gwpGapPerRemainingDay,
        status,
      };
    });
  }, [tenure, metrics, gwpInput]);

  const nextTargetData = useMemo(() => {
    if (!tenure || !metrics || !finalAnalysis) return null;
    const brackets = BRACKETS[tenure];
    if (!brackets) return null;
    const activeIndex = finalAnalysis.findIndex((r) => r.status === "current");
    const remDays = metrics.remainingDays;

    if (activeIndex === -1) {
      const first = finalAnalysis[0];
      return {
        kind: "none" as const,
        perDay: first.gwpGapPerRemainingDay,
      };
    }
    if (activeIndex >= brackets.length - 1) {
      return { kind: "top" as const };
    }
    const nextBracket = brackets[activeIndex + 1];
    const gap = nextBracket.gwp - parseFloat(gwpInput);
    const perDay = remDays > 0 ? gap / remDays : null;
    const extra = nextBracket.comm - (projection ?? 0);
    return {
      kind: "next" as const,
      bracketNumber: activeIndex + 2,
      perDay,
      nextComm: nextBracket.comm,
      extra,
    };
  }, [tenure, metrics, finalAnalysis, gwpInput, projection]);

  const isValid = tenure && completedDays && gwpInput && metrics;
  const closeToPayout = nextMoveData && nextMoveData.neededPerDay !== null;

  return (
    <div className="min-h-screen bg-background text-foreground p-4 md:p-8 font-sans">
      <div className="max-w-6xl mx-auto space-y-8">
        {/* Header */}
        <header className="text-center space-y-3 pt-4">
          <div className="inline-flex items-center gap-2 bg-primary/10 border border-primary/20 backdrop-blur-sm rounded-full px-5 py-2 mb-2">
            <div className="w-2 h-2 rounded-full bg-primary animate-pulse" />
            <span className="text-primary font-semibold tracking-widest text-[11px] uppercase">Chatterbox</span>
          </div>
          <h1 className="text-4xl md:text-6xl tracking-tight font-bold">
            <span className="text-foreground">CHATTER</span>
            <span className="text-primary">BOX</span>
          </h1>
          <p className="text-muted-foreground font-medium uppercase tracking-[0.25em] text-[11px]">
            Matrix VAS &amp; Motor Warranty Commission Calculator — November
          </p>
          <div className="w-24 h-0.5 bg-gradient-to-r from-transparent via-primary/50 to-transparent mx-auto mt-2" />
        </header>

        {/* Two-column layout */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* LEFT COLUMN */}
          <div className="space-y-6">
            {/* Inputs */}
            <div className="backdrop-blur-md bg-card rounded-2xl p-6 border border-border shadow-[0_0_30px_-12px_rgba(43,138,255,0.15)]">
              <h2 className="text-primary font-bold uppercase tracking-wider text-sm mb-5 flex items-center gap-2">
                <span className="w-1 h-5 rounded-full bg-primary" />
                Inputs
              </h2>
              <div className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="tenure" className="text-muted-foreground text-xs font-medium">Tenure</Label>
                  <Select
                    value={tenure}
                    onValueChange={(v) => {
                      if (v === "M0_LINK") return;
                      setTenure(v as TenureType);
                    }}
                  >
                    <SelectTrigger id="tenure" className="bg-muted/50 border-border backdrop-blur-sm focus:ring-primary focus:border-primary/40">
                      <SelectValue placeholder="Select Tenure" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        <SelectLabel>Matrix VAS</SelectLabel>
                        <SelectItem value="M1">M1</SelectItem>
                        <SelectItem value="M2">M2</SelectItem>
                        <SelectItem value="EXP_COURTESY">Exp — Courtesy</SelectItem>
                        <SelectItem value="EXP_CUDDLE">Exp Cuddle</SelectItem>
                        <SelectItem value="EXP_DOWNUP">Exp — Download &amp; Test</SelectItem>
                      </SelectGroup>
                      <SelectSeparator />
                      <SelectGroup>
                        <SelectLabel>Motor Warranty</SelectLabel>
                        <SelectItem value="MOW_M1">Motor Warranty — Month 1</SelectItem>
                        <SelectItem value="MOW_M2">Motor Warranty — Month 2</SelectItem>
                        <SelectItem value="MOW_EXP">Motor Warranty — Exp</SelectItem>
                      </SelectGroup>
                      <SelectSeparator />
                      <Link to="/m0" className="block">
                        <div className="relative flex w-full cursor-pointer select-none items-center rounded-sm py-1.5 pl-8 pr-2 text-sm text-primary font-medium hover:bg-primary/10 outline-none">
                          M0 Calculator →
                        </div>
                      </Link>
                    </SelectContent>

                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="completedDays" className="text-muted-foreground text-xs font-medium">Total working days passed</Label>
                  <Input
                    id="completedDays"
                    type="number"
                    placeholder="e.g. 14"
                    value={completedDays}
                    onChange={(e) => setCompletedDays(e.target.value)}
                    className="bg-muted/50 border-border backdrop-blur-sm focus:ring-primary focus:border-primary/40"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="totalDays" className="text-muted-foreground text-xs font-medium">Total dial days in period</Label>
                  <Input
                    id="totalDays"
                    type="number"
                    value={totalDays}
                    onChange={(e) => setTotalDays(e.target.value)}
                    className="bg-muted/50 border-border backdrop-blur-sm focus:ring-primary focus:border-primary/40"
                  />
                  <p className="text-[11px] text-muted-foreground">
                    {totalDays === "20"
                      ? "November 2026 — 20 working days (4 Nov is a public holiday)"
                      : "Custom — adjusted from 20 working days"}
                  </p>

                </div>
                {isMow ? (
                  <>
                    <div className="space-y-1.5">
                      <Label htmlFor="grossSales" className="text-muted-foreground text-xs font-medium">Gross sales written so far</Label>
                      <Input
                        id="grossSales"
                        type="number"
                        inputMode="decimal"
                        min={0}
                        step="any"
                        aria-describedby="grossSalesHint"
                        placeholder="e.g. 18"
                        value={grossSales}
                        onChange={(e) => setGrossSales(e.target.value)}
                        className="bg-muted/50 border-border backdrop-blur-sm focus:ring-primary focus:border-primary/40"
                      />
                      <p id="grossSalesHint" className="text-[11px] text-muted-foreground">Each gross sale counts as 60% collected × R425 = {formatCurrency(MOW_SALE_VALUE)} net premium.</p>
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="avgPremium" className="text-muted-foreground text-xs font-medium">Average premium (R)</Label>
                      <Input
                        id="avgPremium"
                        type="number"
                        inputMode="decimal"
                        min={0}
                        step="any"
                        aria-describedby="avgPremiumHint"
                        value={avgPremium}
                        onChange={(e) => setAvgPremium(e.target.value)}
                        className="bg-muted/50 border-border backdrop-blur-sm focus:ring-primary focus:border-primary/40"
                      />
                      <p id="avgPremiumHint" aria-live="polite" className={cn("text-[11px]", floorApplies || !premiumKnown ? "text-destructive font-semibold" : "text-muted-foreground")}>
                        {floorApplies && floor
                          ? `Under R${floor.under}: commission is reduced by ${Math.round((1 - floor.keep) * 100)}% — every amount below already shows it.`
                          : !premiumKnown
                            ? `Enter your average premium. ${floorRule} Amounts below are shown before that rule.`
                            : floorRule}
                      </p>
                    </div>
                  </>
                ) : (
                  <div className="space-y-1.5">
                    <Label htmlFor="totalGWP" className="text-muted-foreground text-xs font-medium">
                      Total GWP (<span className="font-bold text-destructive">EX VAT</span>)
                    </Label>
                    <Input
                      id="totalGWP"
                      type="number"
                      placeholder="e.g. 14960"
                      value={totalGWP}
                      onChange={(e) => setTotalGWP(e.target.value)}
                      className="bg-muted/50 border-border backdrop-blur-sm focus:ring-primary focus:border-primary/40"
                    />
                  </div>
                )}
              </div>
            </div>

            {/* Your Position */}
            <div className="backdrop-blur-md bg-card rounded-2xl p-6 border border-border shadow-[0_0_30px_-12px_rgba(43,138,255,0.15)]">
              <h2 className="text-primary font-bold uppercase tracking-wider text-sm mb-5 flex items-center gap-2">
                <span className="w-1 h-5 rounded-full bg-accent" />
                Your Position
              </h2>
              <div className="space-y-4">
                {[
                  { label: isMow ? "Average gross sales / day" : <>Average GWP / day (<span className="font-bold text-destructive">EX VAT</span>)</>, value: metrics ? formatWritten(metrics.averageGWP) : "—" },
                  { label: isMow ? "Gross sales projected" : <>Premium Projected <span className="font-bold text-destructive">EX VAT</span></>, value: metrics ? formatWritten(metrics.premiumProjected) : "—" },
                  { label: "Remaining days", value: metrics ? metrics.remainingDays.toFixed(0) : "—" },
                ].map((item, i) => (
                  <div key={i} className="flex justify-between items-center py-2 border-b border-border/50 last:border-0">
                    <span className="text-muted-foreground text-sm">{item.label}</span>
                    <span className="font-mono font-semibold text-foreground">{item.value}</span>
                  </div>
                ))}
              </div>
              {(() => {
                const cDays = parseFloat(completedDays);
                const tDays = parseFloat(totalDays);
                if (isNaN(cDays) || isNaN(tDays) || tDays <= 0) return null;
                const pct = Math.max(0, Math.min(100, (cDays / tDays) * 100));
                const barColor = pct >= 100 ? "#00C896" : pct > 75 ? "#F5A623" : "#2B7DE9";
                return (
                  <div className="mt-5 pt-4 border-t border-border/50">
                    <p className="text-xs text-muted-foreground mb-2">
                      📊 Dialling Day Pace — {cDays} of {tDays} days complete ({pct.toFixed(0)}% of period)
                    </p>
                    <div className="h-2 w-full rounded-full bg-muted/60 overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all duration-500"
                        style={{ width: `${pct}%`, backgroundColor: barColor }}
                      />
                    </div>
                  </div>
                );
              })()}
            </div>
          </div>

          {/* RIGHT COLUMN */}
          <div className="space-y-6">
            {/* Commission Projection */}
            <div className="backdrop-blur-md bg-card rounded-2xl p-6 border border-primary/30 shadow-[0_0_40px_-10px_rgba(43,138,255,0.2)] relative overflow-hidden">
              <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-accent/5 pointer-events-none" />
              <h2 className="text-primary font-bold uppercase tracking-wider text-sm mb-4 flex items-center gap-2 relative">
                <span className="w-1 h-5 rounded-full bg-primary" />
                Commission Projection
              </h2>
              <p className="text-5xl md:text-6xl font-black text-center my-6 relative font-mono">
                <span className="text-success">
                  {projection !== null ? formatCurrency(pay(projection)) : "—"}
                </span>
              </p>
              {isValid && closeToPayout && (
                <p className="text-muted-foreground text-sm text-center relative">You are close to the next payout jump.</p>
              )}
              {isValid && isMow && floor && !premiumKnown && (
                <p className="text-destructive text-xs text-center relative mt-2">
                  Average premium not entered — shown before the R{floor.under} rule.
                </p>
              )}
              {isValid && floorApplies && floor && (
                <p className="text-destructive text-xs text-center relative mt-2">
                  Average premium under R{floor.under} — shown after the {Math.round((1 - floor.keep) * 100)}% reduction.
                </p>
              )}
            </div>

            {/* Next Move */}
            <div className="backdrop-blur-md bg-card rounded-2xl p-6 border border-border shadow-[0_0_30px_-12px_rgba(43,138,255,0.15)]">
              <h2 className="text-primary font-bold uppercase tracking-wider text-sm mb-3 flex items-center gap-2">
                <span className="w-1 h-5 rounded-full bg-warning" />
                Next Move
              </h2>
              {nextMoveData ? (
                <>
                  <p className="text-accent text-sm font-medium mb-4">This next push could lift your payout.</p>
                  <div className="grid grid-cols-3 gap-3">
                    {[
                      { label: "Next Bracket Comm", value: formatCurrency(pay(nextMoveData.nextComm)) },
                      { label: "Gap to Next Bracket", value: formatNeeded(nextMoveData.gap) },
                      { label: "Needed / Rem. Day", value: nextMoveData.neededPerDay !== null ? formatNeeded(nextMoveData.neededPerDay) : "N/A" },
                    ].map((item, i) => (
                      <div key={i} className="bg-muted/40 backdrop-blur-sm rounded-xl p-3 text-center border border-border/50">
                        <p className="text-muted-foreground text-[10px] uppercase font-bold mb-1 tracking-wider">{item.label}</p>
                        <p className="text-base font-bold font-mono">{item.value}</p>
                      </div>
                    ))}
                  </div>
                  {nextMoveData.extraComm > 0 && (
                    <div className="mt-4 bg-gradient-to-r from-primary/10 to-accent/10 border border-primary/20 rounded-xl px-4 py-2.5 text-sm text-primary text-center font-medium">
                      Extra commission available: <span className="font-mono font-bold">{formatCurrency(pay(nextMoveData.extraComm))}</span>
                    </div>
                  )}
                </>
              ) : (
                <p className="text-muted-foreground text-sm italic">
                  {isValid ? "You've reached the top bracket! 🎉" : "Enter inputs to see your next move."}
                </p>
              )}
            </div>

            {/* What If You Improve */}
            <div className="backdrop-blur-md bg-card rounded-2xl p-6 border border-border shadow-[0_0_30px_-12px_rgba(43,138,255,0.15)]">
              <h2 className="text-primary font-bold uppercase tracking-wider text-sm mb-3 flex items-center gap-2">
                <span className="w-1 h-5 rounded-full bg-chart-5" />
                What If You Improve?
              </h2>
              <div className="flex gap-2 mb-4">
                {[1, 2, 3].map((sales) => (
                  <button
                    key={sales}
                    onClick={() => setExtraSales(sales)}
                    className={cn(
                      "px-5 py-2 rounded-full text-sm font-bold transition-all duration-200",
                      extraSales === sales
                        ? "bg-gradient-to-r from-primary to-accent text-primary-foreground shadow-[0_0_20px_-5px_rgba(43,138,255,0.4)]"
                        : "bg-muted/40 text-muted-foreground hover:bg-muted/60 border border-border/50"
                    )}
                  >
                    +{sales} sale{sales > 1 ? "s" : ""}
                  </button>
                ))}
              </div>
              {whatIfData && isValid ? (
                <>
                  <div className="grid grid-cols-3 gap-3">
                    {[
                      { label: "New Projected", value: formatWritten(whatIfData.newPremium), highlight: false },
                      { label: "New Commission", value: formatCurrency(pay(whatIfData.newComm)), highlight: true },
                      { label: "Extra vs Current", value: `${whatIfData.extraVsCurrent >= 0 ? "+" : ""}${formatCurrency(pay(whatIfData.extraVsCurrent))}`, highlight: true },
                    ].map((item, i) => (
                      <div key={i} className="bg-muted/40 backdrop-blur-sm rounded-xl p-3 text-center border border-border/50">
                        <p className="text-muted-foreground text-[10px] uppercase font-bold mb-1 tracking-wider">{item.label}</p>
                        <p className={cn("text-base font-bold font-mono", item.highlight && "text-primary")}>{item.value}</p>
                      </div>
                    ))}
                  </div>
                  <p className="text-muted-foreground text-xs mt-3 text-center">
                    +{extraSales} extra sale{extraSales > 1 ? "s" : ""} per day could boost your payout.
                  </p>
                </>
              ) : (
                <p className="text-muted-foreground text-sm italic">Enter inputs to see projections.</p>
              )}
            </div>
          </div>
        </div>

        {/* Next Target Banner */}
        {isValid && nextTargetData && (
          <div
            className="rounded-2xl p-6 md:p-7 text-white shadow-[0_10px_40px_-10px_rgba(43,125,233,0.55)] border border-white/10 relative overflow-hidden"
            style={{ background: "linear-gradient(135deg, #2B7DE9 0%, #1A5FC8 100%)" }}
          >
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(255,255,255,0.15),transparent_60%)] pointer-events-none" />
            {nextTargetData.kind === "next" && (
              <div className="relative flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                <div className="space-y-1">
                  <p className="text-xs font-bold uppercase tracking-[0.25em] text-white/80">
                    🎯 Next Target — Bracket {nextTargetData.bracketNumber}
                  </p>
                  <p className="text-base md:text-lg font-medium text-white/95">
                    Write{" "}
                    <span className="font-mono font-bold text-white">
                      {nextTargetData.perDay !== null ? formatNeeded(nextTargetData.perDay) : "N/A"}
                    </span>{" "}
                    more per remaining day to earn{" "}
                    <span className="font-mono font-bold text-white">
                      {formatCurrency(pay(nextTargetData.nextComm))}
                    </span>
                  </p>
                </div>
                <div className="text-left md:text-right">
                  <p className="text-[10px] uppercase tracking-widest text-white/70 font-bold mb-1">
                    Extra in your pocket
                  </p>
                  <p
                    className="text-3xl md:text-4xl font-black font-mono leading-none"
                    style={{ color: "#F5A623", textShadow: "0 0 20px rgba(245,166,35,0.4)" }}
                  >
                    +{formatCurrency(pay(nextTargetData.extra))}
                  </p>
                </div>
              </div>
            )}
            {nextTargetData.kind === "top" && (
              <div className="relative text-center py-2">
                <p className="text-2xl md:text-3xl font-black">
                  🏆 You're at the top bracket! Maximum commission achieved!
                </p>
              </div>
            )}
            {nextTargetData.kind === "none" && (
              <div className="relative text-center py-2">
                <p className="text-lg md:text-xl font-bold">
                  💪 Keep pushing! Write{" "}
                  <span
                    className="font-mono font-black"
                    style={{ color: "#F5A623" }}
                  >
                    {nextTargetData.perDay !== null ? formatNeeded(nextTargetData.perDay) : "N/A"}
                  </span>{" "}
                  per day to hit your first bracket
                </p>
              </div>
            )}
          </div>
        )}

        {/* Bracket Gap Analysis — Full Width */}
        <div className="backdrop-blur-md bg-card rounded-2xl p-6 border border-border shadow-[0_0_30px_-12px_rgba(43,138,255,0.15)]">
          <h2 className="text-primary font-bold uppercase tracking-wider text-sm mb-1 flex items-center gap-2">
            <span className="w-1 h-5 rounded-full bg-primary" />
            Bracket Gap Analysis
          </h2>
          <p className="text-muted-foreground text-xs mb-4 ml-3">
            {isMow ? "Gross sales needed per remaining day to reach each bracket" : "GWP needed per remaining day to reach each bracket"}
          </p>

          {!isValid ? (
            <div className="bg-muted/20 border border-dashed border-border p-12 text-center rounded-xl">
              <p className="text-muted-foreground italic">Select tenure and enter inputs above</p>
            </div>
          ) : (
            <div className="rounded-xl overflow-hidden border border-border">
              <Table>
                <TableHeader className="bg-muted/30">
                  <TableRow className="hover:bg-muted/30 border-border/50">
                    <TableHead className="text-muted-foreground font-bold text-xs">#</TableHead>
                    <TableHead className="text-muted-foreground font-bold text-xs">{isMow ? "Bracket gross sales" : <>Bracket GWP (<span className="text-destructive font-bold">EX VAT</span>)</>}</TableHead>
                    <TableHead className="text-muted-foreground font-bold text-xs">Bracket comm</TableHead>
                    <TableHead className="text-muted-foreground font-bold text-xs">{isMow ? "Sales gap total" : "GWP gap total"}</TableHead>
                    <TableHead className="text-muted-foreground font-bold text-xs">{isMow ? "Sales gap / remaining day" : "GWP gap / remaining day"}</TableHead>
                    <TableHead className="text-muted-foreground font-bold text-xs">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {finalAnalysis?.map((row, idx) => (
                    <TableRow key={idx} className={cn(
                      "border-border/30 transition-colors",
                      row.status === "beat" && "bg-success/5",
                      row.status === "current" && "bg-warning/5",
                      row.status === "next_target" && "bg-primary/5",
                    )}>
                      <TableCell className="font-mono font-medium text-muted-foreground">{idx + 1}</TableCell>
                      <TableCell className="text-primary font-mono font-medium">{formatWritten(row.targetIncVat)}</TableCell>
                      <TableCell className="font-mono">{formatCurrency(pay(row.comm))}</TableCell>
                      <TableCell className={cn("font-mono", row.gwpGapTotal <= 0 && "text-success font-bold")}>
                        {formatNeeded(row.gwpGapTotal)}
                      </TableCell>
                      <TableCell className={cn("font-mono", row.gwpGapPerRemainingDay !== null && row.gwpGapPerRemainingDay <= 0 && "text-success")}>
                        {row.gwpGapPerRemainingDay !== null ? formatNeeded(row.gwpGapPerRemainingDay) : "N/A"}
                      </TableCell>
                      <TableCell>
                        {row.status === "beat" && (
                          <Badge className="bg-success/20 text-success hover:bg-success/30 border border-success/30 px-3 py-0.5 text-[10px] font-bold">BEAT</Badge>
                        )}
                        {row.status === "current" && (
                          <Badge className="bg-warning/20 text-warning hover:bg-warning/30 border border-warning/30 px-3 py-0.5 text-[10px] font-bold">CURRENT</Badge>
                        )}
                        {row.status === "next_target" && (
                          <Badge className="bg-primary/20 text-primary hover:bg-primary/30 border border-primary/30 px-3 py-0.5 text-[10px] font-bold">NEXT TARGET</Badge>
                        )}
                        {row.status === "not_reached" && (
                          <span className="text-muted-foreground text-xs">NOT REACHED</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
