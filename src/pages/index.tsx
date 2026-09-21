import Head from "next/head";
import { useEffect, useRef, useState } from "react";
import styles from "@/styles/Home.module.css";

type View = {
  func: string;
  contract: string;
  stdlib: string;
  decompilation: {
    structured_method_count: number;
    method_count: number;
    exact_hash_match: boolean;
    recompiles: boolean;
    original_code_hash: string;
    unsupported_instructions: string[];
  };
};
type Result = View & {
  success: boolean;
  readable?: View;
  diagnostics?: string[];
  error?: { message: string };
};
type Tab = "contract" | "stdlib" | "exact" | "json";

export default function Home() {
  const [code, setCode] = useState("");
  const [verify, setVerify] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const [tab, setTab] = useState<Tab>("contract");
  const [copied, setCopied] = useState(false);
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);
  const view = result?.readable ?? result;
  const shown = tab === "exact" ? result : view;
  const source =
    result && view
      ? tab === "json"
        ? JSON.stringify(result, null, 2)
        : tab === "exact"
          ? result.func
          : view[tab]
      : "";

  async function decompile() {
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    setError("");
    setResult(null);
    setCopied(false);
    const timeout = setTimeout(() => controller.abort("timeout"), 40000);
    try {
      const response = await fetch("/api/decompile", {
        method: "POST",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: code.trim(), verify }),
        signal: controller.signal,
      });
      const text = await response.text();
      let data: Result;
      try {
        data = JSON.parse(text);
      } catch {
        throw new Error(
          response.status === 413
            ? "BOC is too large. Maximum size: 1 MiB."
            : `Server error (${response.status}).`,
        );
      }
      if (!response.ok || !data.success)
        throw new Error(
          data.error?.message ?? "Could not reconstruct the contract.",
        );
      setResult(data);
      setTab("contract");
    } catch (e) {
      setError(
        controller.signal.aborted
          ? controller.signal.reason === "timeout"
            ? "Request timed out. Try disabling compilation verification."
            : "Decompilation cancelled."
          : e instanceof Error
            ? e.message
            : "Request failed.",
      );
    } finally {
      clearTimeout(timeout);
      request.current = null;
      setBusy(false);
    }
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
    const content = tab === "contract" ? (view?.func ?? source) : source;
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
            Paste a contract code BOC to reconstruct functions, control flow, and
            data operations in readable FunC.
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
            <label className={styles.check}>
              <input
                type="checkbox"
                checked={verify}
                disabled={busy}
                onChange={(e) => setVerify(e.target.checked)}
              />
              <span>
                Verify by recompiling
                <small>Disable for static reconstruction only</small>
              </span>
            </label>
            <div className={styles.buttons}>
              {busy && (
                <button onClick={() => request.current?.abort()}>Cancel</button>
              )}
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
            Analyzing instructions and reconstructing FunC. Verification may take
            up to 30 seconds.
          </p>
        )}
        {result && view && (
          <section
            className={styles.result}
            aria-label="Decompilation result"
          >
            <div className={styles.resultHead}>
              <div>
                <div className={styles.eyebrow}>RESULT</div>
                <h2>Reconstructed contract</h2>
              </div>
              <span className={styles.badge}>
                {shown!.decompilation.structured_method_count} /{" "}
                {shown!.decompilation.method_count} methods in FunC
              </span>
            </div>
            <p className={styles.notice}>
              {shown!.decompilation.exact_hash_match
                ? "Recompiled successfully. The code hash matches the original."
                : shown!.decompilation.recompiles
                  ? "The source compiles, but the code hash differs. Behavioral equivalence has not been established."
                  : "Static reconstruction. Compilation and behavioral equivalence have not been checked."}
              {shown!.decompilation.structured_method_count <
                shown!.decompilation.method_count &&
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
                    ["contract", "Readable FunC"],
                    ["stdlib", "Helpers"],
                    ...(result.decompilation.exact_hash_match
                      ? [["exact", "Exact source"]]
                      : []),
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
                <button onClick={copy}>
                  {copied ? "Copied" : "Copy"}
                </button>
                <button onClick={download}>Download ↓</button>
              </div>
            </div>
            <pre className={styles.code} role="tabpanel" tabIndex={0}>
              <code>
                {source || "// No helper functions required."}
              </code>
            </pre>
            <div className={styles.hash}>
              Original code hash{" "}
              <code>{shown!.decompilation.original_code_hash}</code>
            </div>
          </section>
        )}
        <footer className={styles.footer}>
          <span>Static analysis · no TVM execution</span>
          <span>
            API <code>POST /api/decompile</code>
          </span>
        </footer>
      </main>
    </>
  );
}
