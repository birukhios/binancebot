import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const filePath = resolve(process.env.LOCAL_BINANCE_CREDS_PATH ?? "./data/binance-creds.json");

type LocalCredsFile = Record<
  string,
  {
    api_key?: string;
    api_secret?: string;
    testnet_api_key?: string;
    testnet_api_secret?: string;
    updated_at?: string;
  }
>;

function readStore(): LocalCredsFile {
  if (!existsSync(filePath)) return {};
  try {
    return JSON.parse(readFileSync(filePath, "utf8")) as LocalCredsFile;
  } catch {
    return {};
  }
}

function writeStore(store: LocalCredsFile) {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(store, null, 2)}\n`, { mode: 0o600 });
}

export function localBinanceCredsForUser(userId: string) {
  return readStore()[userId] ?? null;
}

export function saveLocalBinanceCreds(
  userId: string,
  patch: {
    api_key?: string;
    api_secret?: string;
    testnet_api_key?: string;
    testnet_api_secret?: string;
  },
) {
  const store = readStore();
  store[userId] = {
    ...(store[userId] ?? {}),
    ...patch,
    updated_at: new Date().toISOString(),
  };
  writeStore(store);
}
