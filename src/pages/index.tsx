import Head from "next/head";
import { useEffect, useRef, useState } from "react";
import styles from "@/styles/Home.module.css";

import type {
  DecompilationResponse,
  DecompilationResult,
} from "@/lib/decompiler.worker";

type Tab = "contract" | "stdlib" | "json";
const resultCache = new Map<string, DecompilationResult>();

export default function Home() {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<DecompilationResult | null>(null);
  const [tab, setTab] = useState<Tab>("contract");
  const [copied, setCopied] = useState(false);
  const request = useRef<(() => void) | null>(null);
  useEffect(() => () => request.current?.(), []);
  const source = result
    ? tab === "json"
      ? JSON.stringify(result, null, 2)
      : tab === "contract"
        ? (result.display_contract ?? result.contract)
        : (result.display_stdlib ?? result.stdlib)
    : "";

  function decompile() {
    request.current?.();
    const raw = code.trim();
    setError("");
    setCopied(false);
    setTab("contract");
    const cached = resultCache.get(raw);
    setResult(cached ?? null);
    if (cached) {
      setBusy(false);
      return;
    }
    setBusy(true);
    let worker: Worker | undefined;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const stop = () => {
      clearTimeout(timeout);
      worker?.terminate();
      request.current = null;
    };
    request.current = stop;
    try {
      worker = new Worker(
        new URL("../lib/decompiler.worker.ts", import.meta.url),
      );
      worker.onmessage = (event: MessageEvent<DecompilationResponse>) => {
        stop();
        setBusy(false);
        if ("error" in event.data) setError(event.data.error);
        else {
          resultCache.set(raw, event.data.result);
          setResult(event.data.result);
        }
      };
      worker.onerror = worker.onmessageerror = () => {
        stop();
        setBusy(false);
        setError("Unable to run the browser decompiler. Please try again.");
      };
      timeout = setTimeout(() => {
        stop();
        setBusy(false);
        setError("Decompilation exceeded the 30-second limit.");
      }, 30_000);
      worker.postMessage(raw);
    } catch (cause) {
      stop();
      setBusy(false);
      setError(
        cause instanceof Error
          ? cause.message
          : "Unable to start the decompiler.",
      );
    }
  }
  function cancel() {
    request.current?.();
    setBusy(false);
    setError("Decompilation cancelled.");
  }
  async function copy() {
    try {
      await navigator.clipboard.writeText(source);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError(
        "Could not copy. Select the code manually or download the file.",
      );
    }
  }
  function download() {
    // Contract and helper declarations together make a standalone FunC file.
    const content = tab === "contract" ? (result?.func ?? source) : source;
    const url = URL.createObjectURL(
      new Blob([content], { type: "text/plain;charset=utf-8" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = tab === "json" ? "decompilation.json" : `contract-${tab}.fc`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return (
    <>
      <Head>
        <title>TON Decompiler — BOC → FunC</title>
        <meta
          name="description"
          content="Decompile TON smart contract bytecode into readable FunC."
        />
      </Head>
      <main className={styles.main}>
        <header className={styles.header}>
          <a href="/" className={styles.brand}>
            <span className={styles.logo}>T</span> TON
            <span className={styles.muted}>Decompiler</span>
          </a>
          <span className={styles.badge}>BOC → FunC</span>
        </header>
        <section className={styles.intro}>
          <div className={styles.eyebrow}>TON DEVELOPER TOOLS</div>
          <h1>
            TON Smart Contract
            <br />
            <span>Decompiler</span>
          </h1>
          <p>
            Paste a contract code BOC to reconstruct functions, control flow,
            and data operations in readable FunC.
          </p>
        </section>
        <section className={styles.panel} aria-label="Contract input">
          <div className={styles.sectionHead}>
            <label htmlFor="boc">Contract code</label>
            <span className={styles.muted}>Base64 · up to 1 MiB</span>
          </div>
          <textarea
            id="boc"
            spellCheck={false}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            disabled={busy}
            placeholder="te6ccgE…"
          />
          <div className={styles.actions}>
            <span className={styles.muted}>Runs locally in your browser</span>
            <div className={styles.buttons}>
              {busy && <button onClick={cancel}>Cancel</button>}
              <button
                className={styles.primary}
                disabled={busy || !code.trim()}
                onClick={decompile}
              >
                {busy ? "Decompiling…" : "Decompile →"}
              </button>
            </div>
          </div>
        </section>
        {error && (
          <p role="alert" className={styles.error}>
            {error}
          </p>
        )}
        {busy && (
          <p role="status" className={styles.loading}>
            Analyzing instructions and reconstructing FunC in your browser.
          </p>
        )}
        {result && (
          <section className={styles.result} aria-label="Decompilation result">
            <div className={styles.resultHead}>
              <div>
                <div className={styles.eyebrow}>RESULT</div>
                <h2>Reconstructed contract</h2>
              </div>
              <span className={styles.badge}>
                {result.decompilation.structured_method_count} /{" "}
                {result.decompilation.method_count} methods in FunC
                {!!result.decompilation.partial_method_count &&
                  ` · ${result.decompilation.partial_method_count} partial`}
              </span>
            </div>
            <p className={styles.notice}>
              {tab === "contract" &&
                result.display_contract &&
                "Partial preview: readable prefixes and unresolved TVM instructions. Download saves the complete FunC source with preserved bytecode. "}
              Static reconstruction. Compilation and behavioral equivalence have
              not been checked.
              {result.decompilation.structured_method_count <
                result.decompilation.method_count &&
                " Some methods are preserved as assembly."}
            </p>
            <div className={styles.toolbar}>
              <div
                role="tablist"
                aria-label="Source view"
                className={styles.tabs}
              >
                {(
                  [
                    [
                      "contract",
                      result.display_contract
                        ? "FunC + TVM preview"
                        : "Readable FunC",
                    ],
                    ["stdlib", "Helpers"],
                    ["json", "JSON"],
                  ] as [Tab, string][]
                ).map(([key, title]) => (
                  <button
                    key={key}
                    role="tab"
                    aria-selected={tab === key}
                    onClick={() => {
                      setTab(key);
                      setCopied(false);
                    }}
                  >
                    {title}
                  </button>
                ))}
              </div>
              <div className={styles.buttons}>
                <button onClick={copy}>{copied ? "Copied" : "Copy"}</button>
                <button onClick={download}>
                  {tab === "contract" && result.display_contract
                    ? "Download FunC ↓"
                    : "Download ↓"}
                </button>
              </div>
            </div>
            <pre className={styles.code} role="tabpanel" tabIndex={0}>
              <code>{source || "// No helper functions required."}</code>
            </pre>
            <div className={styles.hash}>
              Original code hash{" "}
              <code>{result.decompilation.original_code_hash}</code>
            </div>
          </section>
        )}
        <footer className={styles.footer}>
          <span>Static analysis · no TVM execution</span>
          <span>Local processing · no BOC upload</span>
        </footer>
      </main>
    </>
  );
}
