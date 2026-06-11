import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Toaster, toast } from "sonner";
import jsPDF from "jspdf";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { ShieldAlert, AlertTriangle, Banknote, FileWarning, Lock, Download, ExternalLink, Building2 } from "lucide-react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "CitiMock Global Portal — AML Transaction Monitoring" },
      { name: "description", content: "Institutional core banking AML simulation: KYC ingestion, transaction ledger, structuring/layering/integration alerts, and STR/SAR filing." },
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

  // Form state
  const [amount, setAmount] = useState("");
  const [txType, setTxType] = useState<TxType>("Cash Deposit");
  const [txStatus, setTxStatus] = useState<TxStatus>("Completed");
  const [description, setDescription] = useState("");

  // Ingest from URL parameters (Web 1 -> Web 2)
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

  function evaluateAlerts(newTx: Transaction, allForCustomer: Transaction[]): AlertStage | undefined {
    const customer = customers.find((c) => c.id === newTx.customerId);
    if (!customer) return;

    const prior = allForCustomer.filter((t) => t.id !== newTx.id);
    const priorStages = caseEvents.filter((e) => e.customerId === newTx.customerId).map((e) => e.stage);

    // INTEGRATION
    if (newTx.type === "Incoming Transfer") {
      const desc = (newTx.description || "").toLowerCase();
      const matchedKw = INTEGRATION_KEYWORDS.some((k) => desc.includes(k));
      if (matchedKw && priorStages.includes("LAYERING")) {
        return "INTEGRATION";
      }
    }

    // LAYERING — high-value wire to foreign/high-risk country after PLACEMENT
    if (
      newTx.type === "Wire Transfer" &&
      newTx.amount > 20000 &&
      priorStages.includes("PLACEMENT") &&
      HIGH_RISK_COUNTRIES.includes(customer.country)
    ) {
      return "LAYERING";
    }
    // also trigger if customer's country isn't high-risk but it's still foreign (non-US)
    if (
      newTx.type === "Wire Transfer" &&
      newTx.amount > 20000 &&
      priorStages.includes("PLACEMENT") &&
      customer.country !== "United States"
    ) {
      return "LAYERING";
    }

    // PLACEMENT — sequential cash deposits accumulating > $10k
    if (newTx.type === "Cash Deposit") {
      // walk backward through prior txs collecting consecutive cash deposits
      const seq: Transaction[] = [newTx];
      for (let i = prior.length - 1; i >= 0; i--) {
        if (prior[i].type === "Cash Deposit") seq.push(prior[i]);
        else break;
      }
      const sum = seq.reduce((s, t) => s + t.amount, 0);
      if (sum > 10000 && seq.length >= 2) return "PLACEMENT";
    }
  }

  function addTransaction() {
    if (!activeCustomer) return toast.error("No active customer");
    if (activeCustomer.locked) return toast.error("Account is locked — SAR filed");
    const amt = parseFloat(amount);
    if (!amt || amt <= 0) return toast.error("Enter a valid amount");

    const tx: Transaction = {
      id: "TX-" + uid(),
      timestamp: new Date().toISOString(),
      customerId: activeCustomer.id,
      customerName: activeCustomer.name,
      customerCountry: activeCustomer.country,
      amount: amt,
      type: txType,
      status: txStatus,
      description: description || undefined,
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
    setAmount("");
    setDescription("");
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

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Toaster position="top-right" richColors closeButton />

      {/* Header */}
      <header className="border-b bg-card">
        <div className="mx-auto max-w-7xl px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="size-10 rounded-md bg-primary text-primary-foreground flex items-center justify-center">
              <Building2 className="size-5" />
            </div>
            <div>
              <h1 className="text-lg font-semibold tracking-tight">CitiMock Global Portal</h1>
              <p className="text-xs text-muted-foreground">Institutional Core Banking • AML Transaction Monitoring</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Badge variant="outline" className="gap-1">
              <ShieldAlert className="size-3" /> Compliance Unit
            </Badge>
            <Badge variant="secondary">FinCEN / FATF Aligned</Badge>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-6 py-6 space-y-6">
        {/* Active customer + form */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <Card className="lg:col-span-1">
            <CardHeader>
              <CardTitle className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Active Customer</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <Select value={activeCustomerId} onValueChange={setActiveCustomerId}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {customers.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name} — {c.country}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {activeCustomer && (
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between"><span className="text-muted-foreground">Account</span><span className="font-mono">{activeCustomer.accountNumber}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Country</span><span>{activeCustomer.country}</span></div>
                  <div className="flex justify-between items-center"><span className="text-muted-foreground">Risk Rating</span>
                    <Badge variant={activeCustomer.riskRating === "High" ? "destructive" : activeCustomer.riskRating === "Medium" ? "default" : "secondary"}>
                      {activeCustomer.riskRating}
                    </Badge>
                  </div>
                  {activeCustomer.locked && (
                    <div className="flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-2 text-destructive text-xs font-medium">
                      <Lock className="size-3" /> Account locked — SAR filed
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle className="text-sm font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-2">
                <Banknote className="size-4" /> Post Transaction
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                <div className="space-y-1.5">
                  <Label>Amount ($)</Label>
                  <Input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" />
                </div>
                <div className="space-y-1.5">
                  <Label>Transaction Type</Label>
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
                  <Label>Status</Label>
                  <Select value={txStatus} onValueChange={(v) => setTxStatus(v as TxStatus)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Completed">Completed</SelectItem>
                      <SelectItem value="Pending">Pending</SelectItem>
                      <SelectItem value="Flagged">Flagged</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5 md:col-span-1">
                  <Label>Description (optional)</Label>
                  <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="e.g. Consulting Fee" />
                </div>
              </div>
              <div className="mt-4 flex justify-end">
                <Button onClick={addTransaction} className="gap-2">
                  <Banknote className="size-4" /> Add Transaction
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Case timeline */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-2">
              <FileWarning className="size-4" /> AML Case File Timeline — {activeCustomer?.name}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2 flex-wrap">
              {stageOrder.map((stage, idx) => {
                const triggered = activeCaseEvents.find((e) => e.stage === stage);
                const color =
                  stage === "PLACEMENT" ? "bg-yellow-500" :
                  stage === "LAYERING" ? "bg-orange-500" : "bg-red-600";
                return (
                  <div key={stage} className="flex items-center gap-2">
                    <div className={`rounded-md px-3 py-2 text-xs font-semibold text-white ${triggered ? color : "bg-muted text-muted-foreground"}`}>
                      {triggered ? "🚨 " : ""}{stage}
                      {triggered && <div className="text-[10px] font-normal opacity-90">{new Date(triggered.timestamp).toLocaleTimeString()}</div>}
                    </div>
                    {idx < stageOrder.length - 1 && <span className="text-muted-foreground">➡️</span>}
                  </div>
                );
              })}
              {activeCaseEvents.length === 0 && <span className="text-sm text-muted-foreground">No alerts triggered for this customer.</span>}
            </div>
          </CardContent>
        </Card>

        {/* Ledger */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Transaction Ledger — {activeCustomer?.name} ({activeTxs.length})
            </CardTitle>
            <Button variant="outline" size="sm" onClick={() => openSTR()} disabled={!activeCustomer}>
              File STR/SAR
            </Button>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Transaction ID</TableHead>
                  <TableHead>Timestamp</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead>Country</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Alert</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {activeTxs.length === 0 && (
                  <TableRow><TableCell colSpan={9} className="text-center text-muted-foreground py-8">No transactions yet for this customer.</TableCell></TableRow>
                )}
                {activeTxs.map((tx) => (
                  <TableRow key={tx.id} className={tx.alertStage ? "bg-destructive/5" : ""}>
                    <TableCell className="font-mono text-xs">{tx.id}</TableCell>
                    <TableCell className="text-xs">{new Date(tx.timestamp).toLocaleString()}</TableCell>
                    <TableCell>{tx.customerName}</TableCell>
                    <TableCell>{tx.customerCountry}</TableCell>
                    <TableCell className="text-right font-medium">{fmtMoney(tx.amount)}</TableCell>
                    <TableCell>{tx.type}</TableCell>
                    <TableCell>
                      <Badge variant={tx.status === "Flagged" ? "destructive" : tx.status === "Pending" ? "secondary" : "default"}>
                        {tx.status}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {tx.alertStage ? (
                        <Badge variant="destructive" className="gap-1">
                          <AlertTriangle className="size-3" /> {tx.alertStage}
                        </Badge>
                      ) : <span className="text-xs text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell className="text-right">
                      {tx.alertStage && (
                        <div className="flex gap-1 justify-end">
                          <Button size="sm" variant="outline" onClick={() => openInvestigate(tx)} className="gap-1 h-7">
                            <ExternalLink className="size-3" /> Investigate
                          </Button>
                          <Button size="sm" variant="destructive" onClick={() => openSTR(tx)} className="h-7">
                            File STR
                          </Button>
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {/* Global ledger */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Unified Bank-Wide Ledger ({transactions.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>ID</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead>Country</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {transactions.length === 0 && (
                  <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-6">No bank-wide transactions yet.</TableCell></TableRow>
                )}
                {transactions.slice().reverse().map((tx) => (
                  <TableRow key={tx.id}>
                    <TableCell className="font-mono text-xs">{tx.id}</TableCell>
                    <TableCell>{tx.customerName}</TableCell>
                    <TableCell>{tx.customerCountry}</TableCell>
                    <TableCell className="text-right">{fmtMoney(tx.amount)}</TableCell>
                    <TableCell>{tx.type}</TableCell>
                    <TableCell>
                      <Badge variant={tx.status === "Flagged" ? "destructive" : tx.status === "Pending" ? "secondary" : "default"}>{tx.status}</Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </main>

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
  const [submitted, setSubmitted] = useState(false);
  const customer = context?.customer;
  const tx = context?.tx;

  useEffect(() => {
    if (open) {
      setSubmitted(false);
      setNarrative("");
      setTypology(tx?.alertStage === "LAYERING" ? "Money Laundering" : tx?.alertStage === "INTEGRATION" ? "Money Laundering" : "Structuring");
    }
  }, [open, tx]);

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
    const wrapped = doc.splitTextToSize(narrative || "(no narrative provided)", 180);
    doc.text(wrapped, 15, y);
    y += wrapped.length * 5 + 8;

    doc.line(15, y, 195, y); y += 6;
    doc.setFontSize(9); doc.setFont("helvetica", "italic");
    doc.text("This report is filed under 31 U.S.C. § 5318(g) — Confidential. Unauthorized disclosure is prohibited.", 15, y);

    doc.save(`${ref}_${(customer?.name || "customer").replace(/\s+/g, "_")}.pdf`);
  }

  function submit() {
    if (!customer) return;
    if (!narrative.trim()) return toast.error("Narrative is required");
    setSubmitted(true);
    onSubmitted(customer.id);
    toast.success("STR/SAR submitted to FIU", { description: `Account ${customer.accountNumber} locked.` });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldAlert className="size-5 text-destructive" />
            Suspicious Transaction Report (STR / SAR)
          </DialogTitle>
          <DialogDescription>
            FinCEN-aligned filing for the Financial Intelligence Unit (FIU).
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="rounded-md border bg-muted/40 p-3 text-sm space-y-1">
            <div className="font-semibold">Filer Information</div>
            <div className="text-muted-foreground">CitiMock Compliance Unit • Institutional AML Division</div>
          </div>

          <div className="grid grid-cols-2 gap-3 text-sm">
            <div><Label className="text-xs">Customer Name</Label><div className="mt-1 rounded-md border px-3 py-2 bg-background">{customer?.name || "—"}</div></div>
            <div><Label className="text-xs">Account Number</Label><div className="mt-1 rounded-md border px-3 py-2 bg-background font-mono">{customer?.accountNumber || "—"}</div></div>
            <div><Label className="text-xs">Country</Label><div className="mt-1 rounded-md border px-3 py-2 bg-background">{customer?.country || "—"}</div></div>
            <div><Label className="text-xs">Risk Rating</Label><div className="mt-1 rounded-md border px-3 py-2 bg-background">{customer?.riskRating || "—"}</div></div>
          </div>

          <div>
            <Label>Typology</Label>
            <Select value={typology} onValueChange={setTypology}>
              <SelectTrigger className="mt-1.5"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="Structuring">Structuring</SelectItem>
                <SelectItem value="Money Laundering">Money Laundering</SelectItem>
                <SelectItem value="Terrorist Financing">Terrorist Financing</SelectItem>
                <SelectItem value="Fraud">Fraud</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label>Narrative — Who, What, When, Where, Why</Label>
            <Textarea
              className="mt-1.5 min-h-[140px]"
              value={narrative}
              onChange={(e) => setNarrative(e.target.value)}
              placeholder="Describe the suspicious behavior in detail, including parties involved, dates, amounts, jurisdictions, and reason for suspicion..."
            />
          </div>

          {tx && (
            <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-xs space-y-1">
              <div className="font-semibold text-destructive">Triggering Transaction</div>
              <div>{tx.id} • {tx.type} • {fmtMoney(tx.amount)} • Stage: {tx.alertStage}</div>
            </div>
          )}

          {submitted && (
            <div className="rounded-md border border-green-600/40 bg-green-600/10 p-3 text-sm text-green-700 dark:text-green-400">
              ✅ Report submitted to FIU. Account has been locked. You may now download the official PDF.
            </div>
          )}
        </div>

        <Separator />

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
          {!submitted ? (
            <Button variant="destructive" onClick={submit} className="gap-2">
              <Lock className="size-4" /> Submit Report to FIU
            </Button>
          ) : (
            <Button onClick={buildPDF} className="gap-2">
              <Download className="size-4" /> Download SAR PDF
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
