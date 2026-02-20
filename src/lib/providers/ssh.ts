import { Client as SSHClient, ClientChannel } from "ssh2";
import fs from "fs";
import { VPS_SSH_KEY_PATH, CLOUDFLARE_DOMAIN } from "../constants";
import {
  startCloudflaredProxy,
  type CloudflaredProxy,
} from "./cloudflared-proxy";

export interface SSHConfig {
  host: string;
  port?: number;
  username: string;
  privateKey?: string | Buffer;
}

let cachedKey: Buffer | null = null;
function getPrivateKey(): Buffer {
  if (cachedKey) return cachedKey;
  cachedKey = fs.readFileSync(VPS_SSH_KEY_PATH);
  return cachedKey;
}

/** Escape a script so it can be passed as: sudo bash -c '<escaped>' */
export function escapeForBash(script: string): string {
  return "'" + script.replace(/'/g, "'\"'\"'") + "'";
}

export function connectSSH(config: SSHConfig): Promise<SSHClient> {
  return new Promise((resolve, reject) => {
    const conn = new SSHClient();
    const timeout = setTimeout(() => {
      conn.end();
      reject(new Error(`SSH connect timeout to ${config.host}`));
    }, 30_000);

    conn
      .on("ready", () => {
        clearTimeout(timeout);
        resolve(conn);
      })
      .on("error", (err) => {
        clearTimeout(timeout);
        reject(err);
      })
      .connect({
        host: config.host,
        port: config.port ?? 22,
        username: config.username,
        privateKey: config.privateKey ?? getPrivateKey(),
        readyTimeout: 30_000,
      });
  });
}

/**
 * Execute a command over SSH. Uses ssh2's exec method which runs a single
 * command on the remote host — there is no shell injection risk since
 * the command string is sent as-is to the SSH server (not passed through
 * a local shell).
 */
export function execSSH(
  conn: SSHClient,
  command: string,
  timeoutMs = 60_000,
): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`SSH command timeout after ${timeoutMs}ms`));
    }, timeoutMs);

    conn.exec(command, (err, stream) => {
      if (err) {
        clearTimeout(timer);
        reject(err);
        return;
      }

      let stdout = "";
      let stderr = "";

      stream.on("data", (data: Buffer) => {
        stdout += data.toString();
      });
      stream.stderr.on("data", (data: Buffer) => {
        stderr += data.toString();
      });
      stream.on("close", (code: number) => {
        clearTimeout(timer);
        resolve({ stdout, stderr, code: code ?? 0 });
      });
    });
  });
}

export function shellSSH(conn: SSHClient): Promise<ClientChannel> {
  return new Promise((resolve, reject) => {
    conn.shell(
      { term: "xterm-256color", cols: 80, rows: 24 },
      (err, stream) => {
        if (err) {
          reject(err);
          return;
        }
        resolve(stream);
      },
    );
  });
}

export async function connectWithRetry(
  config: SSHConfig,
  retries = 3,
): Promise<SSHClient> {
  let lastErr: Error | undefined;
  for (let i = 0; i < retries; i++) {
    try {
      return await connectSSH(config);
    } catch (err) {
      lastErr = err as Error;
      if (i < retries - 1) {
        const delay = 5_000 * Math.pow(2, i);
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }
  throw lastErr;
}

export interface TunnelSSHConnection {
  conn: SSHClient;
  proxy: CloudflaredProxy;
  close(): void;
}

export async function connectSSHThroughTunnel(
  slug: string,
  username: string,
  retries = 3,
): Promise<TunnelSSHConnection> {
  const sshHostname = `ssh-${slug}.${CLOUDFLARE_DOMAIN}`;
  let lastErr: Error | undefined;

  for (let i = 0; i < retries; i++) {
    let proxy: CloudflaredProxy | undefined;
    try {
      proxy = await startCloudflaredProxy(sshHostname);
      const conn = await connectSSH({
        host: "127.0.0.1",
        port: proxy.localPort,
        username,
      });
      return {
        conn,
        proxy,
        close() {
          conn.end();
          proxy!.kill();
        },
      };
    } catch (err) {
      proxy?.kill();
      lastErr = err as Error;
      if (i < retries - 1) {
        const delay = 5_000 * Math.pow(2, i);
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }
  throw lastErr;
}
