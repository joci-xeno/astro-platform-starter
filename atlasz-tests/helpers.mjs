import fs from "node:fs";
import os from "node:os";
import path from "node:path";
export const tmp = (p = "atlasz-test-") => fs.mkdtempSync(path.join(os.tmpdir(), p));
export const rm = d => fs.rmSync(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });   // Windows: handles may linger briefly (EBUSY/EPERM)
