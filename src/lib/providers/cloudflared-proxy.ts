import { spawn, ChildProcess } from "child_process";
import net from "net";

export interface CloudflaredProxy {
  localPort: number;
  process: ChildProcess;
  kill(): void;
}

async function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      if (!addr || typeof addr === "string") {
        srv.close(() => reject(new Error("Failed to get free port")));
        return;
      }
      const port = addr.port;
      srv.close(() => resolve(port));
    });
    srv.on("error", reject);
  });
}

async function waitForPort(port: number, timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await new Promise<void>((resolve, reject) => {
        const sock = net.connect(port, "127.0.0.1", () => {
          sock.destroy();
          resolve();
        });
        sock.on("error", (err) => {
          sock.destroy();
          reject(err);
        });
        sock.setTimeout(2000, () => {
          sock.destroy();
          reject(new Error("timeout"));
        });
      });
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  throw new Error(
    `cloudflared proxy did not become ready within ${timeoutMs}ms`,
  );
}

export async function startCloudflaredProxy(
  sshHostname: string,
): Promise<CloudflaredProxy> {
  const localPort = await getFreePort();

  const proc = spawn(
    "cloudflared",
    ["access", "tcp", "--hostname", sshHostname, "--url", `127.0.0.1:${localPort}`],
    { stdio: ["ignore", "pipe", "pipe"], detached: false },
  );

  proc.stderr?.on("data", (chunk: Buffer) => {
    console.log(`[cloudflared-proxy] ${chunk.toString().trim()}`);
  });

  let exited = false;
  proc.on("exit", (code) => {
    exited = true;
    if (code !== 0 && code !== null) {
      console.warn(`[cloudflared-proxy] exited with code ${code}`);
    }
  });

  try {
    await waitForPort(localPort, 15_000);
  } catch (err) {
    proc.kill("SIGTERM");
    throw new Error(`cloudflared proxy failed to start for ${sshHostname}: ${err}`);
  }

  return {
    localPort,
    process: proc,
    kill() {
      if (!exited) {
        proc.kill("SIGTERM");
      }
    },
  };
}
