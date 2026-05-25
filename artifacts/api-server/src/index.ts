// Load .env file before anything else (no dotenv dependency needed)
import { readFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
{
  // Resolve relative to this file's directory (works in both dev and built/dist)
  const here = typeof __dirname !== "undefined"
    ? __dirname
    : dirname(fileURLToPath(import.meta.url));
  // Try: <file-dir>/../.env  (artifacts/api-server/.env) then cwd/.env
  const candidates = [
    resolve(here, "..", ".env"),
    resolve(process.cwd(), "artifacts/api-server/.env"),
    resolve(process.cwd(), ".env"),
  ];
  for (const p of candidates) {
    if (existsSync(p)) {
      for (const line of readFileSync(p, "utf8").split("\n")) {
        const eqIdx = line.indexOf("=");
        if (eqIdx <= 0 || line.startsWith("#")) continue;
        const key = line.slice(0, eqIdx).trim();
        const val = line.slice(eqIdx + 1).trim();
        if (key && !(key in process.env)) process.env[key] = val;
      }
      break;
    }
  }
}

import app from "./app";
import { logger } from "./lib/logger";
import { startScheduler } from "./scheduler/index";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
  startScheduler();
});
