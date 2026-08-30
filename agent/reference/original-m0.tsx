import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, useMemo, useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { motion, AnimatePresence } from "motion/react";
import { ArrowLeft } from "lucide-react";

export const Route = createFileRoute("/m0")({
  component: M0Calculator,
  head: () => ({
    meta: [
      { title: "The Chatterbox — M0 Commission Calculator" },
      { name: "description", content: "M0 commission calculator with projected premium based on working days." },
    ],
  }),
});

const QUOTES = [
  "Every call is a new opportunity — treat the next one like your biggest sale of the day.",
  "Success in sales isn't luck. It's consistency, confidence, and one more call than everyone else.",
  "Don't count the calls you make — make the calls count.",
  "Rejection is just progress in disguise. Every 'no' gets you closer to a 'yes.'",
  "The top agents aren't the luckiest — they're the most persistent.",
  "Energy transfers over the phone. If you sound confident, people trust you.",
  "Small improvements each call turn average agents into top performers.",
  "One great conversation can change your entire day — make this next call that one.",
];

function projectCommission(
  numberOfDaysWorked: number,
  numberOfAvailableWorkingDaysInPeriod: number,
  totalGWPExVAT: number
): number {
  return (totalGWPExVAT / numberOfDaysWorked) * numberOfAvailableWorkingDaysInPeriod;
}

const formatCurrency = (value: number) => {
  return `R ${value.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
};

function M0Calculator() {
  const [numberOfDaysWorked, setNumberOfDaysWorked] = useState<string>("");
  const [numberOfAvailableWorkingDays, setNumberOfAvailableWorkingDays] = useState<string>("");
  const [totalGWP, setTotalGWP] = useState<string>("");
  const [quoteIndex, setQuoteIndex] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setQuoteIndex((prev) => (prev + 1) % QUOTES.length);
    }, 30000);
    return () => clearInterval(interval);
  }, []);

  const metrics = useMemo(() => {
    const daysWorked = parseFloat(numberOfDaysWorked);
    const availableDays = parseFloat(numberOfAvailableWorkingDays);
    const gwp = parseFloat(totalGWP);

    if (isNaN(daysWorked) || isNaN(availableDays) || isNaN(gwp) || daysWorked <= 0) {
      return null;
    }

    const averageGWP = gwp / daysWorked;
    const premiumProjected = projectCommission(daysWorked, availableDays, gwp);
    const remainingDays = availableDays - daysWorked;

    return {
      averageGWP,
      premiumProjected,
      remainingDays,
    };
  }, [numberOfDaysWorked, numberOfAvailableWorkingDays, totalGWP]);

  return (
    <div className="min-h-screen bg-background text-foreground p-4 md:p-8 font-sans">
      <div className="max-w-5xl mx-auto space-y-12">
        {/* Header */}
        <header className="text-center space-y-6">
          <div className="space-y-2">
            <h1 className="text-4xl md:text-6xl tracking-tight uppercase">
              <span className="font-light text-foreground">The </span>
              <span className="font-bold text-foreground">Chatter</span>
              <span className="font-bold text-primary">box</span>
            </h1>
            <p className="text-muted-foreground font-medium uppercase tracking-widest text-sm">
              Matrix VAS Commission Calculator — August (M0)
            </p>
          </div>

          {/* Motivational Quote Section */}
          <div className="h-12 flex items-center justify-center overflow-hidden">
            <AnimatePresence mode="wait">
              <motion.p
                key={quoteIndex}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.5 }}
                className="text-primary italic font-medium text-center max-w-2xl px-4"
              >
                &ldquo;{QUOTES[quoteIndex]}&rdquo;
              </motion.p>
            </AnimatePresence>
          </div>
        </header>

        {/* Back Button */}
        <div>
          <Link to="/">
            <Button variant="outline" className="gap-2 border-primary/30 hover:bg-primary/10">
              <ArrowLeft className="w-4 h-4" />
              Back to main calculator
            </Button>
          </Link>
        </div>

        {/* Section 1 — INPUTS */}
        <section className="space-y-4">
          <h2 className="text-primary font-bold uppercase tracking-wider text-sm">
            Inputs
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label htmlFor="daysWorked">Number of days worked</Label>
              <Input
                id="daysWorked"
                type="number"
                placeholder="e.g. 14"
                value={numberOfDaysWorked}
                onChange={(e) => setNumberOfDaysWorked(e.target.value)}
                className="bg-card border-primary/30 focus:ring-primary"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="availableDays">Number of available working days in period</Label>
              <Input
                id="availableDays"
                type="number"
                placeholder="e.g. 20"
                value={numberOfAvailableWorkingDays}
                onChange={(e) => setNumberOfAvailableWorkingDays(e.target.value)}
                className="bg-card border-primary/30 focus:ring-primary"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="totalGWP">Total GWP <span className="font-bold text-destructive">EX VAT</span> (R)</Label>
              <Input
                id="totalGWP"
                type="number"
                placeholder="e.g. 14960"
                value={totalGWP}
                onChange={(e) => setTotalGWP(e.target.value)}
                className="bg-card border-primary/30 focus:ring-primary"
              />
            </div>
          </div>
        </section>

        {/* Section 2 — CALCULATED METRICS */}
        <section className="space-y-4">
          <h2 className="text-primary font-bold uppercase tracking-wider text-sm">
            Calculated Metrics
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card className="bg-card border-primary/20">
              <CardContent className="pt-6">
                <p className="text-muted-foreground text-xs uppercase font-bold mb-1">
                  Average GWP / day <span className="font-bold text-destructive">EX VAT</span>
                </p>
                <p className="text-2xl font-semibold">
                  {metrics ? formatCurrency(metrics.averageGWP) : "—"}
                </p>
              </CardContent>
            </Card>
            <Card className="bg-card border-primary/20">
              <CardContent className="pt-6">
                <p className="text-muted-foreground text-xs uppercase font-bold mb-1">
                  Premium projected <span className="font-bold text-destructive">EX VAT</span>
                </p>
                <p className="text-2xl font-semibold">
                  {metrics ? formatCurrency(metrics.premiumProjected) : "—"}
                </p>
              </CardContent>
            </Card>
            <Card className="bg-card border-primary/20">
              <CardContent className="pt-6">
                <p className="text-muted-foreground text-xs uppercase font-bold mb-1">
                  Remaining days
                </p>
                <p className="text-2xl font-semibold">
                  {metrics ? metrics.remainingDays.toFixed(0) : "—"}
                </p>
              </CardContent>
            </Card>
          </div>
        </section>

        {/* Section 3 — COMMISSION PROJECTION */}
        <section className="space-y-4">
          <h2 className="text-primary font-bold uppercase tracking-wider text-sm">
            Commission Projection
          </h2>
          <div className="bg-card border-l-4 border-primary p-8 rounded-r-lg shadow-xl">
            <div className="flex items-baseline gap-4">
              <span className="text-xl text-foreground font-medium">
                Commission projection →
              </span>
              <span className="text-4xl md:text-5xl font-black text-success drop-shadow-[0_0_20px_rgba(0,230,138,0.5)]">
                {metrics ? formatCurrency(metrics.premiumProjected) : "—"}
              </span>
            </div>
            <p className="text-muted-foreground text-sm mt-2">
              M0 commission equals 100% of premium projected
            </p>
          </div>
        </section>
      </div>
    </div>
  );
}
