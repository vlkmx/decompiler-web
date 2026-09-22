import { Buffer } from "buffer";

// Initialize before importing TON modules: some allocate buffers at module load.
Object.assign(globalThis, { Buffer });
