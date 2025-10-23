import React, { useEffect, useMemo, useState } from "react";
import { ethers } from "ethers";

/**
 * Minimal dual-face dapp (Admin Console removed for brevity here)
 * Provider: submit claims, see live USDC wallet balance, and view claim history
 */

// ---------- ABIs ----------
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

// Minimal ERC20 ABI (for live USDC balance updates)
const erc20Abi = [
  "event Transfer(address indexed from, address indexed to, uint256 value)",
  "function balanceOf(address) view returns (uint256)"
];

// ---------- Config ----------
const CHAIN_ID_DEC = 84532; // Base Sepolia
const CHAIN_ID_HEX = "0x" + CHAIN_ID_DEC.toString(16);
const RPC_URL = "https://sepolia.base.org";

// 👇 Hard-coded addresses (edit as needed)
const ADDRS = {
  engine: (import.meta.env.VITE_ENGINE || "").trim(), // keep from env if you want
  rules: (import.meta.env.VITE_RULES || "").trim(),
  bank: (import.meta.env.VITE_BANK || "").trim(),
  usdc: "0x036CbD53842c5426634e7929541eC2318f3dCF7e", // Base Sepolia USDC test token
};

// ---------- Helpers ----------
function fmtUSDC(x?: bigint) {
  if (x === undefined) return "-";
  const whole = x / 1_000_000n;
  const frac = (x % 1_000_000n).toString().padStart(6, "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : whole.toString();
}

function isBytes32Hex(s: string) {
  return /^0x[0-9a-fA-F]{64}$/.test(s);
}

// Chunked query helper to avoid 10k-block RPC limits
async function chunkedQueryFilter(
  c: ethers.Contract,
  filter: any,
  from: number,
  to: number,
  maxSpan = 9_500
): Promise<any[]> {
  const out: any[] = [];
  let start = from;
  while (start <= to) {
    const end = Math.min(start + maxSpan, to);
    try {
      const logs = await (c as any).queryFilter(filter, start, end);
      out.push(...logs);
      start = end + 1;
    } catch (e: any) {
      if (maxSpan <= 200) throw e;
      const smaller = Math.floor(maxSpan / 2);
      const more = await chunkedQueryFilter(c, filter, start, end, smaller);
      out.push(...more);
      start = end + 1;
    }
  }
  return out;
}

// ---------- Wallet ----------
function useEthers() {
  const [provider, setProvider] = useState<ethers.BrowserProvider | null>(null);
  const [address, setAddress] = useState("");
  const [chainId, setChainId] = useState(0);

  useEffect(() => {
    if (!(window as any).ethereum) return;
    setProvider(new ethers.BrowserProvider((window as any).ethereum));
  }, []);

  const ensureChain = async () => {
    const eth = (window as any).ethereum;
    if (!eth || !provider) return;
    const net = await provider.getNetwork();
    if (Number(net.chainId) !== CHAIN_ID_DEC) {
      try {
        await eth.request({ method: "wallet_switchEthereumChain", params: [{ chainId: CHAIN_ID_HEX }] });
      } catch (e: any) {
        if (e?.code === 4902) {
          await eth.request({
            method: "wallet_addEthereumChain",
            params: [{
              chainId: CHAIN_ID_HEX,
              chainName: "Base Sepolia",
              rpcUrls: [RPC_URL],
              nativeCurrency: { name: "Ethereum", symbol: "ETH", decimals: 18 },
              blockExplorerUrls: ["https://sepolia.basescan.org"],
            }]
          });
        } else throw e;
      }
    }
  };

  const connect = async () => {
    if (!provider) return;
    await provider.send("eth_requestAccounts", []);
    await ensureChain();
    const s = await provider.getSigner();
    const addr = await s.getAddress();
    const net = await provider.getNetwork();
    setAddress(addr);
    setChainId(Number(net.chainId));
  };

  return { provider, address, chainId, connect };
}

// ---------- Contracts ----------
function useContracts(provider: ethers.Provider | null) {
  const readProvider = useMemo(() => new ethers.JsonRpcProvider(RPC_URL), []);
  const engineR = useMemo(() => ADDRS.engine && new ethers.Contract(ADDRS.engine, claimEngineAbi, readProvider), [readProvider]);
  const rulesR  = useMemo(() => ADDRS.rules  && new ethers.Contract(ADDRS.rules,  rulesAbi,      readProvider), [readProvider]);
  const bankR   = useMemo(() => ADDRS.bank   && new ethers.Contract(ADDRS.bank,   bankAbi,       readProvider), [readProvider]);
  const usdcR   = useMemo(() => new ethers.Contract(ADDRS.usdc, erc20Abi, readProvider), [readProvider]);
  return { readProvider, engineR, rulesR, bankR, usdcR } as const;
}

// ---------- App ----------
export default function App() {
  const { provider, address, chainId, connect } = useEthers();
  const { readProvider, engineR, rulesR, bankR, usdcR } = useContracts(provider as any);

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
          <ProviderPortal
            address={address}
            engineR={engineR}
            rulesR={rulesR}
            readProvider={readProvider}
            usdcR={usdcR}
          />
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

// ---------- Provider Portal ----------
function ProviderPortal({ address, engineR, rulesR, readProvider, usdcR }: any) {
  const [patientId, setPatientId] = useState("");
  const [code, setCode] = useState("1");
  const [year, setYear] = useState("2025");
  const [result, setResult] = useState<string>("");

  // Connected wallet's USDC balance
  const [myBal, setMyBal] = useState<bigint>(0n);

  // Live USDC balance updates via Transfer events
  useEffect(() => {
    if (!usdcR || !address) return;
    let mounted = true;

    const refresh = async () => {
      try {
        const b: bigint = await (usdcR as any).balanceOf(address);
        if (mounted) setMyBal(b);
      } catch {}
    };

    const toMe   = (usdcR as any).filters?.Transfer?.(null, address);
    const fromMe = (usdcR as any).filters?.Transfer?.(address, null);
    const onXfer = () => refresh();

    refresh();
    try { toMe && usdcR.on(toMe, onXfer); } catch {}
    try { fromMe && usdcR.on(fromMe, onXfer); } catch {}

    return () => {
      mounted = false;
      try { toMe && usdcR.off(toMe, onXfer); } catch {}
      try { fromMe && usdcR.off(fromMe, onXfer); } catch {}
    };
  }, [usdcR, address]);

  // Price preview from rules
  const [pricePreview, setPricePreview] = useState<string>("-");
  useEffect(() => {
    (async () => {
      if (!rulesR || !code) { setPricePreview("-"); return; }
      const [en, pr] = await (rulesR as any).getRule(Number(code));
      setPricePreview(!en || pr === 0n ? "disabled" : `${fmtUSDC(pr)} USDC`);
    })();
  }, [rulesR, code]);

  // NOTE: submit action omitted (no engineW in this pared file); just showing history + balance
  const submitDisabled = true;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <section className="lg:col-span-2 rounded-2xl border border-slate-200 bg-white p-4">
        <div className="font-semibold mb-3">Submit Claim (demo)</div>
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
          <button disabled={submitDisabled} className="px-3 py-2 rounded bg-slate-100 text-slate-400 cursor-not-allowed">Submit (engineW not wired)</button>
          <div className="text-sm">{result}</div>
        </div>
      </section>

      {/* Account Balance card */}
      <section className="rounded-2xl border border-slate-200 bg-white p-4">
        <div className="font-semibold mb-3">Account Balance</div>
        <div className="text-sm">USDC: <b>{fmtUSDC(myBal)} USDC</b></div>
      </section>

      {/* Claim history (full-width below) */}
      <HistoryPanel engineR={engineR} provider={address} readProvider={readProvider} />
    </div>
  );
}

// ---------- History (with provider-indexed filters + chunked range) ----------
function HistoryPanel({ engineR, provider, readProvider }:{
  engineR: ethers.Contract | null;
  provider: string;
  readProvider: ethers.Provider | null;
}) {
  const [items, setItems] = useState<any[]>([]);
  const [fromBlock, setFromBlock] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string>("");

  const LOOKBACK = 9_000; // default range within RPC limits

  const load = async () => {
    if (!engineR || !readProvider) return;
    setLoading(true); setErr("");
    try {
      const providerAddr = provider?.toLowerCase();
      const to = await readProvider.getBlockNumber();

      // cursor: manual > saved > default lookback
      const saved = Number(localStorage.getItem("claims.fromBlock") || 0);
      const baseFrom =
        fromBlock ? Number(fromBlock) :
        saved     ? saved :
                    Math.max(to - LOOKBACK, 0);

      // Indexed filters by provider
      const paidFilter = (engineR as any).filters?.ClaimPaid?.(null, null, provider);
      const rejFilter  = (engineR as any).filters?.ClaimRejected?.(null, provider);
      if (!paidFilter || !rejFilter) throw new Error("Event filters missing (ABI mismatch?)");

      // Chunked queries
      const [paidLogs, rejLogs] = await Promise.all([
        chunkedQueryFilter(engineR as any, paidFilter, baseFrom, to, 9_500),
        chunkedQueryFilter(engineR as any, rejFilter,  baseFrom, to, 9_500),
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

      rows.sort((a,b)=>a.block-b.block);
      setItems(rows.reverse());

      // advance cursor
      localStorage.setItem("claims.fromBlock", String(to + 1));
    } catch (e: any) {
      console.error(e);
      setErr(e?.message || "Failed to load history");
    } finally {
      setLoading(false);
    }
  };

  const loadOlder = async () => {
    const saved = Number(localStorage.getItem("claims.fromBlock") || 0);
    const to = saved ? saved - 1 : 0;
    setFromBlock(String(Math.max((to ?? 0) - LOOKBACK, 0)));
    await load();
  };

  useEffect(() => { load(); }, [engineR, provider, readProvider]);

  return (
    <section className="lg:col-span-3 rounded-2xl border border-slate-200 bg-white p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="font-semibold">My Claims</div>
        <div className="flex items-center gap-2 text-sm">
          <span>from block</span>
          <input className="w-28 border rounded px-2 py-1" value={fromBlock} onChange={e=>setFromBlock(e.target.value)} placeholder="auto"/>
          <button onClick={load} disabled={loading} className="px-3 py-1 rounded bg-slate-100">
            {loading ? "Loading…" : `Reload (≤ ${LOOKBACK.toLocaleString()} blk)`}
          </button>
          <button onClick={loadOlder} disabled={loading} className="px-3 py-1 rounded bg-slate-100">Load older</button>
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
              <th className="py-2 pr-3">Amount / Reason</th>
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
                  <a className="text-indigo-600 underline" href={`https://sepolia.basescan.org/tx/${r.tx}`} target="_blank" rel="noreferrer">
                    view
                  </a>
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
