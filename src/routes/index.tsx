import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Toaster, toast } from "sonner";
import jsPDF from "jspdf";
import * as XLSX from "xlsx";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
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
import { ShieldAlert, AlertTriangle, Banknote, FileWarning, Lock, Download, ExternalLink, Building2, FileSpreadsheet, Moon } from "lucide-react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "CitiMock Global Portal — AML Transaction Monitoring" },
      { name: "description", content: "Institutional core banking AML simulation: KYC ingestion, transaction ledger, structuring/layering/integration alerts, and STR/SAR filing." },
    ],
  }),
  component: Portal,
});

type TxType =
  | "Cash Deposit"
  | "ATM Withdrawal"
  | "Incoming Transfer"
  | "Wire Transfer"
  | "Intrabank Transfer"
  | "Interbank Transfer";
type TxStatus = "Completed" | "Flagged" | "Pending";
type AlertStage = "PLACEMENT" | "LAYERING" | "INTEGRATION";
type AccountStatus = "Active" | "Dormant";
type RiskRating = "Low" | "Medium" | "High";

interface ComplianceFlags {
  placementTriggered: boolean;
  layeringTriggered: boolean;
  integrationTriggered: boolean;
}

interface Customer {
  id: string;
  name: string;
  country: string;
  accountNumber: string;
  riskRating: RiskRating;
  locked: boolean;
  status: AccountStatus;
  complianceFlags: ComplianceFlags;
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
  // Bank ledger mechanics
  flow: "DEBIT" | "CREDIT";
  counterpartyName: string;
  counterpartyAccount?: string;
  counterpartyBank?: string;
  runningBalance: number;
  dormantReactivation?: boolean;
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

const INTEGRATION_KEYWORDS = [
  "investment", "property", "property purchase", "property investment",
  "consulting fee", "consulting", "advisory", "dividend", "royalty",
  "commercial contract", "service contract",
];

// CREDIT = inbound (+), DEBIT = outbound (-)
const TX_FLOW: Record<TxType, "DEBIT" | "CREDIT"> = {
  "Cash Deposit": "CREDIT",
  "Incoming Transfer": "CREDIT",
  "ATM Withdrawal": "DEBIT",
  "Wire Transfer": "DEBIT",
  "Intrabank Transfer": "DEBIT",
  "Interbank Transfer": "DEBIT",
};

const TRANSFER_TYPES: TxType[] = ["Wire Transfer", "Intrabank Transfer", "Interbank Transfer"];

const STAGE_MESSAGES: Record<AlertStage, string> = {
  PLACEMENT: "🚨 PLACEMENT: Cumulative cash deposits reached the structuring threshold",
  LAYERING: "🚨 LAYERING: Outbound transfer moved 70%+ of current running balance",
  INTEGRATION: "🚨 INTEGRATION: Business-purpose incoming credit after placement and layering",
};

function createComplianceFlags(): ComplianceFlags {
  return {
    placementTriggered: false,
    layeringTriggered: false,
    integrationTriggered: false,
  };
}

function flagsChanged(a: ComplianceFlags, b: ComplianceFlags) {
  return (
    a.placementTriggered !== b.placementTriggered ||
    a.layeringTriggered !== b.layeringTriggered ||
    a.integrationTriggered !== b.integrationTriggered
  );
}

function stageIsTriggered(flags: ComplianceFlags, stage: AlertStage) {
  if (stage === "PLACEMENT") return flags.placementTriggered;
  if (stage === "LAYERING") return flags.layeringTriggered;
  return flags.integrationTriggered;
}

function uid(prefix = "") {
  return prefix + Math.random().toString(36).slice(2, 10).toUpperCase();
}

function fmtMoney(n: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);
}

const SEED_CUSTOMERS: Customer[] = ([
  { id: "C-001", name: "Sarah Chen", country: "Singapore", accountNumber: "CTM-1000-2847", riskRating: "Low", locked: false, status: "Active" },
  { id: "C-002", name: "Marcus Reid", country: "United Kingdom", accountNumber: "CTM-1000-5519", riskRating: "Medium", locked: false, status: "Active" },
  { id: "C-003", name: "Olivia Hartmann", country: "Germany", accountNumber: "CTM-1000-7732", riskRating: "Low", locked: false, status: "Active" },
  { id: "C-004", name: "Viktor Petrov", country: "Cyprus", accountNumber: "CTM-1000-8841", riskRating: "High", locked: false, status: "Active" },
  { id: "C-005", name: "Amelia Wong", country: "Hong Kong", accountNumber: "CTM-1000-9923", riskRating: "Medium", locked: false, status: "Dormant" },
  { id: "C-006", name: "Rashid Al-Mansoori", country: "UAE", accountNumber: "CTM-1001-1147", riskRating: "High", locked: false, status: "Active" },
  { id: "C-007", name: "Diego Fernández", country: "Panama", accountNumber: "CTM-1001-2255", riskRating: "High", locked: false, status: "Dormant" },
  { id: "C-008", name: "Hannah Müller", country: "Switzerland", accountNumber: "CTM-1001-3361", riskRating: "Medium", locked: false, status: "Active" },
  { id: "C-009", name: "James O'Connor", country: "Ireland", accountNumber: "CTM-1001-4470", riskRating: "Low", locked: false, status: "Active" },
  { id: "C-010", name: "Yuki Tanaka", country: "Japan", accountNumber: "CTM-1001-5588", riskRating: "Low", locked: false, status: "Active" },
  { id: "C-011", name: "Elena Ricci", country: "Malta", accountNumber: "CTM-1001-6696", riskRating: "High", locked: false, status: "Dormant" },
  { id: "C-012", name: "Andre Nascimento", country: "Brazil", accountNumber: "CTM-1001-7704", riskRating: "Medium", locked: false, status: "Active" },
] satisfies Array<Omit<Customer, "complianceFlags">>).map((customer) => ({
  ...customer,
  complianceFlags: createComplianceFlags(),
}));

function Portal() {
  const [customers, setCustomers] = useState<Customer[]>(SEED_CUSTOMERS);
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
  const [benefName, setBenefName] = useState("");
  const [benefAccount, setBenefAccount] = useState("");
  const [benefBank, setBenefBank] = useState("");
  const [benefCountry, setBenefCountry] = useState("");

  // Ingest from URL parameters (Web 1 -> Web 2)
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const name = params.get("customer") || params.get("name");
    const country = params.get("country");
    const risk = (params.get("risk") as RiskRating) || "Medium";
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
        status: "Active",
        complianceFlags: createComplianceFlags(),
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

  const activeBalance = useMemo(() => {
    if (activeTxs.length === 0) return 0;
    return activeTxs[activeTxs.length - 1].runningBalance;
  }, [activeTxs]);

  function evaluateAlerts(
    newTx: Transaction,
    allForCustomer: Transaction[],
    priorBalance: number,
    currentFlags: ComplianceFlags,
  ): { nextFlags: ComplianceFlags; newlyTriggeredStages: AlertStage[] } {
    const nextFlags = { ...currentFlags };
    const newlyTriggeredStages: AlertStage[] = [];

    const cumulativeCash = allForCustomer
      .filter((t) => t.type === "Cash Deposit")
      .reduce((sum, t) => sum + t.amount, 0);

    if (cumulativeCash >= 10000 && nextFlags.placementTriggered === false) {
      nextFlags.placementTriggered = true;
      newlyTriggeredStages.push("PLACEMENT");
    }

    if (
      nextFlags.placementTriggered === true &&
      nextFlags.layeringTriggered === false &&
      TRANSFER_TYPES.includes(newTx.type) &&
      newTx.flow === "DEBIT" &&
      priorBalance > 0 &&
      newTx.amount / priorBalance >= 0.7
    ) {
      nextFlags.layeringTriggered = true;
      newlyTriggeredStages.push("LAYERING");
    }

    if (
      nextFlags.placementTriggered === true &&
      nextFlags.layeringTriggered === true &&
      nextFlags.integrationTriggered === false &&
      newTx.flow === "CREDIT"
    ) {
      const desc = (newTx.description || "").toLowerCase();
      const sender = (newTx.counterpartyName || "").toLowerCase();
      const haystack = `${desc} ${sender}`;
      if (INTEGRATION_KEYWORDS.some((keyword) => haystack.includes(keyword))) {
        nextFlags.integrationTriggered = true;
        newlyTriggeredStages.push("INTEGRATION");
      }
    }

    return { nextFlags, newlyTriggeredStages };
  }

  function addTransaction() {
    if (!activeCustomer) return toast.error("No active customer");
    if (activeCustomer.locked) return toast.error("Account is locked — SAR filed");
    const amt = parseFloat(amount);
    if (!amt || amt <= 0) return toast.error("Enter a valid amount");

    const needsBenef = txType === "Intrabank Transfer" || txType === "Interbank Transfer" || txType === "Wire Transfer";
    if (needsBenef && (!benefName.trim() || !benefAccount.trim() || !benefBank.trim())) {
      return toast.error("Beneficiary name, account, and bank are required");
    }

    const flow = TX_FLOW[txType];
    const priorBalance = activeBalance;
    const newBalance = flow === "CREDIT" ? priorBalance + amt : priorBalance - amt;

    const counterpartyName =
      needsBenef ? benefName.trim() :
      txType === "Cash Deposit" ? "Cash Deposit (Teller)" :
      txType === "ATM Withdrawal" ? "ATM Cash Withdrawal" :
      txType === "Incoming Transfer" ? (benefName.trim() || "Incoming Counterparty") :
      "—";

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
      flow,
      counterpartyName,
      counterpartyAccount: benefAccount.trim() || undefined,
      counterpartyBank: benefBank.trim() || undefined,
      runningBalance: newBalance,
    };

    // Dormant Reactivation alert (does not block, just flags)
    if (activeCustomer.status === "Dormant") {
      tx.dormantReactivation = true;
      tx.status = "Flagged";
      toast.error("⚠️ DORMANT REACTIVATION: High-Velocity Activity on Long-Inactive Account", {
        duration: 7000,
      });
    }

    const updatedAll = [...transactions, tx];
    const customerTxs = updatedAll.filter((t) => t.customerId === activeCustomer.id);
    const { nextFlags, newlyTriggeredStages } = evaluateAlerts(
      tx,
      customerTxs,
      priorBalance,
      activeCustomer.complianceFlags,
    );

    if (flagsChanged(activeCustomer.complianceFlags, nextFlags)) {
      setCustomers((prev) =>
        prev.map((c) =>
          c.id === activeCustomer.id ? { ...c, complianceFlags: nextFlags } : c,
        ),
      );
    }

    if (newlyTriggeredStages.length > 0) {
      const finalStage = newlyTriggeredStages[newlyTriggeredStages.length - 1];
      tx.alertStage = finalStage;
      tx.status = "Flagged";

      newlyTriggeredStages.forEach((stage) => toast.error(STAGE_MESSAGES[stage], { duration: 6000 }));
      setCaseEvents((prev) => [
        ...prev,
        ...newlyTriggeredStages.map((stage) => ({
          id: uid("E-"),
          customerId: activeCustomer.id,
          stage,
          message: STAGE_MESSAGES[stage],
          timestamp: tx.timestamp,
          txId: tx.id,
        })),
      ]);
    } else if (!tx.dormantReactivation) {
      toast.success("Transaction posted");
    }

    setTransactions(updatedAll);
    setAmount("");
    setDescription("");
    setBenefName("");
    setBenefAccount("");
    setBenefBank("");
    setBenefCountry("");
  }

  function toggleStatus(customerId: string, dormant: boolean) {
    setCustomers((prev) =>
      prev.map((c) =>
        c.id === customerId ? { ...c, status: dormant ? "Dormant" : "Active" } : c,
      ),
    );
    toast.info(`Account ${dormant ? "marked Dormant" : "reactivated to Active"}`);
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

  function exportExcel() {
    const wb = XLSX.utils.book_new();

    const custRows = customers.map((c) => {
      const ctx = transactions.filter((t) => t.customerId === c.id);
      const bal = ctx.length ? ctx[ctx.length - 1].runningBalance : 0;
      return {
        "Customer ID": c.id,
        "Name": c.name,
        "Account Number": c.accountNumber,
        "Country": c.country,
        "Risk Rating": c.riskRating,
        "Account Status": c.status,
        "Locked": c.locked ? "Yes" : "No",
        "PLI Placement Triggered": c.complianceFlags.placementTriggered ? "Yes" : "No",
        "PLI Layering Triggered": c.complianceFlags.layeringTriggered ? "Yes" : "No",
        "PLI Integration Triggered": c.complianceFlags.integrationTriggered ? "Yes" : "No",
        "Transactions": ctx.length,
        "Current Balance (USD)": bal,
      };
    });
    const wsCust = XLSX.utils.json_to_sheet(custRows);
    XLSX.utils.book_append_sheet(wb, wsCust, "Customer Master");

    const txRows = transactions.map((t) => ({
      "Transaction ID": t.id,
      "Timestamp": new Date(t.timestamp).toLocaleString(),
      "Customer ID": t.customerId,
      "Customer Name": t.customerName,
      "Country": t.customerCountry,
      "Type": t.type,
      "Flow": t.flow === "CREDIT" ? "Kredit (+)" : "Debet (-)",
      "Amount (USD)": t.flow === "CREDIT" ? t.amount : -t.amount,
      "Counterparty Name": t.counterpartyName,
      "Counterparty Account": t.counterpartyAccount || "",
      "Counterparty Bank": t.counterpartyBank || "",
      "Description": t.description || "",
      "Status": t.status,
      "Alert Stage": t.alertStage || "",
      "Dormant Reactivation": t.dormantReactivation ? "Yes" : "",
      "Running Balance (USD)": t.runningBalance,
    }));
    const wsTx = XLSX.utils.json_to_sheet(txRows.length ? txRows : [{ Info: "No transactions" }]);
    XLSX.utils.book_append_sheet(wb, wsTx, "Transaction Ledger");

    const alertRows = caseEvents.map((e) => {
      const c = customers.find((x) => x.id === e.customerId);
      return {
        "Event ID": e.id,
        "Timestamp": new Date(e.timestamp).toLocaleString(),
        "Customer": c?.name || e.customerId,
        "Account": c?.accountNumber || "",
        "Stage": e.stage,
        "Message": e.message,
        "Trigger TX": e.txId,
      };
    });
    const wsAlerts = XLSX.utils.json_to_sheet(alertRows.length ? alertRows : [{ Info: "No alerts" }]);
    XLSX.utils.book_append_sheet(wb, wsAlerts, "AML Alerts");

    const fname = `CitiMock_Ledger_${new Date().toISOString().slice(0, 10)}.xlsx`;
    XLSX.writeFile(wb, fname);
    toast.success("Excel ledger exported", { description: fname });
  }

  const stageOrder: AlertStage[] = ["PLACEMENT", "LAYERING", "INTEGRATION"];
  const needsBenef = txType === "Intrabank Transfer" || txType === "Interbank Transfer" || txType === "Wire Transfer";
  const activeComplianceFlags = activeCustomer?.complianceFlags ?? createComplianceFlags();

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
            <Button variant="outline" size="sm" onClick={exportExcel} className="gap-2">
              <FileSpreadsheet className="size-4" /> Export Ledger to MS Excel (.xlsx)
            </Button>
            <Badge variant="outline" className="gap-1">
              <ShieldAlert className="size-3" /> Compliance Unit
            </Badge>
            <Badge variant="secondary">FinCEN / FATF Aligned</Badge>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-6 py-6 space-y-6">
        {/* Customer roster */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Customer Roster ({customers.length})
            </CardTitle>
            <Button variant="outline" size="sm" onClick={exportExcel} className="gap-2">
              <FileSpreadsheet className="size-4" /> Export to Excel
            </Button>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>ID</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Country</TableHead>
                  <TableHead>Account</TableHead>
                  <TableHead>Risk</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Dormant Toggle</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {customers.map((c) => (
                  <TableRow key={c.id} className={c.id === activeCustomerId ? "bg-muted/40" : ""}>
                    <TableCell className="font-mono text-xs">{c.id}</TableCell>
                    <TableCell className="font-medium">{c.name}</TableCell>
                    <TableCell>{c.country}</TableCell>
                    <TableCell className="font-mono text-xs">{c.accountNumber}</TableCell>
                    <TableCell>
                      <Badge variant={c.riskRating === "High" ? "destructive" : c.riskRating === "Medium" ? "default" : "secondary"}>
                        {c.riskRating}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {c.status === "Dormant" ? (
                        <Badge variant="outline" className="gap-1 border-amber-500 text-amber-600">
                          <Moon className="size-3" /> Dormant
                        </Badge>
                      ) : (
                        <Badge variant="secondary">Active</Badge>
                      )}
                      {c.locked && <Badge variant="destructive" className="ml-1">Locked</Badge>}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Switch
                          checked={c.status === "Dormant"}
                          onCheckedChange={(v) => toggleStatus(c.id, v)}
                        />
                        <span className="text-xs text-muted-foreground">Dormant</span>
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button size="sm" variant={c.id === activeCustomerId ? "default" : "outline"} onClick={() => setActiveCustomerId(c.id)}>
                        {c.id === activeCustomerId ? "Selected" : "Select"}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

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
                  <div className="flex justify-between items-center">
                    <span className="text-muted-foreground">Account Status</span>
                    <div className="flex items-center gap-2">
                      <Switch checked={activeCustomer.status === "Dormant"} onCheckedChange={(v) => toggleStatus(activeCustomer.id, v)} />
                      <span className="text-xs">{activeCustomer.status}</span>
                    </div>
                  </div>
                  <div className="flex justify-between border-t pt-2">
                    <span className="text-muted-foreground">Saldo Terakhir</span>
                    <span className="font-semibold">{fmtMoney(activeBalance)}</span>
                  </div>
                  {activeCustomer.status === "Dormant" && (
                    <div className="flex items-center gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-amber-700 dark:text-amber-400 text-xs font-medium">
                      <Moon className="size-3" /> Dormant — any activity will fire reactivation alert
                    </div>
                  )}
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
                      <SelectItem value="Cash Deposit">Cash Deposit (Kredit)</SelectItem>
                      <SelectItem value="Incoming Transfer">Incoming Transfer (Kredit)</SelectItem>
                      <SelectItem value="ATM Withdrawal">ATM Withdrawal (Debet)</SelectItem>
                      <SelectItem value="Intrabank Transfer">Transfer to Same Bank — Intrabank (Debet)</SelectItem>
                      <SelectItem value="Interbank Transfer">Transfer to Other Banks — Interbank (Debet)</SelectItem>
                      <SelectItem value="Wire Transfer">International Wire Transfer (Debet)</SelectItem>
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
                <div className="space-y-1.5">
                  <Label>Description / Metadata</Label>
                  <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="e.g. Consulting Fee, Property Investment" />
                </div>

                {needsBenef && (
                  <>
                    <div className="space-y-1.5 md:col-span-2">
                      <Label>Beneficiary Name (Nama Penerima)</Label>
                      <Input value={benefName} onChange={(e) => setBenefName(e.target.value)} placeholder="Full beneficiary name" />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Beneficiary Account #</Label>
                      <Input value={benefAccount} onChange={(e) => setBenefAccount(e.target.value)} placeholder="Account number" />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Bank Name</Label>
                      <Input value={benefBank} onChange={(e) => setBenefBank(e.target.value)} placeholder="Recipient bank" />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Beneficiary Country</Label>
                      <Input value={benefCountry} onChange={(e) => setBenefCountry(e.target.value)} placeholder="e.g. Cayman Islands" />
                    </div>
                  </>
                )}
                {txType === "Incoming Transfer" && (
                  <div className="space-y-1.5 md:col-span-2">
                    <Label>Sender Name (Nama Pengirim)</Label>
                    <Input value={benefName} onChange={(e) => setBenefName(e.target.value)} placeholder="Originator / sender" />
                  </div>
                )}
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

        {/* Account Mutation Ledger */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Account Mutation — {activeCustomer?.name} ({activeTxs.length})
            </CardTitle>
            <Button variant="outline" size="sm" onClick={() => openSTR()} disabled={!activeCustomer}>
              File STR/SAR
            </Button>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date & Time</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Recipient / Sender</TableHead>
                  <TableHead className="text-right">Flow</TableHead>
                  <TableHead className="text-right">Saldo Terakhir</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Alert</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {activeTxs.length === 0 && (
                  <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-8">No transactions yet for this customer.</TableCell></TableRow>
                )}
                {activeTxs.slice().reverse().map((tx) => (
                  <TableRow key={tx.id} className={tx.alertStage ? "bg-destructive/5" : tx.dormantReactivation ? "bg-amber-500/5" : ""}>
                    <TableCell className="text-xs whitespace-nowrap">{new Date(tx.timestamp).toLocaleString()}</TableCell>
                    <TableCell>
                      <div className="font-medium">{tx.type}</div>
                      {tx.description && <div className="text-[11px] text-muted-foreground">{tx.description}</div>}
                    </TableCell>
                    <TableCell>
                      <div className="font-medium">{tx.counterpartyName}</div>
                      {(tx.counterpartyBank || tx.counterpartyAccount) && (
                        <div className="text-[11px] text-muted-foreground font-mono">
                          {tx.counterpartyBank} {tx.counterpartyAccount ? `• ${tx.counterpartyAccount}` : ""}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className={`text-right font-semibold ${tx.flow === "CREDIT" ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}>
                      {tx.flow === "CREDIT" ? "+" : "−"} {fmtMoney(tx.amount)}
                      <div className="text-[10px] font-normal opacity-80">{tx.flow === "CREDIT" ? "Kredit" : "Debet"}</div>
                    </TableCell>
                    <TableCell className="text-right font-mono">{fmtMoney(tx.runningBalance)}</TableCell>
                    <TableCell>
                      <Badge variant={tx.status === "Flagged" ? "destructive" : tx.status === "Pending" ? "secondary" : "default"}>
                        {tx.status}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col gap-1">
                        {tx.alertStage && (
                          <Badge variant="destructive" className="gap-1 w-fit">
                            <AlertTriangle className="size-3" /> {tx.alertStage}
                          </Badge>
                        )}
                        {tx.dormantReactivation && (
                          <Badge className="gap-1 w-fit bg-amber-500 text-white hover:bg-amber-600">
                            <Moon className="size-3" /> DORMANT REACTIVATION
                          </Badge>
                        )}
                        {!tx.alertStage && !tx.dormantReactivation && <span className="text-xs text-muted-foreground">—</span>}
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      {(tx.alertStage || tx.dormantReactivation) && (
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
                  <TableHead>Timestamp</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Counterparty</TableHead>
                  <TableHead className="text-right">Flow</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {transactions.length === 0 && (
                  <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-6">No bank-wide transactions yet.</TableCell></TableRow>
                )}
                {transactions.slice().reverse().map((tx) => (
                  <TableRow key={tx.id}>
                    <TableCell className="text-xs whitespace-nowrap">{new Date(tx.timestamp).toLocaleString()}</TableCell>
                    <TableCell>{tx.customerName}</TableCell>
                    <TableCell>{tx.type}</TableCell>
                    <TableCell>{tx.counterpartyName}</TableCell>
                    <TableCell className={`text-right font-semibold ${tx.flow === "CREDIT" ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}>
                      {tx.flow === "CREDIT" ? "+" : "−"} {fmtMoney(tx.amount)}
                    </TableCell>
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
    line("Account Status:", customer?.status || "—");

    y += 3;
    doc.setFont("helvetica", "bold"); doc.setFontSize(12);
    doc.text("Suspicious Activity", 15, y); y += 7;
    doc.setFontSize(10);
    line("Typology:", typology);
    if (tx) {
      line("Trigger TX:", tx.id);
      line("Amount:", fmtMoney(tx.amount));
      line("Type:", tx.type);
      line("Flow:", tx.flow);
      line("Counterparty:", tx.counterpartyName);
      line("Stage:", tx.alertStage || (tx.dormantReactivation ? "DORMANT REACTIVATION" : "—"));
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
              <div>{tx.id} • {tx.type} • {fmtMoney(tx.amount)} • Stage: {tx.alertStage || (tx.dormantReactivation ? "DORMANT REACTIVATION" : "—")}</div>
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
