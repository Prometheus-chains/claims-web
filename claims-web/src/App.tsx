
import React, { useEffect, useMemo, useState } from "react";
import { ethers } from "ethers";

/**
 * Minimal dual-face dapp (Admin Console + Provider Portal)
 * - Detects role by comparing connected wallet to ClaimEngine.owner()
 * - Admin: view vault balance, pause engine, manage rules/providers/coverage
 * - Provider: submit claims, see personal history by scanning events
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
  // 6 decimals
  const whole = x / 1_000_000n;
  const frac = (x % 1_000_000n).toString().padStart(6, "0");
  // trim trailing zeros for nicer display
  const fracTrim = frac.replace(/0+$/, "");
  return fracTrim.length ? `${whole.toString()}.${fracTrim}` : whole.toString();
}

function isBytes32Hex(s: string) {
  return /^0x[0-9a-fA-F]{64}$/.test(s);
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
          await eth.request({
            method: "wallet_switchEthereumChain",
            params: [{ chainId: CHAIN_ID_HEX }],
          });
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
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="sticky top-0 z-10 bg-white border-b border-slate-200">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="font-semibold">Claims Demo · Base Sepolia</div>
          <div className="flex items-center gap-3">
            <span className="text-sm text-slate-600">Chain: {chainId || "-"}</span>
            {address ? (
              <span className="px-3 py-1 rounded-full bg-slate-100 text-sm">{address.slice(0,6)}…{address.slice(-4)}</span>
            ) : (
              <button onClick={connect} className="px-3 py-1 rounded bg-black text-white">Connect Wallet</button>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-6">
        {!address ? (
          <EmptyState title="Connect your wallet" subtitle="Use MetaMask on Base Sepolia to continue."/>
        ) : isAdmin === null ? (
          <EmptyState title="Checking role…" subtitle="Reading ClaimEngine.owner()"/>
        ) : isAdmin ? (
          <AdminConsole address={address} owner={owner} bankR={bankR} engineR={engineR} engineW={engineW} rulesR={rulesR} rulesW={rulesW} provRegR={provRegR} provRegW={provRegW} enrollR={enrollR} enrollW={enrollW} />
        ) : (
          <ProviderPortal address={address} engineR={engineR} engineW={engineW} rulesR={rulesR} bankR={bankR} />
        )}
      </main>

      <footer className="text-center text-slate-500 text-xs py-6">Engine: {ADDRS.engine || "-"}</footer>
    </div>
  );
}

function EmptyState({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="py-24 text-center">
      <h2 className="text-xl font-semibold mb-2">{title}</h2>
      <p className="text-slate-600">{subtitle}</p>
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
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <section className="col-span-1 lg:col-span-3">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <StatCard label="Vault (USDC)" value={`${fmtUSDC(vault)} USDC`} />
          <StatCard label="Paused" value={paused ? "Yes" : "No"} />
          <StatCard label="Admin wallet" value={`${owner.slice(0,6)}…${owner.slice(-4)}`} />
        </div>
        <div className="mt-3">
          <button onClick={doTogglePause} className="px-3 py-2 rounded bg-indigo-600 text-white">{paused ? "Unpause Engine" : "Pause Engine"}</button>
        </div>
      </section>

      <RulesManager rulesR={rulesR} rulesW={rulesW} />
      <ProvidersManager provRegR={provRegR} provRegW={provRegW} />
      <CoverageManager enrollR={enrollR} enrollW={enrollW} />
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4">
      <div className="text-slate-500 text-xs uppercase tracking-wide">{label}</div>
      <div className="text-lg font-semibold mt-1">{value}</div>
    </div>
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
    <section className="rounded-2xl border border-slate-200 bg-white p-4">
      <div className="font-semibold mb-3">Rules Manager</div>
      <div className="grid grid-cols-1 md:grid-cols-5 gap-3 items-end">
        <div>
          <label className="text-xs text-slate-500">Code (uint16)</label>
          <input className="w-full border rounded px-2 py-1" value={code} onChange={e=>setCode(e.target.value)} placeholder="1"/>
        </div>
        <div>
          <label className="text-xs text-slate-500">Enabled</label>
          <div>
            <input type="checkbox" checked={enabled} onChange={e=>setEnabled(e.target.checked)}/> <span className="text-sm">Enabled</span>
          </div>
        </div>
        <div>
          <label className="text-xs text-slate-500">Price (raw, 6 decimals)</label>
          <input className="w-full border rounded px-2 py-1" value={price} onChange={e=>setPrice(e.target.value)} placeholder="250000"/>
          <div className="text-xs text-slate-500 mt-1">≈ {fmtUSDC(BigInt(price||"0"))} USDC</div>
        </div>
        <div>
          <label className="text-xs text-slate-500">maxPerYear (0=unlimited)</label>
          <input className="w-full border rounded px-2 py-1" value={cap} onChange={e=>setCap(e.target.value)} placeholder="0"/>
        </div>
        <div>
          <label className="text-xs text-slate-500">Label</label>
          <input className="w-full border rounded px-2 py-1" value={label} onChange={e=>setLabel(e.target.value)} placeholder="Telehealth"/>
        </div>
      </div>
      <div className="mt-3 flex items-center gap-2">
        <button onClick={load} className="px-3 py-2 rounded bg-slate-100">{loading?"Loading…":"Reload"}</button>
        <button onClick={saveAll} className="px-3 py-2 rounded bg-indigo-600 text-white">Save Rule</button>
        <div className="text-xs text-slate-500">Use codes 1 (Telehealth) and 2 (Annual) for your current pilot.</div>
      </div>
    </section>
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
    <section className="rounded-2xl border border-slate-200 bg-white p-4">
      <div className="font-semibold mb-3">Providers</div>
      <div className="grid grid-cols-1 md:grid-cols-5 gap-3 items-end">
        <div>
          <label className="text-xs text-slate-500">Provider address</label>
          <input className="w-full border rounded px-2 py-1" value={addr} onChange={e=>setAddr(e.target.value)} placeholder="0x..."/>
        </div>
        <div>
          <label className="text-xs text-slate-500">Active?</label>
          <div><input type="checkbox" checked={active} onChange={e=>setActive(e.target.checked)}/> <span className="text-sm">active</span></div>
        </div>
        <div>
          <label className="text-xs text-slate-500">Start year (0=open)</label>
          <input className="w-full border rounded px-2 py-1" value={startY} onChange={e=>setStartY(e.target.value)} />
        </div>
        <div>
          <label className="text-xs text-slate-500">End year (0=open)</label>
          <input className="w-full border rounded px-2 py-1" value={endY} onChange={e=>setEndY(e.target.value)} />
        </div>
        <div>
          <label className="text-xs text-slate-500">Check year</label>
          <input className="w-full border rounded px-2 py-1" value={year} onChange={e=>setYear(e.target.value)} />
        </div>
      </div>
      <div className="mt-3 flex items-center gap-2">
        <button onClick={check} className="px-3 py-2 rounded bg-slate-100">Check</button>
        <button onClick={save} className="px-3 py-2 rounded bg-indigo-600 text-white">Save</button>
        <div className="text-xs text-slate-500">Status: {isAct}</div>
      </div>
    </section>
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
    <section className="rounded-2xl border border-slate-200 bg-white p-4">
      <div className="font-semibold mb-3">Coverage</div>
      <div className="grid grid-cols-1 md:grid-cols-6 gap-3 items-end">
        <div className="md:col-span-3">
          <label className="text-xs text-slate-500">patientId (bytes32)</label>
          <input className="w-full border rounded px-2 py-1" value={patientId} onChange={e=>setPatientId(e.target.value)} placeholder="0x…64 hex"/>
        </div>
        <div>
          <label className="text-xs text-slate-500">Active?</label>
          <div><input type="checkbox" checked={active} onChange={e=>setActive(e.target.checked)}/> <span className="text-sm">active</span></div>
        </div>
        <div>
          <label className="text-xs text-slate-500">Start year</label>
          <input className="w-full border rounded px-2 py-1" value={startY} onChange={e=>setStartY(e.target.value)} />
        </div>
        <div>
          <label className="text-xs text-slate-500">End year (0=open)</label>
          <input className="w-full border rounded px-2 py-1" value={endY} onChange={e=>setEndY(e.target.value)} />
        </div>
      </div>
      <div className="mt-3 flex items-center gap-2">
        <button onClick={check} className="px-3 py-2 rounded bg-slate-100">Check</button>
        <button onClick={save} className="px-3 py-2 rounded bg-indigo-600 text-white">Save</button>
        <div className="text-xs text-slate-500">Status: {covered}</div>
      </div>
    </section>
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
      // scan logs for ClaimPaid/ClaimRejected
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
        const amount = paid.args[5] as bigint; // amount
        const vix = paid.args[6] as number; // visitIndex
        setResult(`✅ Paid ${fmtUSDC(amount)} USDC · visit #${vix}`);
      } else if (rejected) {
        const reason = rejected.args[4] as string;
        setResult(`❌ Rejected: ${reason}`);
      } else {
        setResult("Tx mined, no event parsed (check explorer)");
      }
      // refresh vault
      try { const bal: bigint = await (bankR as any).vaultBalance(); setVault(bal); } catch {}
    } catch (e: any) {
      console.error(e);
      setResult(e?.shortMessage || e?.message || "Error");
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <section className="lg:col-span-2 rounded-2xl border border-slate-200 bg-white p-4">
        <div className="font-semibold mb-3">Submit Claim</div>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
          <div className="md:col-span-2">
            <label className="text-xs text-slate-500">patientId (bytes32)</label>
            <input className="w-full border rounded px-2 py-1" value={patientId} onChange={e=>setPatientId(e.target.value)} placeholder="0x…64 hex"/>
          </div>
          <div>
            <label className="text-xs text-slate-500">Code</label>
            <select className="w-full border rounded px-2 py-1" value={code} onChange={e=>setCode(e.target.value)}>
              <option value="1">1 — Telehealth</option>
              <option value="2">2 — Annual</option>
            </select>
          </div>
          <div>
            <label className="text-xs text-slate-500">Year</label>
            <input className="w-full border rounded px-2 py-1" value={year} onChange={e=>setYear(e.target.value)} placeholder="2025"/>
          </div>
        </div>
        <div className="mt-3 text-sm text-slate-600">Price: {pricePreview}</div>
        <div className="mt-3 flex items-center gap-2">
          <button onClick={submit} className="px-3 py-2 rounded bg-emerald-600 text-white">Submit</button>
          {lastTx && <a className="text-sm text-indigo-600 underline" href={`https://sepolia.basescan.org/tx/${lastTx}`} target="_blank">View tx</a>}
          <div className="text-sm">{result}</div>
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-4">
        <div className="font-semibold mb-3">Vault Snapshot</div>
        <div className="text-sm">Bank balance: <b>{fmtUSDC(vault)} USDC</b></div>
        <div className="text-xs text-slate-500 mt-2">If under code price, engine will reject as “bank underfunded”.</div>
      </section>

      <HistoryPanel engineR={engineR} provider={address} />
    </div>
  );
}

function HistoryPanel({ engineR, provider }: { engineR: ethers.Contract | null; provider: string }) {
  const [items, setItems] = useState<any[]>([]);
  const [fromBlock, setFromBlock] = useState<string>(""); // optional manual override
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string>("");

  // tune this if you want a larger/smaller window
  const LOOKBACK = 200_000;

  const load = async () => {
    if (!engineR) return;
    setLoading(true); setErr("");

    try {
      const providerAddr = provider?.toLowerCase();
      const to = await (engineR.provider as any).getBlockNumber();

      // cursor: manual > saved > default lookback
      const saved = Number(localStorage.getItem("claims.fromBlock") || 0);
      const baseFrom =
        fromBlock ? Number(fromBlock) :
        saved     ? saved :
                    Math.max(to - LOOKBACK, 0);

      // ⚡️ use indexed filters to narrow on the server
      const paidFilter = (engineR as any).filters?.ClaimPaid?.(null, null, provider);
      const rejFilter  = (engineR as any).filters?.ClaimRejected?.(null, provider);
      if (!paidFilter || !rejFilter) throw new Error("Event filters missing (ABI mismatch?)");

      // bounded range query (from…to)
      const [paidLogs, rejLogs] = await Promise.all([
        (engineR as any).queryFilter(paidFilter, baseFrom, to),
        (engineR as any).queryFilter(rejFilter,  baseFrom, to),
      ]);

      const rows: any[] = [];
      for (const l of paidLogs) {
        if (l.args?.provider?.toLowerCase() !== providerAddr) continue;
        rows.push({
          kind: "paid",
          id: l.args.id.toString(),
          code: Number(l.args.code),
          year: Number(l.args.year),
          amount: l.args.amount as bigint,
          visitIndex: Number(l.args.visitIndex),
          tx: l.transactionHash,
          block: l.blockNumber,
        });
      }
      for (const l of rejLogs) {
        if (l.args?.provider?.toLowerCase() !== providerAddr) continue;
        rows.push({
          kind: "rejected",
          id: "-",
          code: Number(l.args.code),
          year: Number(l.args.year),
          reason: l.args.reason as string,
          tx: l.transactionHash,
          block: l.blockNumber,
        });
      }

      rows.sort((a, b) => a.block - b.block);
      setItems(rows.reverse());

      // advance cursor so the next reload is incremental
      localStorage.setItem("claims.fromBlock", String(to + 1));
    } catch (e: any) {
      console.error(e);
      setErr(e?.message || "Failed to load history");
    } finally {
      setLoading(false);
    }
  };

  // optional: “load older” shifts window backward by LOOKBACK
  const loadOlder = async () => {
    const saved = Number(localStorage.getItem("claims.fromBlock") || 0);
    const to = saved ? saved - 1 : undefined;
    setFromBlock(String(Math.max((to ?? 0) - LOOKBACK, 0)));
    await load();
  };

  useEffect(() => { load(); /* auto on mount & when engine/provider changes */ }, [engineR, provider]);

  return (
    <section className="lg:col-span-3 rounded-2xl border border-slate-200 bg-white p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="font-semibold">My Claims</div>
        <div className="flex items-center gap-2 text-sm">
          <span>from block</span>
          <input
            className="w-28 border rounded px-2 py-1"
            value={fromBlock}
            onChange={(e) => setFromBlock(e.target.value)}
            placeholder="auto"
          />
          <button onClick={load} disabled={loading} className="px-3 py-1 rounded bg-slate-100">
            {loading ? "Loading…" : `Reload (≤ ${LOOKBACK.toLocaleString()} blk)`}
          </button>
          <button onClick={loadOlder} disabled={loading} className="px-3 py-1 rounded bg-slate-100">
            Load older
          </button>
        </div>
      </div>
      {err && <div className="text-xs text-red-600 mb-2">{err}</div>}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-slate-500">
            <tr>
              <th className="py-2 pr-3">Block</th>
              <th className="py-2 pr-3">Type</th>
              <th className="py-2 pr-3">Code</th>
              <th className="py-2 pr-3">Year</th>
              <th className="py-2 pr-3">Amount</th>
              <th className="py-2 pr-3">Visit#</th>
              <th className="py-2 pr-3">Tx</th>
            </tr>
          </thead>
          <tbody>
            {items.map((r, i) => (
              <tr key={i} className="border-t">
                <td className="py-2 pr-3 text-slate-500">{r.block}</td>
                <td className="py-2 pr-3">{r.kind}</td>
                <td className="py-2 pr-3">{r.code}</td>
                <td className="py-2 pr-3">{r.year}</td>
                <td className="py-2 pr-3">{r.amount ? fmtUSDC(r.amount) : r.reason}</td>
                <td className="py-2 pr-3">{r.visitIndex ?? "-"}</td>
                <td className="py-2 pr-3">
                  <a className="text-indigo-600 underline" href={`https://sepolia.basescan.org/tx/${r.tx}`} target="_blank">view</a>
                </td>
              </tr>
            ))}
            {!items.length && (
              <tr><td colSpan={7} className="py-6 text-center text-slate-500">{loading ? "Loading…" : "No events in range"}</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}


