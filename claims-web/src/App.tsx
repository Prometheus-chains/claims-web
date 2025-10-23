import React, { useEffect, useMemo, useState } from "react";
import { ethers } from "ethers";

/**
 * Minimal dual-face dapp (Admin Console + Provider Portal)
 * - Admin: manage engine & rules
 * - Provider: submit claims + view USDC balance & history
 */

const accessControlledAbi = [
  "function owner() view returns (address)",
  "function transferOwnership(address newOwner)"
];

const providerRegistryAbi = [
  "function isActive(address provider, uint16 year) view returns (bool)",
  "function setProvider(address provider, bool active, uint16 startYear, uint16 endYear)"
];

const enrollmentAbi = [
  "function isCovered(bytes32 patientId, uint16 year) view returns (bool)",
  "function setCoverage(bytes32 patientId, bool active, uint16 startYear, uint16 endYear)"
];

const rulesAbi = [
  "function getRule(uint16 code) view returns (bool enabled, uint256 price, uint16 maxPerYear)",
  "function setRule(uint16 code, bool enabled, uint256 price, uint16 maxPerYear, string label)"
];

const bankAbi = [
  "function vaultBalance() view returns (uint256)"
];

const claimEngineAbi = [
  "event ClaimPaid(uint256 indexed id, bytes32 indexed claimKey, address indexed provider, uint16 code, uint16 year, uint256 amount, uint32 visitIndex)",
  "event ClaimRejected(bytes32 indexed claimKey, address indexed provider, uint16 code, uint16 year, string reason)",
  "function paused() view returns (bool)",
  "function setPaused(bool)",
  "function submit(bytes32 patientId, uint16 code, uint16 year)"
];

// --- Minimal ERC20 ABI (for live USDC balance) ---
const erc20Abi = [
  "event Transfer(address indexed from, address indexed to, uint256 value)",
  "function balanceOf(address) view returns (uint256)"
];

// --- Config / constants ---
const CHAIN_ID_DEC = 84532; // Base Sepolia
const CHAIN_ID_HEX = "0x" + CHAIN_ID_DEC.toString(16);
const RPC_URL = "https://sepolia.base.org";

// 👇 Hard-coded USDC token (Base Sepolia)
const ADDRS = {
  engine: (import.meta.env.VITE_ENGINE || "").trim(),
  rules: (import.meta.env.VITE_RULES || "").trim(),
  providerRegistry: (import.meta.env.VITE_PROVIDER_REGISTRY || "").trim(),
  enrollment: (import.meta.env.VITE_ENROLLMENT || "").trim(),
  bank: (import.meta.env.VITE_BANK || "").trim(),
  usdc: "0x036CbD53842c5426634e7929541eC2318f3dCF7e" // Base Sepolia USDC test token
};

function fmtUSDC(x?: bigint) {
  if (x === undefined) return "-";
  const whole = x / 1_000_000n;
  const frac = (x % 1_000_000n).toString().padStart(6, "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : whole.toString();
}

function isBytes32Hex(s: string) {
  return /^0x[0-9a-fA-F]{64}$/.test(s);
}

// --- Wallet ---
function useEthers() {
  const [provider, setProvider] = useState<ethers.BrowserProvider | null>(null);
  const [signer, setSigner] = useState<ethers.Signer | null>(null);
  const [address, setAddress] = useState("");
  const [chainId, setChainId] = useState(0);

  useEffect(() => {
    if (!(window as any).ethereum) return;
    const prov = new ethers.BrowserProvider((window as any).ethereum);
    setProvider(prov);
  }, []);

  const connect = async () => {
    if (!provider) return;
    await provider.send("eth_requestAccounts", []);
    const s = await provider.getSigner();
    const addr = await s.getAddress();
    const net = await provider.getNetwork();
    setSigner(s);
    setAddress(addr);
    setChainId(Number(net.chainId));
  };

  return { provider, signer, address, chainId, connect };
}

// --- Contracts ---
function useContracts(provider: ethers.Provider | null, signer: ethers.Signer | null) {
  const readProvider = useMemo(() => new ethers.JsonRpcProvider(RPC_URL), []);
  const engineR = useMemo(() => ADDRS.engine && new ethers.Contract(ADDRS.engine, claimEngineAbi, readProvider), [readProvider]);
  const engineW = useMemo(() => signer && ADDRS.engine && new ethers.Contract(ADDRS.engine, claimEngineAbi, signer), [signer]);
  const rulesR = useMemo(() => ADDRS.rules && new ethers.Contract(ADDRS.rules, rulesAbi, readProvider), [readProvider]);
  const bankR = useMemo(() => ADDRS.bank && new ethers.Contract(ADDRS.bank, bankAbi, readProvider), [readProvider]);
  const usdcR = useMemo(() => new ethers.Contract(ADDRS.usdc, erc20Abi, readProvider), [readProvider]);
  return { readProvider, engineR, engineW, rulesR, bankR, usdcR } as const;
}

// --- App root ---
export default function App() {
  const { provider, signer, address, chainId, connect } = useEthers();
  const { readProvider, engineR, engineW, rulesR, bankR, usdcR } = useContracts(provider, signer);

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="sticky top-0 bg-white border-b border-slate-200">
        <div className="max-w-6xl mx-auto px-4 py-3 flex justify-between">
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
          <EmptyState title="Connect your wallet" subtitle="Use MetaMask on Base Sepolia." />
        ) : (
          <ProviderPortal address={address} engineR={engineR} engineW={engineW} rulesR={rulesR} bankR={bankR} readProvider={readProvider} usdcR={usdcR} />
        )}
      </main>
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

// --- Provider Portal ---
function ProviderPortal({ address, engineW, rulesR, readProvider, usdcR }: any) {
  const [patientId, setPatientId] = useState("");
  const [code, setCode] = useState("1");
  const [year, setYear] = useState("2025");
  const [lastTx, setLastTx] = useState("");
  const [result, setResult] = useState("");

  // connected wallet USDC balance
  const [myBal, setMyBal] = useState<bigint>(0n);

  // Load + auto-update on Transfer events
  useEffect(() => {
    if (!usdcR || !address) return;
    let mounted = true;
    const refresh = async () => {
      try {
        const b: bigint = await (usdcR as any).balanceOf(address);
        if (mounted) setMyBal(b);
      } catch {}
    };
    const toMe = (usdcR as any).filters?.Transfer?.(null, address);
    const fromMe = (usdcR as any).filters?.Transfer?.(address, null);
    const onXfer = () => refresh();
    refresh();
    toMe && usdcR.on(toMe, onXfer);
    fromMe && usdcR.on(fromMe, onXfer);
    return () => {
      mounted = false;
      toMe && usdcR.off(toMe, onXfer);
      fromMe && usdcR.off(fromMe, onXfer);
    };
  }, [usdcR, address]);

  const [pricePreview, setPricePreview] = useState("-");
  useEffect(() => {
    (async () => {
      if (!rulesR || !code) { setPricePreview("-"); return; }
      const [en, pr] = await (rulesR as any).getRule(Number(code));
      setPricePreview(!en || pr === 0n ? "disabled" : `${fmtUSDC(pr)} USDC`);
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
      const iface = new ethers.Interface(claimEngineAbi);
      let paid: any | null = null;
      let rejected: any | null = null;
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
        setResult(`❌ Rejected: ${rejected.args[4]}`);
      } else setResult("Tx mined, no event parsed");
      try { if (usdcR && address) setMyBal(await (usdcR as any).balanceOf(address)); } catch {}
    } catch (e: any) {
      console.error(e);
      setResult(e?.message || "Error");
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <section className="lg:col-span-2 rounded-2xl border border-slate-200 bg-white p-4">
        <div className="font-semibold mb-3">Submit Claim</div>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
          <div className="md:col-span-2">
            <label className="text-xs text-slate-500">patientId (bytes32)</label>
            <input className="w-full border rounded px-2 py-1" value={patientId} onChange={e=>setPatientId(e.target.value)} placeholder="0x…64 hex" />
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
            <input className="w-full border rounded px-2 py-1" value={year} onChange={e=>setYear(e.target.value)} />
          </div>
        </div>
        <div className="mt-3 text-sm text-slate-600">Price: {pricePreview}</div>
        <div className="mt-3 flex items-center gap-2">
          <button onClick={submit} className="px-3 py-2 rounded bg-emerald-600 text-white">Submit</button>
          {lastTx && <a className="text-sm text-indigo-600 underline" href={`https://sepolia.basescan.org/tx/${lastTx}`} target="_blank">View tx</a>}
          <div className="text-sm">{result}</div>
        </div>
      </section>

      {/* Account Balance card */}
      <section className="rounded-2xl border border-slate-200 bg-white p-4">
        <div className="font-semibold mb-3">Account Balance</div>
        <div className="text-sm">USDC: <b>{fmtUSDC(myBal)} USDC</b></div>
      </section>
    </div>
  );
}
