# TON Decompiler

Browser-based reconstruction of TON contract bytecode into readable FunC.

## Development

Requires Node.js 22+.

```sh
npm ci
npm run dev
```

## Production

```sh
npm run build
npm start
```

Next.js builds the application and browser worker together. No separate decompiler build or API is required.

## Structure

- `src/pages/index.tsx` — input, source preview, copying and downloads.
- `src/decompiler/` — static TypeScript reconstruction logic.
- `src/lib/decompiler.worker.ts` — browser worker and input validation.
- `src/styles/` — page styles.

Paste a base64 code-cell BOC (up to 1 MiB decoded). Processing stays in the browser;
results are cached in memory until the page is reloaded. Cancel, navigation,
errors, and the 30-second timeout terminate the worker.

Results are unverified static reconstructions. Unsupported methods retain assembly
or partial TVM pseudocode; the interface shows how many methods were recovered.
The contract download includes helper definitions and preserved bytecode.
No compiler, TVM execution, server processing, or persistent storage is used.
