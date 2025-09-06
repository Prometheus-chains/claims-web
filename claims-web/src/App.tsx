import React, { useEffect, useMemo, useState } from "react";
import { ethers } from "ethers";

/**
 * Visual-only revamp: typography, spacing, cards, form controls, buttons, badges.
 * No business logic changed; all contract calls/hooks remain identical.
 *
 * Env vars (Vite):
 *   VITE_CHAIN_ID=84532
 *   VITE_RPC_URL=https://sepolia.base.org
 *   VITE_ENGINE=0x...
 *   VITE_RULES=0x...
 *   VITE_PROVIDER_REGISTRY=0x...
 *   VITE_ENROLLMENT=0x...
 *   VITE_BANK=0x...
 *   VITE_USDC=0x...   // optional, for display only
 */

// ---------- ABIs (minimal) ----------
const accessControlledAbi = [
  "function owner() view returns (address)",
  "function transferOwnership(address newOwner)"
];

const providerRegistryAbi = [
  "event ProviderSet(address indexed provider, bool active, uint16 startYear, uint16 endYear)",
  "function isActive(address provider, uint16 year) view returns (bool)",
  "function setProvider(address provider, bool active, uint16 startYear, uint16 endYear)"
];

const enrollmentAbi = [
  "event CoverageSet(bytes32 indexed patientId, bool active, uint16 startYear, uint16 endYear)",
  "function isCovered(bytes32 patientId, uint16 year) view returns (bool)",
  "function setCoverage(bytes32 patientId, bool active, uint16 startYear, uint16 endYear)"
];

const rulesAbi = [
  "event RuleSet(uint16 indexed code, bool enabled, uint256 price, uint16 maxPerYear, string label)",
  "event RuleToggled(uint16 indexed code, bool enabled)",
  "event RulePriceSet(uint16 indexed code, uint256 price)",
  "event RuleMaxPerYearSet(uint16 indexed code, uint16 maxPerYear)",
  "event RuleLabelSet(uint16 indexed code, string label)",
  "function getRule(uint16 code) view returns (bool enabled, uint256 price, uint16 maxPerYear)",
  "function setRule(uint16 code, bool enabled, uint256 price, uint16 maxPerYear, string label)",
  "function setEnabled(uint16 code, bool enabled)",
  "function setPrice(uint16 code, uint256 price)",
  "function setMaxPerYear(uint16 code, uint16 maxPerYear)",
  "function setLabel(uint16 code, string label)"
];

const bankAbi = [
  "event PaymentExecuted(uint256 indexed claimId, address indexed to, uint256 amount, uint256 vaultBalanceAfter)",
  "function token() view returns (address)",
  "function engine() view returns (address)",
  "function setEngine(address e)",
  "function vaultBalance() view returns (uint256)"
];

const claimEngineAbi = [
  "event ClaimPaid(uint256 indexed id, bytes32 indexed claimKey, address indexed provider, uint16 code, uint16 year, uint256 amount, uint32 visitIndex)",
  "event ClaimRejected(bytes32 indexed claimKey, address indexed provider, uint16 code, uint16 year, string reason)",
  "function paused() view returns (bool)",
  "function setPaused(bool)",
  "function claimKeyOf(uint256 id) view returns (bytes32)",
  "function submit(bytes32 patientId, uint16 code, uint16 year)"
];

// ---------- Helpers ----------
const CHAIN_ID_DEC = Number(import.meta.env.VITE_CHAIN_ID || 84532);
const CHAIN_ID_HEX = "0x" + CHAIN_ID_DEC.toString(16);
const RPC_URL = import.meta.env.VITE_RPC_URL || "https://sepolia.base.org";

const ADDRS = {
  engine: (import.meta.env.VITE_ENGINE || "").trim(),
  rules: (import.meta.env.VITE_RULES || "").trim(),
  providerRegistry: (import.meta.env.VITE_PROVIDER_REGISTRY || "").trim(),
  enrollment: (import.meta.env.VITE_ENROLLMENT || "").trim(),
  bank: (import.meta.env.VITE_BANK || "").trim(),
  usdc: (import.meta.env.VITE_USDC || "").trim(),
};

function fmtUSDC(x?: bigint) {
  if (x === undefined) return "-";
  const whole = x / 1_000_000n; // 6 decimals
  const frac = (x % 1_000_000n).toString().padStart(6, "0");
  const fracTrim = frac.replace(/0+$/, "");
  return fracTrim.length ? `${whole.toString()}.${fracTrim}` : whole.toString();
}

function isBytes32Hex(s: string) {
  return /^0x[0-9a-fA-F]{64}$/.test(s);
}

// ---------- Tiny UI primitives (visual only) ----------
function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "subtle" | "danger"; size?: "sm" | "md" };
function Button({ variant = "primary", size = "md", className, ...props }: ButtonProps) {
  const base = "inline-flex items-center justify-center rounded-lg font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:opacity-60 disabled:cursor-not-allowed";
  const sizes = size === "sm" ? "px-3 py-1.5 text-sm" : "px-3.5 py-2 text-sm";
  const variants: Record<string, string> = {
    primary:   "bg-indigo-600 text-white hover:bg-indigo-500 focus:ring-indigo-500",
    secondary: "bg-emerald-600 text-white hover:bg-emerald-500 focus:ring-emerald-500",
    subtle:    "bg-slate-100 text-slate-900 hover:bg-slate-200 focus:ring-slate-400",
    danger:    "bg-rose-600 text-white hover:bg-rose-500 focus:ring-rose-500",
  };
  return <button className={cx(base, sizes, variants[variant], className)} {...props} />;
}

type InputProps = React.InputHTMLAttributes<HTMLInputElement> & { prefix?: React.ReactNode; suffix?: React.ReactNode };
function Input({ className, prefix, suffix, ...props }: InputProps) {
  return (
    <div className={cx("relative", className)}>
      {prefix && <div className="pointer-events-none absolute inset-y-0 left-0 pl-3 flex items-center text-slate-500">{prefix}</div>}
      <input
        className={cx(
          "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm",
          "placeholder:text-slate-400 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/30",
          prefix && "pl-9",
          suffix && "pr-9"
        )}
        {...props}
      />
      {suffix && <div className="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-500">{suffix}</div>}
    </div>
  );
}

type SelectProps = React.SelectHTMLAttributes<HTMLSelectElement>;
function Select({ className, children, ...props }: SelectProps) {
  return (
    <select
      className={cx(
        "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm",
        "focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/30",
        className
      )}
      {...props}
    >
      {children}
    </select>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">{children}</label>;
}

function Badge({ children, tone = "neutral" }: { children: React.ReactNode; tone?: "neutral" | "success" | "warning" | "danger" | "info" }) {
  const tones: Record<string, string> = {
    neutral: "bg-slate-100 text-slate-800",
    success: "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200",
    warning: "bg-amber-50 text-amber-700 ring-1 ring-amber-200",
    danger:  "bg-rose-50 text-rose-700 ring-1 ring-rose-200",
    info:    "bg-indigo-50 text-indigo-700 ring-1 ring-indigo-200",
  };
  return <span className={cx("inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold", tones[tone])}>{children}</span>;
}

function Card({ title, subtitle, children, actions }: { title?: string; subtitle?: string; children: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white/80 backdrop-blur-sm p-4 shadow-sm">
      {(title || actions || subtitle) && (
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            {title && <div className="text-sm font-semibold text-slate-900">{title}</div>}
            {subtitle && <div className="text-xs text-slate-500">{subtitle}</div>}
          </div>
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return <kbd className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[10px] font-semibold text-slate-700 shadow-inner">{children}</kbd>;
}

// ---------- Connect Wallet ----------
function useEthers() {
  const [provider, setProvider] = useState<ethers.BrowserProvider | null>(null);
  const [signer, setSigner] = useState<ethers.Signer | null>(null);
  const [address, setAddress] = useState<string>("");
  const [chainId, setChainId] = useState<number>(0);
  const [status, setStatus] = useState<string>("disconnected");

  useEffect(() => {
    const init = async () => {
      if (typeof window === "undefined" || !(window as any).ethereum) return;
      const prov = new ethers.BrowserProvider((window as any).ethereum);
      setProvider(prov);

      (window as any).ethereum.on?.("accountsChanged", () => connect());
      (window as any).ethereum.on?.("chainChanged", () => connect());
    };
    init();
  }, []);

  const ensureChain = async () => {
    const eth = (window as any).ethereum;
    if (!eth) throw new Error("No wallet");
    try {
      const net = await provider!.getNetwork();
      if (Number(net.chainId) !== CHAIN_ID_DEC) {
        try {
          await eth.request({ method: "wallet_switchEthereumChain", params: [{ chainId: CHAIN_ID_HEX }] });
        } catch (e: any) {
          if (e?.code === 4902 || /Unrecognized/i.test(String(e?.message))) {
            await eth.request({
              method: "wallet_addEthereumChain",
              params: [
                {
                  chainId: CHAIN_ID_HEX,
                  chainName: "Base Sepolia",
                  rpcUrls: [RPC_URL],
                  nativeCurrency: { name: "Ethereum", symbol: "ETH", decimals: 18 },
                  blockExplorerUrls: ["https://sepolia.basescan.org"],
                },
              ],
            });
          } else {
            throw e;
          }
        }
      }
    } catch (err) {
      console.error("ensureChain error", err);
    }
  };

  const connect = async () => {
    try {
      setStatus("connecting");
      if (!provider) throw new Error("No provider");
      await provider.send("eth_requestAccounts", []);
      await ensureChain();
      const s = await provider.getSigner();
      const addr = await s.getAddress();
      const net = await provider.getNetwork();
      setSigner(s);
      setAddress(addr);
      setChainId(Number(net.chainId));
      setStatus("connected");
    } catch (e) {
      console.error(e);
      setStatus("error");
    }
  };

  return { provider, signer, address, chainId, status, connect };
}

// ---------- Contracts hook ----------
function useContracts(provider: ethers.Provider | null, signer: ethers.Signer | null) {
  const readProvider = useMemo(() => {
    if (provider) return provider;
    return new ethers.JsonRpcProvider(RPC_URL);
  }, [provider]);

  const engineR = useMemo(() => ADDRS.engine && new ethers.Contract(ADDRS.engine, [...claimEngineAbi, ...accessControlledAbi], readProvider), [readProvider]);
  const engineW = useMemo(() => signer && ADDRS.engine && new ethers.Contract(ADDRS.engine, [...claimEngineAbi, ...accessControlledAbi], signer), [signer]);
  const rulesR = useMemo(() => ADDRS.rules && new ethers.Contract(ADDRS.rules, rulesAbi, readProvider), [readProvider]);
  const rulesW = useMemo(() => signer && ADDRS.rules && new ethers.Contract(ADDRS.rules, rulesAbi, signer), [signer]);
  const provRegR = useMemo(() => ADDRS.providerRegistry && new ethers.Contract(ADDRS.providerRegistry, providerRegistryAbi, readProvider), [readProvider]);
  const provRegW = useMemo(() => signer && ADDRS.providerRegistry && new ethers.Contract(ADDRS.providerRegistry, providerRegistryAbi, signer), [signer]);
  const enrollR = useMemo(() => ADDRS.enrollment && new ethers.Contract(ADDRS.enrollment, enrollmentAbi, readProvider), [readProvider]);
  const enrollW = useMemo(() => signer && ADDRS.enrollment && new ethers.Contract(ADDRS.enrollment, enrollmentAbi, signer), [signer]);
  const bankR = useMemo(() => ADDRS.bank && new ethers.Contract(ADDRS.bank, bankAbi, readProvider), [readProvider]);

  return { engineR, engineW, rulesR, rulesW, provRegR, provRegW, enrollR, enrollW, bankR } as const;
}

// ---------- Main App ----------
export default function App() {
  const { provider, signer, address, chainId, status, connect } = useEthers();
  const { engineR, engineW, rulesR, rulesW, provRegR, provRegW, enrollR, enrollW, bankR } = useContracts(provider, signer);

  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [owner, setOwner] = useState<string>("");

  // role detection
  useEffect(() => {
    (async () => {
      try {
        if (!engineR || !address) return;
        const own = await (engineR as any).owner();
        setOwner(own);
        setIsAdmin(own.toLowerCase() === address.toLowerCase());
      } catch (e) {
        console.warn("owner() read failed", e);
        setIsAdmin(null);
      }
    })();
  }, [engineR, address]);

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white text-slate-900">
      <header className="sticky top-0 z-20 border-b border-slate-200/80 bg-white/70 backdrop-blur supports-[backdrop-filter]:bg-white/50">
        <div className="mx-auto max-w-6xl px-4">
          <div className="flex h-14 items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <LogoMark />
              <div className="hidden text-sm font-semibold sm:block">Claims Demo</div>
              <Badge tone="info">Base Sepolia</Badge>
            </div>
            <div className="flex items-center gap-2">
              <span className="hidden text-xs text-slate-600 sm:block">Chain: {chainId || "-"}</span>
              {address ? (
                <span className="truncate rounded-full border border-slate-200 bg-white px-3 py-1 text-xs shadow-sm">
                  {address.slice(0, 6)}…{address.slice(-4)}
                </span>
              ) : (
                <Button onClick={connect} variant="primary" size="sm">Connect Wallet</Button>
              )}
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-6">
        {!address ? (
          <EmptyState title="Connect your wallet" subtitle="Use MetaMask on Base Sepolia to continue." />
        ) : isAdmin === null ? (
          <EmptyState title="Checking role…" subtitle="Reading ClaimEngine.owner()" />
        ) : isAdmin ? (
          <AdminConsole
            address={address}
            owner={owner}
            bankR={bankR}
            engineR={engineR}
            engineW={engineW}
            rulesR={rulesR}
            rulesW={rulesW}
            provRegR={provRegR}
            provRegW={provRegW}
            enrollR={enrollR}
            enrollW={enrollW}
          />
        ) : (
          <ProviderPortal address={address} engineR={engineR} engineW={engineW} rulesR={rulesR} bankR={bankR} />
        )}
      </main>

      <footer className="border-t border-slate-100/80 py-6 text-center text-xs text-slate-500">
        Engine: <span className="font-mono">{ADDRS.engine || "-"}</span>
      </footer>
    </div>
  );
}

function EmptyState({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="py-24 text-center">
      <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-600">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="h-6 w-6"><path d="M12 2a9 9 0 00-9 9v5.586l-1.707 1.707A1 1 0 002 20h20a1 1 0 00.707-1.707L21 16.586V11a9 9 0 00-9-9zM5 11a7 7 0 1114 0v6h-1a1 1 0 00-1 1v1H7v-1a1 1 0 00-1-1H5v-6z"/></svg>
      </div>
      <h2 className="mb-1 text-xl font-semibold tracking-tight">{title}</h2>
      <p className="text-sm text-slate-600">{subtitle}</p>
    </div>
  );
}

function LogoMark() {
  return (
    <div className="flex items-center gap-2">
      <span className="inline-flex h-6 w-6 items-center justify-center rounded-lg bg-slate-900 text-white shadow-sm">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor"><path d="M12 2l3 6 6 .9-4.5 4.4L17.5 20 12 16.9 6.5 20l1-6.7L3 8.9 9 8l3-6z"/></svg>
      </span>
      <span className="text-sm font-semibold">Prometheus</span>
    </div>
  );
}

// ---------- Admin Console ----------
function AdminConsole({ address, owner, bankR, engineR, engineW, rulesR, rulesW, provRegR, provRegW, enrollR, enrollW }:{
  address: string;
  owner: string;
  bankR: ethers.Contract | null;
  engineR: ethers.Contract | null;
  engineW: ethers.Contract | null;
  rulesR: ethers.Contract | null;
  rulesW: ethers.Contract | null;
  provRegR: ethers.Contract | null;
  provRegW: ethers.Contract | null;
  enrollR: ethers.Contract | null;
  enrollW: ethers.Contract | null;
}) {
  const [vault, setVault] = useState<bigint>(0n);
  const [paused, setPaused] = useState<boolean>(false);

  useEffect(() => {
    (async () => {
      try {
        if (bankR) {
          const bal: bigint = await (bankR as any).vaultBalance();
          setVault(bal);
        }
        if (engineR) {
          const p: boolean = await (engineR as any).paused();
          setPaused(p);
        }
      } catch (e) {}
    })();
  }, [bankR, engineR]);

  const doTogglePause = async () => {
    if (!engineW) return;
    const tx = await (engineW as any).setPaused(!paused);
    await tx.wait();
    const p: boolean = await (engineR as any).paused();
    setPaused(p);
  };

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
      <section className="lg:col-span-3">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <StatCard label="Vault (USDC)" value={`${fmtUSDC(vault)} USDC`} />
          <StatCard label="Engine" value={paused ? "Paused" : "Active"} tone={paused ? "warning" : "success"} />
          <StatCard label="Admin wallet" value={`${owner.slice(0,6)}…${owner.slice(-4)}`} mono />
        </div>
        <div className="mt-3">
          <Button onClick={doTogglePause} variant={paused ? "secondary" : "danger"}>
            {paused ? "Unpause Engine" : "Pause Engine"}
          </Button>
        </div>
      </section>

      <RulesManager rulesR={rulesR} rulesW={rulesW} />
      <ProvidersManager provRegR={provRegR} provRegW={provRegW} />
      <CoverageManager enrollR={enrollR} enrollW={enrollW} />
    </div>
  );
}

function StatCard({ label, value, tone, mono }: { label: string; value: string; tone?: "success" | "warning" | "danger" | "info"; mono?: boolean }) {
  return (
    <Card>
      <div className="flex items-start justify-between">
        <div>
          <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
          <div className={cx("mt-1 text-lg font-semibold", mono && "font-mono")}>{value}</div>
        </div>
        {tone && <Badge tone={tone}>{tone}</Badge>}
      </div>
    </Card>
  );
}

function RulesManager({ rulesR, rulesW }:{ rulesR: ethers.Contract | null; rulesW: ethers.Contract | null; }) {
  const [code, setCode] = useState<string>("1");
  const [enabled, setEnabled] = useState<boolean>(false);
  const [price, setPrice] = useState<string>("0");
  const [cap, setCap] = useState<string>("0");
  const [label, setLabel] = useState<string>("");
  const [loading, setLoading] = useState(false);

  const load = async () => {
    if (!rulesR || !code) return;
    setLoading(true);
    try {
      const [en, pr, mx] = await (rulesR as any).getRule(Number(code));
      setEnabled(Boolean(en));
      setPrice(pr.toString());
      setCap(mx.toString());
    } finally { setLoading(false); }
  };

  const saveAll = async () => {
    if (!rulesW || !code) return;
    const tx = await (rulesW as any).setRule(Number(code), enabled, BigInt(price||"0"), Number(cap||"0"), label||"");
    await tx.wait();
    await load();
  };

  useEffect(() => { load(); }, []);

  return (
    <Card title="Rules Manager" subtitle="Configure payout rules per code" actions={<Button onClick={saveAll}>Save Rule</Button>}>
      <div className="grid grid-cols-1 items-end gap-3 md:grid-cols-5">
        <div>
          <Label>Code (uint16)</Label>
          <Input value={code} onChange={e=>setCode(e.target.value)} placeholder="1" />
        </div>
        <div>
          <Label>Enabled</Label>
          <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm shadow-sm">
            <input type="checkbox" checked={enabled} onChange={e=>setEnabled(e.target.checked)} />
            <span>Enabled</span>
          </div>
        </div>
        <div>
          <Label>Price (raw, 6 decimals)</Label>
          <Input value={price} onChange={e=>setPrice(e.target.value)} placeholder="250000" />
          <div className="mt-1 text-xs text-slate-500">≈ {fmtUSDC(BigInt(price||"0"))} USDC</div>
        </div>
        <div>
          <Label>maxPerYear (0=unlimited)</Label>
          <Input value={cap} onChange={e=>setCap(e.target.value)} placeholder="0" />
        </div>
        <div>
          <Label>Label</Label>
          <Input value={label} onChange={e=>setLabel(e.target.value)} placeholder="Telehealth" />
        </div>
      </div>
      <div className="mt-3 flex items-center gap-2">
        <Button variant="subtle" onClick={load}>{loading?"Loading…":"Reload"}</Button>
        <div className="text-xs text-slate-500">Use codes <Kbd>1</Kbd> (Telehealth) and <Kbd>2</Kbd> (Annual) for your pilot.</div>
      </div>
    </Card>
  );
}

function ProvidersManager({ provRegR, provRegW }:{ provRegR: ethers.Contract | null; provRegW: ethers.Contract | null; }) {
  const [addr, setAddr] = useState<string>("");
  const [year, setYear] = useState<string>("2025");
  const [active, setActive] = useState<boolean>(true);
  const [startY, setStartY] = useState<string>("2024");
  const [endY, setEndY] = useState<string>("0");
  const [isAct, setIsAct] = useState<string>("-");

  const check = async () => {
    if (!provRegR || !addr || !year) return;
    const ok: boolean = await (provRegR as any).isActive(addr, Number(year));
    setIsAct(ok ? "active" : "inactive");
  };

  const save = async () => {
    if (!provRegW || !addr) return;
    const tx = await (provRegW as any).setProvider(addr, active, Number(startY||"0"), Number(endY||"0"));
    await tx.wait();
    await check();
  };

  return (
    <Card title="Providers" subtitle="Whitelist provider wallets with optional year windows" actions={<Button onClick={save}>Save</Button>}>
      <div className="grid grid-cols-1 items-end gap-3 md:grid-cols-5">
        <div>
          <Label>Provider address</Label>
          <Input value={addr} onChange={e=>setAddr(e.target.value)} placeholder="0x..." />
        </div>
        <div>
          <Label>Active?</Label>
          <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm shadow-sm">
            <input type="checkbox" checked={active} onChange={e=>setActive(e.target.checked)} />
            <span>active</span>
          </div>
        </div>
        <div>
          <Label>Start year (0=open)</Label>
          <Input value={startY} onChange={e=>setStartY(e.target.value)} />
        </div>
        <div>
          <Label>End year (0=open)</Label>
          <Input value={endY} onChange={e=>setEndY(e.target.value)} />
        </div>
        <div>
          <Label>Check year</Label>
          <Input value={year} onChange={e=>setYear(e.target.value)} />
        </div>
      </div>
      <div className="mt-3 flex items-center gap-2">
        <Button variant="subtle" onClick={check}>Check</Button>
        <div className="text-xs text-slate-500">Status: {isAct}</div>
      </div>
    </Card>
  );
}

function CoverageManager({ enrollR, enrollW }:{ enrollR: ethers.Contract | null; enrollW: ethers.Contract | null; }) {
  const [patientId, setPatientId] = useState<string>("");
  const [year, setYear] = useState<string>("2025");
  const [active, setActive] = useState<boolean>(true);
  const [startY, setStartY] = useState<string>("2025");
  const [endY, setEndY] = useState<string>("0");
  const [covered, setCovered] = useState<string>("-");

  const check = async () => {
    if (!enrollR || !patientId || !year) return;
    if (!isBytes32Hex(patientId)) { alert("patientId must be 0x + 64 hex chars"); return; }
    const ok: boolean = await (enrollR as any).isCovered(patientId, Number(year));
    setCovered(ok ? "covered" : "not covered");
  };

  const save = async () => {
    if (!enrollW || !patientId) return;
    if (!isBytes32Hex(patientId)) { alert("patientId must be 0x + 64 hex chars"); return; }
    const tx = await (enrollW as any).setCoverage(patientId, active, Number(startY||"0"), Number(endY||"0"));
    await tx.wait();
    await check();
  };

  return (
    <Card title="Coverage" subtitle="Manage enrollment by pseudonymous patientId" actions={<Button onClick={save}>Save</Button>}>
      <div className="grid grid-cols-1 items-end gap-3 md:grid-cols-6">
        <div className="md:col-span-3">
          <Label>patientId (bytes32)</Label>
          <Input value={patientId} onChange={e=>setPatientId(e.target.value)} placeholder="0x…64 hex" />
        </div>
        <div>
          <Label>Active?</Label>
          <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm shadow-sm">
            <input type="checkbox" checked={active} onChange={e=>setActive(e.target.checked)} />
            <span>active</span>
          </div>
        </div>
        <div>
          <Label>Start year</Label>
          <Input value={startY} onChange={e=>setStartY(e.target.value)} />
        </div>
        <div>
          <Label>End year (0=open)</Label>
          <Input value={endY} onChange={e=>setEndY(e.target.value)} />
        </div>
      </div>
      <div className="mt-3 flex items-center gap-2">
        <Button variant="subtle" onClick={check}>Check</Button>
        <div className="text-xs text-slate-500">Status: {covered}</div>
      </div>
    </Card>
  );
}

// ---------- Provider Portal ----------
function ProviderPortal({ address, engineR, engineW, rulesR, bankR }:{
  address: string;
  engineR: ethers.Contract | null;
  engineW: ethers.Contract | null;
  rulesR: ethers.Contract | null;
  bankR: ethers.Contract | null;
}) {
  const [patientId, setPatientId] = useState("");
  const [code, setCode] = useState("1");
  const [year, setYear] = useState("2025");
  const [lastTx, setLastTx] = useState<string>("");
  const [result, setResult] = useState<string>("");
  const [vault, setVault] = useState<bigint>(0n);
  const [pricePreview, setPricePreview] = useState<string>("-");

  useEffect(() => {
    (async () => {
      try {
        if (bankR) {
          const bal: bigint = await (bankR as any).vaultBalance();
          setVault(bal);
        }
      } catch {}
    })();
  }, [bankR]);

  useEffect(() => {
    (async () => {
      if (!rulesR || !code) { setPricePreview("-"); return; }
      const [en, pr, mx] = await (rulesR as any).getRule(Number(code));
      if (!en || pr === 0n) setPricePreview("disabled"); else setPricePreview(`${fmtUSDC(pr)} USDC`);
    })();
  }, [rulesR, code]);

  const submit = async () => {
    if (!engineW) return;
    if (!isBytes32Hex(patientId)) { alert("patientId must be 0x + 64 hex chars"); return; }
    setResult("Submitting…");
    try {
      const tx = await (engineW as any).submit(patientId, Number(code), Number(year));
      setLastTx(tx.hash);
      const rcpt = await tx.wait();
      let paid: any | null = null;
      let rejected: any | null = null;
      const iface = new ethers.Interface(claimEngineAbi);
      for (const log of rcpt.logs) {
        try {
          const parsed = iface.parseLog(log);
          if (parsed?.name === "ClaimPaid") paid = parsed;
          if (parsed?.name === "ClaimRejected") rejected = parsed;
        } catch {}
      }
      if (paid) {
        const amount = paid.args[5] as bigint;
        const vix = paid.args[6] as number;
        setResult(`✅ Paid ${fmtUSDC(amount)} USDC · visit #${vix}`);
      } else if (rejected) {
        const reason = rejected.args[4] as string;
        setResult(`❌ Rejected: ${reason}`);
      } else {
        setResult("Tx mined, no event parsed (check explorer)");
      }
      try { const bal: bigint = await (bankR as any).vaultBalance(); setVault(bal); } catch {}
    } catch (e: any) {
      console.error(e);
      setResult(e?.shortMessage || e?.message || "Error");
    }
  };

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
      <Card title="Submit Claim" subtitle="Send a claim to the engine in one click" actions={<Button variant="secondary" onClick={submit}>Submit</Button>}>
        <div className="grid grid-cols-1 items-end gap-3 md:grid-cols-4">
          <div className="md:col-span-2">
            <Label>patientId (bytes32)</Label>
            <Input value={patientId} onChange={e=>setPatientId(e.target.value)} placeholder="0x…64 hex" />
          </div>
          <div>
            <Label>Code</Label>
            <Select value={code} onChange={e=>setCode(e.target.value)}>
              <option value="1">1 — Telehealth</option>
              <option value="2">2 — Annual</option>
            </Select>
          </div>
          <div>
            <Label>Year</Label>
            <Input value={year} onChange={e=>setYear(e.target.value)} placeholder="2025" />
          </div>
        </div>
        <div className="mt-3 text-sm text-slate-600">Price: {pricePreview}</div>
        <div className="mt-3 flex items-center gap-3 text-sm">
          {lastTx && <a className="text-indigo-600 underline" href={`https://sepolia.basescan.org/tx/${lastTx}`} target="_blank">View tx</a>}
          <div>{result}</div>
        </div>
      </Card>

      <Card title="Vault Snapshot" subtitle="USDC available for payouts">
        <div className="text-sm">Bank balance: <b>{fmtUSDC(vault)} USDC</b></div>
        <div className="mt-2 text-xs text-slate-500">If under code price, engine will reject as “bank underfunded”.</div>
      </Card>

      <HistoryPanel engineR={engineR} provider={address} />
    </div>
  );
}

function HistoryPanel({ engineR, provider }:{ engineR: ethers.Contract | null; provider: string; }) {
  const [items, setItems] = useState<any[]>([]);
  const [fromBlock, setFromBlock] = useState<string>("0");

  const load = async () => {
    if (!engineR) return;
    const prov = provider?.toLowerCase();
    const paidLogs = await (engineR as any).queryFilter("ClaimPaid", Number(fromBlock||"0"));
    const rejLogs = await (engineR as any).queryFilter("ClaimRejected", Number(fromBlock||"0"));
    const rows: any[] = [];
    for (const l of paidLogs) {
      if (l.args?.provider?.toLowerCase() !== prov) continue;
      rows.push({ kind: "paid", id: l.args.id.toString(), code: Number(l.args.code), year: Number(l.args.year), amount: l.args.amount as bigint, visitIndex: Number(l.args.visitIndex), tx: l.transactionHash, block: l.blockNumber });
    }
    for (const l of rejLogs) {
      if (l.args?.provider?.toLowerCase() !== prov) continue;
      rows.push({ kind: "rejected", id: "-", code: Number(l.args.code), year: Number(l.args.year), reason: l.args.reason as string, tx: l.transactionHash, block: l.blockNumber });
    }
    rows.sort((a,b)=>a.block-b.block);
    setItems(rows.reverse());
  };

  useEffect(() => { load(); }, [engineR, provider]);

  return (
    <Card title="My Claims" actions={
      <div className="flex items-center gap-2 text-sm">
        <span>from block</span>
        <Input className="w-28" value={fromBlock} onChange={e=>setFromBlock(e.target.value)} placeholder="0" />
        <Button variant="subtle" onClick={load}>Reload</Button>
      </div>
    }>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-white text-left text-slate-500">
            <tr>
              <th className="py-2 pr-3">Block</th>
              <th className="py-2 pr-3">Type</th>
              <th className="py-2 pr-3">Code</th>
              <th className="py-2 pr-3">Year</th>
              <th className="py-2 pr-3">Amount / Reason</th>
              <th className="py-2 pr-3">Visit#</th>
              <th className="py-2 pr-3">Tx</th>
            </tr>
          </thead>
          <tbody>
            {items.map((r, i) => (
              <tr key={i} className="border-t">
                <td className="py-2 pr-3 text-slate-500">{r.block}</td>
                <td className="py-2 pr-3">{r.kind === "paid" ? <Badge tone="success">paid</Badge> : <Badge tone="danger">rejected</Badge>}</td>
                <td className="py-2 pr-3">{r.code}</td>
                <td className="py-2 pr-3">{r.year}</td>
                <td className="py-2 pr-3">{r.amount ? fmtUSDC(r.amount) : r.reason}</td>
                <td className="py-2 pr-3">{r.visitIndex ?? "-"}</td>
                <td className="py-2 pr-3"><a className="text-indigo-600 underline" href={`https://sepolia.basescan.org/tx/${r.tx}`} target="_blank" rel="noreferrer">view</a></td>
              </tr>
            ))}
            {!items.length && (
              <tr><td colSpan={7} className="py-6 text-center text-slate-500">No events yet</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
