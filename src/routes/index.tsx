import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Toaster, toast } from "sonner";
import jsPDF from "jspdf";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import {
  ShieldAlert,
  AlertTriangle,
  Banknote,
  FileWarning,
  Lock,
  Download,
  ExternalLink,
  Building2,
  LayoutDashboard,
  Users,
  ScrollText,
  Gauge,
  Settings,
  Activity,
  ArrowRight,
  CheckCircle2,
  Circle,
  TrendingUp,
  Globe2,
  FileText,
} from "lucide-react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "CitiMock Global Portal — AML Transaction Monitoring" },
      {
        name: "description",
        content:
          "Institutional core banking AML simulation: KYC ingestion, transaction ledger, structuring/layering/integration alerts, and STR/SAR filing.",
      },
    ],
  }),
  component: Portal,
});

type TxType = "Wire Transfer" | "Cash Deposit" | "ATM Withdrawal" | "Incoming Transfer";
type TxStatus = "Completed" | "Flagged" | "Pending";
type AlertStage = "PLACEMENT" | "LAYERING" | "INTEGRATION";

interface Customer {
  id: string;
  name: string;
  country: string;
  accountNumber: string;
  riskRating: "Low" | "Medium" | "High";
  locked: boolean;
}

interface Transaction {
  id: string;
  timestamp: string;
  customerId: string;
  customerName: string;
  customerCountry: string;
  amount: number;
  type: TxType;
  status: TxStatus;
  description?: string;
  alertStage?: AlertStage;
}

interface CaseEvent {
  id: string;
  customerId: string;
  stage: AlertStage;
  message: string;
  timestamp: string;
  txId: string;
}

const HIGH_RISK_COUNTRIES = [
  "Cayman Islands", "Panama", "British Virgin Islands", "Seychelles",
  "Bahamas", "Bermuda", "Cyprus", "Malta", "Switzerland", "UAE",
];

const INTEGRATION_KEYWORDS = ["investment", "property purchase", "consulting fee"];

function uid(prefix = "") {
  return prefix + Math.random().toString(36).slice(2, 10).toUpperCase();
}

function fmtMoney(n: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);
}

function Portal() {
  const [customers, setCustomers] = useState<Customer[]>([
    { id: "C-001", name: "Sarah Chen", country: "Singapore", accountNumber: "CTM-1000-2847", riskRating: "Low", locked: false },
    { id: "C-002", name: "Marcus Reid", country: "United Kingdom", accountNumber: "CTM-1000-5519", riskRating: "Medium", locked: false },
  ]);
  const [activeCustomerId, setActiveCustomerId] = useState<string>("C-001");
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [caseEvents, setCaseEvents] = useState<CaseEvent[]>([]);
  const [strOpen, setStrOpen] = useState(false);
  const [strContext, setStrContext] = useState<{ tx?: Transaction; customer?: Customer } | null>(null);
  const [navKey, setNavKey] = useState<string>("dashboard");

  // Form state
  const [amount, setAmount] = useState("");
  const [txType, setTxType] = useState<TxType>("Cash Deposit");
  const [txStatus, setTxStatus] = useState<TxStatus>("Completed");
  const [description, setDescription] = useState("");

  // Ingest from URL parameters
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const name = params.get("customer") || params.get("name");
    const country = params.get("country");
    const risk = (params.get("risk") as Customer["riskRating"]) || "Medium";
    if (!name) return;

    setCustomers((prev) => {
      const existing = prev.find((c) => c.name.toLowerCase() === name.toLowerCase());
      if (existing) {
        setActiveCustomerId(existing.id);
        return prev;
      }
      const newC: Customer = {
        id: uid("C-"),
        name,
        country: country || "Unknown",
        accountNumber: "CTM-" + Math.floor(1000000 + Math.random() * 8999999),
        riskRating: HIGH_RISK_COUNTRIES.includes(country || "") ? "High" : risk,
        locked: false,
      };
      setActiveCustomerId(newC.id);
      toast.success(`KYC ingested: ${newC.name}`, {
        description: `Country: ${newC.country} • Risk: ${newC.riskRating}`,
      });
      return [...prev, newC];
    });
  }, []);

  const activeCustomer = useMemo(
    () => customers.find((c) => c.id === activeCustomerId),
    [customers, activeCustomerId],
  );

  const activeTxs = useMemo(
    () => transactions.filter((t) => t.customerId === activeCustomerId),
    [transactions, activeCustomerId],
  );

  const activeCaseEvents = useMemo(
    () => caseEvents.filter((e) => e.customerId === activeCustomerId),
    [caseEvents, activeCustomerId],
  );

  const stats = useMemo(() => {
    const flagged = transactions.filter((t) => t.status === "Flagged").length;
    const volume = transactions.reduce((s, t) => s + t.amount, 0);
    const highRiskAccts = customers.filter((c) => c.riskRating === "High").length;
    return { flagged, volume, highRiskAccts, total: transactions.length };
  }, [transactions, customers]);

  function evaluateAlerts(newTx: Transaction, allForCustomer: Transaction[]): AlertStage | undefined {
    const customer = customers.find((c) => c.id === newTx.customerId);
    if (!customer) return;

    const prior = allForCustomer.filter((t) => t.id !== newTx.id);
    const priorStages = caseEvents.filter((e) => e.customerId === newTx.customerId).map((e) => e.stage);

    if (newTx.type === "Incoming Transfer") {
      const desc = (newTx.description || "").toLowerCase();
      const matchedKw = INTEGRATION_KEYWORDS.some((k) => desc.includes(k));
      if (matchedKw && priorStages.includes("LAYERING")) return "INTEGRATION";
    }

    if (
      newTx.type === "Wire Transfer" &&
      newTx.amount > 20000 &&
      priorStages.includes("PLACEMENT") &&
      HIGH_RISK_COUNTRIES.includes(customer.country)
    ) return "LAYERING";

    if (
      newTx.type === "Wire Transfer" &&
      newTx.amount > 20000 &&
      priorStages.includes("PLACEMENT") &&
      customer.country !== "United States"
    ) return "LAYERING";

    if (newTx.type === "Cash Deposit") {
      const seq: Transaction[] = [newTx];
      for (let i = prior.length - 1; i >= 0; i--) {
        if (prior[i].type === "Cash Deposit") seq.push(prior[i]);
        else break;
      }
      const sum = seq.reduce((s, t) => s + t.amount, 0);
      if (sum > 10000 && seq.length >= 2) return "PLACEMENT";
    }
  }

  function addTransaction(preset?: { amount?: number; type?: TxType; status?: TxStatus; description?: string }) {
    if (!activeCustomer) return toast.error("No active customer");
    if (activeCustomer.locked) return toast.error("Account is locked — SAR filed");
    const amt = preset?.amount ?? parseFloat(amount);
    if (!amt || amt <= 0) return toast.error("Enter a valid amount");

    const tx: Transaction = {
      id: "TX-" + uid(),
      timestamp: new Date().toISOString(),
      customerId: activeCustomer.id,
      customerName: activeCustomer.name,
      customerCountry: activeCustomer.country,
      amount: amt,
      type: preset?.type ?? txType,
      status: preset?.status ?? txStatus,
      description: preset?.description ?? (description || undefined),
    };

    const updatedAll = [...transactions, tx];
    const customerTxs = updatedAll.filter((t) => t.customerId === activeCustomer.id);
    const stage = evaluateAlerts(tx, customerTxs);
    if (stage) {
      tx.alertStage = stage;
      tx.status = "Flagged";
      const stageMsg: Record<AlertStage, string> = {
        PLACEMENT: "🚨 PLACEMENT: Potential Structuring Detected",
        LAYERING: "🚨 LAYERING: Rapid Layering / Blending via Offshore Wire",
        INTEGRATION: "🚨 INTEGRATION: Funds Integrated into Clean Asset (Audit Required)",
      };
      toast.error(stageMsg[stage], { duration: 6000 });
      setCaseEvents((prev) => [
        ...prev,
        { id: uid("E-"), customerId: activeCustomer.id, stage, message: stageMsg[stage], timestamp: tx.timestamp, txId: tx.id },
      ]);
    } else {
      toast.success("Transaction posted");
    }

    setTransactions(updatedAll);
    if (!preset) {
      setAmount("");
      setDescription("");
    }
  }

  function openInvestigate(tx: Transaction) {
    const customer = customers.find((c) => c.id === tx.customerId);
    if (!customer) return;
    const url = `https://aml-kyc.lovable.app/?customer=${encodeURIComponent(customer.name)}&account=${encodeURIComponent(customer.accountNumber)}&ref=${encodeURIComponent(tx.id)}&risk=${encodeURIComponent(customer.riskRating)}`;
    window.open(url, "_blank", "noopener,noreferrer");
  }

  function openSTR(tx?: Transaction) {
    const customer = tx ? customers.find((c) => c.id === tx.customerId) : activeCustomer;
    setStrContext({ tx, customer });
    setStrOpen(true);
  }

  const stageOrder: AlertStage[] = ["PLACEMENT", "LAYERING", "INTEGRATION"];

  const navItems = [
    { key: "dashboard", label: "Dashboard", icon: LayoutDashboard },
    { key: "customers", label: "Customers", icon: Users },
    { key: "ledger", label: "Ledger", icon: ScrollText },
    { key: "alerts", label: "Alerts", icon: ShieldAlert },
    { key: "reports", label: "STR / SAR", icon: FileText },
    { key: "monitor", label: "Live Monitor", icon: Activity },
    { key: "settings", label: "Settings", icon: Settings },
  ];

  return (
    <div className="min-h-screen flex w-full bg-background text-foreground">
      <Toaster position="top-right" richColors closeButton theme="light" />

      {/* SIDEBAR */}
      <aside className="hidden md:flex w-64 flex-col bg-sidebar text-sidebar-foreground border-r border-sidebar-border">
        <div className="px-5 py-5 flex items-center gap-3 border-b border-sidebar-border">
          <div className="size-10 rounded-lg bg-gradient-to-br from-sidebar-primary to-[color-mix(in_oklab,var(--sidebar-primary)_60%,white)] flex items-center justify-center shadow-lg shadow-sidebar-primary/30">
            <Building2 className="size-5 text-sidebar-primary-foreground" />
          </div>
          <div>
            <div className="text-sm font-bold tracking-tight">CitiMock</div>
            <div className="text-[10px] uppercase tracking-[0.18em] text-sidebar-foreground/60">Global Portal</div>
          </div>
        </div>

        <nav className="flex-1 px-3 py-4 space-y-0.5">
          <div className="px-3 pb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-sidebar-foreground/45">
            Compliance Suite
          </div>
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = navKey === item.key;
            return (
              <button
                key={item.key}
                onClick={() => setNavKey(item.key)}
                className={`group w-full flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-all cursor-pointer ${
                  active
                    ? "bg-sidebar-primary/15 text-sidebar-foreground shadow-[inset_2px_0_0_0_var(--sidebar-primary)] pl-[10px]"
                    : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground hover:translate-x-0.5"
                }`}
              >
                <Icon className={`size-4 transition-transform ${active ? "text-sidebar-primary" : "group-hover:scale-110"}`} />
                <span>{item.label}</span>
                {active && <span className="ml-auto size-1.5 rounded-full bg-sidebar-primary shadow-[0_0_8px_var(--sidebar-primary)]" />}
              </button>
            );
          })}
        </nav>

        <div className="px-4 py-4 border-t border-sidebar-border">
          <div className="flex items-center gap-3">
            <div className="size-9 rounded-full bg-sidebar-accent flex items-center justify-center text-xs font-semibold">CU</div>
            <div className="flex-1 min-w-0">
              <div className="text-xs font-semibold truncate">Compliance Unit</div>
              <div className="text-[10px] text-sidebar-foreground/60 truncate">FinCEN / FATF Aligned</div>
            </div>
            <div className="size-2 rounded-full bg-emerald-ok shadow-[0_0_8px_var(--emerald-ok)]" />
          </div>
        </div>
      </aside>

      {/* MAIN */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* TOP BAR */}
        <header className="h-16 border-b border-border bg-card/60 backdrop-blur-md flex items-center px-6 gap-4 sticky top-0 z-30">
          <div>
            <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">AML Transaction Monitoring</div>
            <h1 className="text-base font-semibold tracking-tight">Tier-1 Compliance Workspace</h1>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <Badge variant="outline" className="gap-1.5 font-mono text-[10px] tracking-wider border-emerald-ok/40 text-emerald-ok bg-emerald-ok/5">
              <span className="size-1.5 rounded-full bg-emerald-ok animate-pulse" /> LIVE FEED
            </Badge>
            <Badge variant="outline" className="font-mono text-[10px]">SESSION: {new Date().toLocaleDateString()}</Badge>
          </div>
        </header>

        <main className="flex-1 p-4 md:p-6 space-y-6">
          {/* KPI STRIP */}
          <section className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <KpiCard label="Total Transactions" value={stats.total.toString()} icon={ScrollText} accent="navy" />
            <KpiCard label="Flagged Activity" value={stats.flagged.toString()} icon={AlertTriangle} accent="red" />
            <KpiCard label="High-Risk Accounts" value={stats.highRiskAccts.toString()} icon={ShieldAlert} accent="amber" />
            <KpiCard label="Monitored Volume" value={fmtMoney(stats.volume)} icon={TrendingUp} accent="gold" />
          </section>

          {/* CUSTOMER + COMMAND CENTER */}
          <section className="grid grid-cols-1 xl:grid-cols-3 gap-6">
            {/* Customer profile */}
            <div className="executive-card p-6 xl:col-span-1">
              <div className="flex items-center justify-between mb-4">
                <div className="text-[11px] uppercase tracking-[0.18em] font-semibold text-muted-foreground">Active Customer</div>
                <Gauge className="size-4 text-muted-foreground" />
              </div>
              <Select value={activeCustomerId} onValueChange={setActiveCustomerId}>
                <SelectTrigger className="bg-secondary/40"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {customers.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.name} — {c.country}</SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {activeCustomer && (
                <div className="mt-5 space-y-3">
                  <div className="flex items-center gap-3">
                    <div className="size-12 rounded-full bg-gradient-to-br from-navy to-primary text-navy-foreground flex items-center justify-center font-bold text-base">
                      {activeCustomer.name.split(" ").map(n => n[0]).join("").slice(0,2)}
                    </div>
                    <div className="min-w-0">
                      <div className="font-semibold text-sm truncate">{activeCustomer.name}</div>
                      <div className="text-[11px] text-muted-foreground flex items-center gap-1"><Globe2 className="size-3" /> {activeCustomer.country}</div>
                    </div>
                  </div>
                  <Separator />
                  <Row label="Account No." value={<span className="font-mono text-xs">{activeCustomer.accountNumber}</span>} />
                  <Row label="Risk Rating" value={<RiskBadge risk={activeCustomer.riskRating} />} />
                  <Row label="Status" value={
                    activeCustomer.locked ? (
                      <Badge variant="outline" className="alert-glow-red gap-1 font-semibold"><Lock className="size-3" /> LOCKED</Badge>
                    ) : (
                      <Badge variant="outline" className="border-emerald-ok/40 text-emerald-ok bg-emerald-ok/5 gap-1"><CheckCircle2 className="size-3" /> Active</Badge>
                    )
                  } />
                </div>
              )}
            </div>

            {/* Simulation Command Center */}
            <div className="executive-card p-6 xl:col-span-2 relative overflow-hidden">
              <div className="absolute inset-0 pointer-events-none opacity-[0.04] bg-[radial-gradient(circle_at_top_right,var(--primary),transparent_60%)]" />
              <div className="flex items-center justify-between mb-4 relative">
                <div>
                  <div className="text-[11px] uppercase tracking-[0.18em] font-semibold text-muted-foreground">Simulation Command Center</div>
                  <div className="text-sm font-semibold mt-0.5">Post & Trigger Test Transactions</div>
                </div>
                <Badge variant="outline" className="font-mono text-[10px] gap-1"><Activity className="size-3" /> SANDBOX</Badge>
              </div>

              {/* Manual posting */}
              <div className="grid grid-cols-1 md:grid-cols-4 gap-3 relative">
                <div className="space-y-1.5">
                  <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">Amount (USD)</Label>
                  <Input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" className="font-mono" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">Type</Label>
                  <Select value={txType} onValueChange={(v) => setTxType(v as TxType)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Cash Deposit">Cash Deposit</SelectItem>
                      <SelectItem value="Wire Transfer">Wire Transfer</SelectItem>
                      <SelectItem value="ATM Withdrawal">ATM Withdrawal</SelectItem>
                      <SelectItem value="Incoming Transfer">Incoming Transfer</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">Status</Label>
                  <Select value={txStatus} onValueChange={(v) => setTxStatus(v as TxStatus)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Completed">Completed</SelectItem>
                      <SelectItem value="Pending">Pending</SelectItem>
                      <SelectItem value="Flagged">Flagged</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">Description</Label>
                  <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="e.g. Consulting Fee" />
                </div>
              </div>

              <div className="mt-4 flex flex-wrap items-center gap-2 relative">
                <Button onClick={() => addTransaction()} className="gap-2 bg-navy hover:bg-navy/90 text-navy-foreground">
                  <Banknote className="size-4" /> Post Transaction
                </Button>
                <div className="h-6 w-px bg-border mx-1" />
                <span className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Quick triggers</span>
                <Button size="sm" variant="outline" onClick={() => addTransaction({ amount: 6000, type: "Cash Deposit" })}>
                  + $6k Cash
                </Button>
                <Button size="sm" variant="outline" onClick={() => addTransaction({ amount: 25000, type: "Wire Transfer", description: "Offshore wire" })}>
                  + $25k Wire
                </Button>
                <Button size="sm" variant="outline" onClick={() => addTransaction({ amount: 50000, type: "Incoming Transfer", description: "Property purchase settlement" })}>
                  + $50k Property
                </Button>
              </div>
            </div>
          </section>

          {/* CASE TIMELINE */}
          <section className="executive-card p-6">
            <div className="flex items-center justify-between mb-5">
              <div className="flex items-center gap-2">
                <FileWarning className="size-4 text-primary" />
                <div className="text-[11px] uppercase tracking-[0.18em] font-semibold text-muted-foreground">AML Case File Timeline</div>
                <span className="text-sm font-semibold text-foreground">— {activeCustomer?.name}</span>
              </div>
              {activeCaseEvents.length > 0 && (
                <Badge variant="outline" className="alert-glow-red font-semibold">
                  {activeCaseEvents.length} stage{activeCaseEvents.length > 1 ? "s" : ""} triggered
                </Badge>
              )}
            </div>

            <div className="flex items-center gap-3 flex-wrap">
              {stageOrder.map((stage, idx) => {
                const triggered = activeCaseEvents.find((e) => e.stage === stage);
                const glow = stage === "PLACEMENT" ? "alert-glow-gold" : stage === "LAYERING" ? "alert-glow-amber" : "alert-glow-red";
                return (
                  <div key={stage} className="flex items-center gap-3">
                    <div className={`rounded-xl px-4 py-3 min-w-[160px] transition-all ${triggered ? glow : "bg-muted/40 border border-dashed border-border text-muted-foreground"}`}>
                      <div className="flex items-center gap-2">
                        {triggered ? <AlertTriangle className="size-4" /> : <Circle className="size-4" />}
                        <span className="text-xs font-bold tracking-wider">{stage}</span>
                      </div>
                      <div className="text-[10px] mt-1 font-mono opacity-80">
                        {triggered ? new Date(triggered.timestamp).toLocaleTimeString() : "awaiting trigger"}
                      </div>
                    </div>
                    {idx < stageOrder.length - 1 && <ArrowRight className="size-4 text-muted-foreground" />}
                  </div>
                );
              })}
            </div>
          </section>

          {/* LEDGER — terminal style */}
          <section className="executive-card overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-3 p-5 border-b border-border bg-slate-panel/60">
              <div>
                <div className="text-[11px] uppercase tracking-[0.18em] font-semibold text-muted-foreground">Transaction Ledger</div>
                <div className="text-sm font-semibold mt-0.5">{activeCustomer?.name} · {activeTxs.length} records</div>
              </div>
              <Button variant="default" size="sm" onClick={() => openSTR()} disabled={!activeCustomer} className="gap-2 bg-navy hover:bg-navy/90 text-navy-foreground">
                <ShieldAlert className="size-4" /> File STR / SAR
              </Button>
            </div>
            <div className="overflow-x-auto terminal-table">
              <Table>
                <TableHeader>
                  <TableRow className="bg-navy/[0.03] hover:bg-navy/[0.03] border-b-2 border-border">
                    <TableHead className="text-[10px] uppercase tracking-wider font-semibold">TX ID</TableHead>
                    <TableHead className="text-[10px] uppercase tracking-wider font-semibold">Timestamp</TableHead>
                    <TableHead className="text-[10px] uppercase tracking-wider font-semibold">Customer</TableHead>
                    <TableHead className="text-[10px] uppercase tracking-wider font-semibold">Country</TableHead>
                    <TableHead className="text-[10px] uppercase tracking-wider font-semibold text-right">Amount</TableHead>
                    <TableHead className="text-[10px] uppercase tracking-wider font-semibold">Type</TableHead>
                    <TableHead className="text-[10px] uppercase tracking-wider font-semibold">Status</TableHead>
                    <TableHead className="text-[10px] uppercase tracking-wider font-semibold">Alert</TableHead>
                    <TableHead className="text-[10px] uppercase tracking-wider font-semibold text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {activeTxs.length === 0 && (
                    <TableRow><TableCell colSpan={9} className="text-center text-muted-foreground py-10 text-sm">
                      No transactions yet — use the Simulation Command Center to post one.
                    </TableCell></TableRow>
                  )}
                  {activeTxs.map((tx) => (
                    <TableRow key={tx.id} className={`group transition-colors ${tx.alertStage ? "bg-red-alert/[0.04] hover:bg-red-alert/[0.08]" : "hover:bg-secondary/60"}`}>
                      <TableCell className="font-mono text-[11px]">{tx.id}</TableCell>
                      <TableCell className="font-mono text-[11px] text-muted-foreground">{new Date(tx.timestamp).toLocaleString()}</TableCell>
                      <TableCell className="text-sm font-medium">{tx.customerName}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{tx.customerCountry}</TableCell>
                      <TableCell className="text-right font-mono font-semibold tabular-nums">{fmtMoney(tx.amount)}</TableCell>
                      <TableCell className="text-xs">{tx.type}</TableCell>
                      <TableCell><StatusBadge status={tx.status} /></TableCell>
                      <TableCell>
                        {tx.alertStage ? (
                          <Badge variant="outline" className={`gap-1 font-bold tracking-wider ${tx.alertStage === "PLACEMENT" ? "alert-glow-gold" : tx.alertStage === "LAYERING" ? "alert-glow-amber" : "alert-glow-red"}`}>
                            <AlertTriangle className="size-3" /> {tx.alertStage}
                          </Badge>
                        ) : <span className="text-xs text-muted-foreground">—</span>}
                      </TableCell>
                      <TableCell className="text-right">
                        {tx.alertStage && (
                          <div className="flex gap-1.5 justify-end">
                            <Button size="sm" variant="outline" onClick={() => openInvestigate(tx)} className="gap-1 h-7 text-[11px]">
                              <ExternalLink className="size-3" /> Investigate
                            </Button>
                            <Button size="sm" onClick={() => openSTR(tx)} className="h-7 text-[11px] gap-1 bg-red-alert hover:bg-red-alert/90 text-white">
                              <ShieldAlert className="size-3" /> File STR
                            </Button>
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </section>

          {/* GLOBAL LEDGER */}
          <section className="executive-card overflow-hidden">
            <div className="p-5 border-b border-border bg-slate-panel/60">
              <div className="text-[11px] uppercase tracking-[0.18em] font-semibold text-muted-foreground">Unified Bank-Wide Ledger</div>
              <div className="text-sm font-semibold mt-0.5">{transactions.length} total records across institution</div>
            </div>
            <div className="overflow-x-auto terminal-table">
              <Table>
                <TableHeader>
                  <TableRow className="bg-navy/[0.03] hover:bg-navy/[0.03] border-b-2 border-border">
                    <TableHead className="text-[10px] uppercase tracking-wider font-semibold">ID</TableHead>
                    <TableHead className="text-[10px] uppercase tracking-wider font-semibold">Customer</TableHead>
                    <TableHead className="text-[10px] uppercase tracking-wider font-semibold">Country</TableHead>
                    <TableHead className="text-[10px] uppercase tracking-wider font-semibold text-right">Amount</TableHead>
                    <TableHead className="text-[10px] uppercase tracking-wider font-semibold">Type</TableHead>
                    <TableHead className="text-[10px] uppercase tracking-wider font-semibold">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {transactions.length === 0 && (
                    <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8 text-sm">No bank-wide transactions yet.</TableCell></TableRow>
                  )}
                  {transactions.slice().reverse().map((tx) => (
                    <TableRow key={tx.id} className="hover:bg-secondary/60">
                      <TableCell className="font-mono text-[11px]">{tx.id}</TableCell>
                      <TableCell className="text-sm">{tx.customerName}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{tx.customerCountry}</TableCell>
                      <TableCell className="text-right font-mono tabular-nums">{fmtMoney(tx.amount)}</TableCell>
                      <TableCell className="text-xs">{tx.type}</TableCell>
                      <TableCell><StatusBadge status={tx.status} /></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </section>
        </main>
      </div>

      <STRDialog
        open={strOpen}
        onOpenChange={setStrOpen}
        context={strContext}
        onSubmitted={(customerId) => {
          setCustomers((prev) => prev.map((c) => c.id === customerId ? { ...c, locked: true } : c));
        }}
      />
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between items-center text-sm">
      <span className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</span>
      <span>{value}</span>
    </div>
  );
}

function RiskBadge({ risk }: { risk: Customer["riskRating"] }) {
  if (risk === "High") return <Badge variant="outline" className="alert-glow-red font-semibold">HIGH</Badge>;
  if (risk === "Medium") return <Badge variant="outline" className="alert-glow-amber font-semibold">MEDIUM</Badge>;
  return <Badge variant="outline" className="border-emerald-ok/40 text-emerald-ok bg-emerald-ok/5 font-semibold">LOW</Badge>;
}

function StatusBadge({ status }: { status: TxStatus }) {
  if (status === "Flagged") return <Badge variant="outline" className="alert-glow-red gap-1 font-semibold text-[10px] tracking-wider">FLAGGED</Badge>;
  if (status === "Pending") return <Badge variant="outline" className="alert-glow-amber font-semibold text-[10px] tracking-wider">PENDING</Badge>;
  return <Badge variant="outline" className="border-emerald-ok/40 text-emerald-ok bg-emerald-ok/5 font-semibold text-[10px] tracking-wider">COMPLETED</Badge>;
}

function KpiCard({
  label, value, icon: Icon, accent,
}: { label: string; value: string; icon: any; accent: "navy" | "red" | "amber" | "gold" }) {
  const accentClass =
    accent === "red" ? "from-red-alert/20 to-transparent text-red-alert" :
    accent === "amber" ? "from-amber-alert/20 to-transparent text-amber-alert" :
    accent === "gold" ? "from-gold/20 to-transparent text-gold" :
    "from-primary/20 to-transparent text-primary";
  return (
    <div className="executive-card p-5 relative overflow-hidden group">
      <div className={`absolute -top-10 -right-10 size-32 rounded-full bg-gradient-to-br ${accentClass} blur-2xl opacity-60 group-hover:opacity-100 transition`} />
      <div className="relative">
        <div className="flex items-center justify-between">
          <span className="text-[10px] uppercase tracking-[0.18em] font-semibold text-muted-foreground">{label}</span>
          <Icon className="size-4 text-muted-foreground" />
        </div>
        <div className="mt-3 text-2xl font-bold tracking-tight font-mono tabular-nums">{value}</div>
      </div>
    </div>
  );
}

function STRDialog({
  open, onOpenChange, context, onSubmitted,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  context: { tx?: Transaction; customer?: Customer } | null;
  onSubmitted: (customerId: string) => void;
}) {
  const [typology, setTypology] = useState("Structuring");
  const [narrative, setNarrative] = useState("");
  const [whoWhat, setWhoWhat] = useState("");
  const [whenWhere, setWhenWhere] = useState("");
  const [step, setStep] = useState(1);
  const [submitted, setSubmitted] = useState(false);
  const customer = context?.customer;
  const tx = context?.tx;

  useEffect(() => {
    if (open) {
      setSubmitted(false);
      setNarrative("");
      setWhoWhat("");
      setWhenWhere("");
      setStep(1);
      setTypology(tx?.alertStage === "LAYERING" ? "Money Laundering" : tx?.alertStage === "INTEGRATION" ? "Money Laundering" : "Structuring");
    }
  }, [open, tx]);

  const fullNarrative = [whoWhat, whenWhere, narrative].filter(Boolean).join("\n\n");

  function buildPDF() {
    const doc = new jsPDF();
    const now = new Date();
    const ref = "STR-" + uid();

    doc.setFontSize(16);
    doc.text("SUSPICIOUS TRANSACTION REPORT (STR / SAR)", 105, 18, { align: "center" });
    doc.setFontSize(10);
    doc.text("FinCEN-aligned • Confidential", 105, 24, { align: "center" });
    doc.line(15, 28, 195, 28);

    let y = 36;
    const line = (label: string, val: string) => {
      doc.setFont("helvetica", "bold"); doc.text(label, 15, y);
      doc.setFont("helvetica", "normal"); doc.text(val, 70, y);
      y += 7;
    };

    doc.setFont("helvetica", "bold"); doc.setFontSize(12);
    doc.text("Filer Information", 15, y); y += 7;
    doc.setFontSize(10);
    line("Filer:", "CitiMock Compliance Unit");
    line("Report Ref:", ref);
    line("Filed At:", now.toLocaleString());

    y += 3;
    doc.setFont("helvetica", "bold"); doc.setFontSize(12);
    doc.text("Suspect Details", 15, y); y += 7;
    doc.setFontSize(10);
    line("Customer Name:", customer?.name || "—");
    line("Account Number:", customer?.accountNumber || "—");
    line("Country:", customer?.country || "—");
    line("Risk Rating:", customer?.riskRating || "—");

    y += 3;
    doc.setFont("helvetica", "bold"); doc.setFontSize(12);
    doc.text("Suspicious Activity", 15, y); y += 7;
    doc.setFontSize(10);
    line("Typology:", typology);
    if (tx) {
      line("Trigger TX:", tx.id);
      line("Amount:", fmtMoney(tx.amount));
      line("Type:", tx.type);
      line("Stage:", tx.alertStage || "—");
    }

    y += 3;
    doc.setFont("helvetica", "bold"); doc.setFontSize(12);
    doc.text("Narrative (Who / What / When / Where / Why)", 15, y); y += 7;
    doc.setFont("helvetica", "normal"); doc.setFontSize(10);
    const wrapped = doc.splitTextToSize(fullNarrative || "(no narrative provided)", 180);
    doc.text(wrapped, 15, y);
    y += wrapped.length * 5 + 8;

    doc.line(15, y, 195, y); y += 6;
    doc.setFontSize(9); doc.setFont("helvetica", "italic");
    doc.text("This report is filed under 31 U.S.C. § 5318(g) — Confidential. Unauthorized disclosure is prohibited.", 15, y);

    doc.save(`${ref}_${(customer?.name || "customer").replace(/\s+/g, "_")}.pdf`);
  }

  function submit() {
    if (!customer) return;
    if (!narrative.trim() && !whoWhat.trim()) return toast.error("Narrative is required");
    setSubmitted(true);
    onSubmitted(customer.id);
    toast.success("STR/SAR submitted to FIU", { description: `Account ${customer.accountNumber} locked.` });
  }

  const steps = [
    { n: 1, label: "Filer & Suspect" },
    { n: 2, label: "Activity" },
    { n: 3, label: "Narrative" },
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[92vh] overflow-y-auto p-0 gap-0">
        {/* Gov-style header */}
        <div className="bg-navy text-navy-foreground p-6 rounded-t-lg">
          <div className="flex items-center gap-3">
            <div className="size-10 rounded-md bg-navy-foreground/10 border border-navy-foreground/20 flex items-center justify-center">
              <ShieldAlert className="size-5" />
            </div>
            <div>
              <DialogHeader className="space-y-0">
                <DialogTitle className="text-base font-semibold tracking-tight text-navy-foreground">
                  Suspicious Transaction Report · STR / SAR
                </DialogTitle>
                <DialogDescription className="text-[11px] text-navy-foreground/70 uppercase tracking-[0.18em] mt-1">
                  FinCEN-Aligned Filing · Financial Intelligence Unit
                </DialogDescription>
              </DialogHeader>
            </div>
            <Badge variant="outline" className="ml-auto font-mono text-[10px] border-navy-foreground/30 text-navy-foreground bg-navy-foreground/10">
              FORM SAR-112
            </Badge>
          </div>

          {/* Stepper */}
          <div className="flex items-center gap-2 mt-5">
            {steps.map((s, i) => {
              const active = step === s.n;
              const done = step > s.n;
              return (
                <div key={s.n} className="flex items-center gap-2 flex-1">
                  <div className={`size-7 rounded-full flex items-center justify-center text-xs font-bold border transition-all ${
                    done ? "bg-emerald-ok text-white border-emerald-ok" :
                    active ? "bg-navy-foreground text-navy border-navy-foreground" :
                    "bg-transparent text-navy-foreground/50 border-navy-foreground/30"
                  }`}>
                    {done ? <CheckCircle2 className="size-4" /> : s.n}
                  </div>
                  <div className={`text-[11px] uppercase tracking-wider font-semibold ${active ? "text-navy-foreground" : "text-navy-foreground/50"}`}>
                    {s.label}
                  </div>
                  {i < steps.length - 1 && <div className="flex-1 h-px bg-navy-foreground/20 mx-1" />}
                </div>
              );
            })}
          </div>
        </div>

        <div className="p-6 space-y-5">
          {step === 1 && (
            <div className="space-y-4 animate-in fade-in slide-in-from-right-2 duration-200">
              <FieldGroup title="Filer Information">
                <div className="grid grid-cols-2 gap-3">
                  <ReadField label="Filer" value="CitiMock Compliance Unit" />
                  <ReadField label="Division" value="Institutional AML" />
                </div>
              </FieldGroup>
              <FieldGroup title="Suspect / Subject">
                <div className="grid grid-cols-2 gap-3">
                  <ReadField label="Customer Name" value={customer?.name || "—"} />
                  <ReadField label="Account Number" value={customer?.accountNumber || "—"} mono />
                  <ReadField label="Country" value={customer?.country || "—"} />
                  <ReadField label="Risk Rating" value={customer?.riskRating || "—"} />
                </div>
              </FieldGroup>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-4 animate-in fade-in slide-in-from-right-2 duration-200">
              <FieldGroup title="Suspicious Activity">
                <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">Typology</Label>
                <Select value={typology} onValueChange={setTypology}>
                  <SelectTrigger className="mt-1.5"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Structuring">Structuring</SelectItem>
                    <SelectItem value="Money Laundering">Money Laundering</SelectItem>
                    <SelectItem value="Terrorist Financing">Terrorist Financing</SelectItem>
                    <SelectItem value="Fraud">Fraud</SelectItem>
                  </SelectContent>
                </Select>
              </FieldGroup>
              {tx && (
                <FieldGroup title="Triggering Transaction">
                  <div className="rounded-lg alert-glow-red p-4 text-xs space-y-2 font-mono">
                    <div className="flex justify-between"><span className="opacity-70">TX ID</span><span className="font-bold">{tx.id}</span></div>
                    <div className="flex justify-between"><span className="opacity-70">Type</span><span>{tx.type}</span></div>
                    <div className="flex justify-between"><span className="opacity-70">Amount</span><span className="font-bold">{fmtMoney(tx.amount)}</span></div>
                    <div className="flex justify-between"><span className="opacity-70">Stage</span><span className="font-bold tracking-wider">{tx.alertStage}</span></div>
                  </div>
                </FieldGroup>
              )}
            </div>
          )}

          {step === 3 && (
            <div className="space-y-4 animate-in fade-in slide-in-from-right-2 duration-200">
              <FieldGroup title="Narrative — Who / What">
                <Textarea
                  className="min-h-[80px]"
                  value={whoWhat}
                  onChange={(e) => setWhoWhat(e.target.value)}
                  placeholder="Identify the subject(s) involved and describe the suspicious activity..."
                />
              </FieldGroup>
              <FieldGroup title="Narrative — When / Where">
                <Textarea
                  className="min-h-[80px]"
                  value={whenWhere}
                  onChange={(e) => setWhenWhere(e.target.value)}
                  placeholder="Dates, jurisdictions, branches, channels involved..."
                />
              </FieldGroup>
              <FieldGroup title="Narrative — Why (Reason for Suspicion)">
                <Textarea
                  className="min-h-[120px]"
                  value={narrative}
                  onChange={(e) => setNarrative(e.target.value)}
                  placeholder="Articulate the reason for suspicion — red flags, deviation from KYC profile, typology indicators..."
                />
              </FieldGroup>
            </div>
          )}

          {submitted && (
            <div className="rounded-lg border border-emerald-ok/40 bg-emerald-ok/5 p-4 text-sm text-emerald-ok flex items-center gap-3">
              <CheckCircle2 className="size-5 shrink-0" />
              <div>
                <div className="font-semibold">Report submitted to FIU.</div>
                <div className="text-xs opacity-90">Account locked. Download the official PDF below.</div>
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="px-6 py-4 bg-slate-panel/60 border-t border-border gap-2 sm:justify-between rounded-b-lg">
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
            {step > 1 && !submitted && (
              <Button variant="ghost" onClick={() => setStep((s) => s - 1)}>Back</Button>
            )}
          </div>
          <div className="flex gap-2">
            {step < 3 && !submitted && (
              <Button onClick={() => setStep((s) => s + 1)} className="gap-2 bg-navy hover:bg-navy/90 text-navy-foreground">
                Next <ArrowRight className="size-4" />
              </Button>
            )}
            {step === 3 && !submitted && (
              <Button onClick={submit} className="gap-2 bg-red-alert hover:bg-red-alert/90 text-white">
                <Lock className="size-4" /> Submit to FIU
              </Button>
            )}
            {submitted && (
              <Button onClick={buildPDF} className="gap-2 bg-navy hover:bg-navy/90 text-navy-foreground">
                <Download className="size-4" /> Download SAR PDF
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function FieldGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-slate-panel/40 p-4">
      <div className="text-[10px] uppercase tracking-[0.18em] font-semibold text-muted-foreground mb-3">{title}</div>
      {children}
    </div>
  );
}

function ReadField({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</Label>
      <div className={`mt-1 rounded-md border border-border px-3 py-2 bg-background text-sm ${mono ? "font-mono" : ""}`}>{value}</div>
    </div>
  );
}
