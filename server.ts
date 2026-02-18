import { createServer, IncomingMessage } from "http";
import { parse } from "url";
import next from "next";
import { WebSocketServer, WebSocket } from "ws";
import { createClient } from "@supabase/supabase-js";
import { docker } from "./src/lib/docker";
import { getProvider } from "./src/lib/providers";

const dev = process.env.NODE_ENV !== "production";
const hostname = process.env.HOSTNAME || "0.0.0.0";
const port = parseInt(process.env.PORT || "3000", 10);

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

const SHELL_PATH_RE = /^\/api\/tenants\/([a-z0-9-]+)\/shell$/;

app.prepare().then(() => {
  const server = createServer((req, res) => {
    const parsedUrl = parse(req.url || "/", true);
    handle(req, res, parsedUrl);
  });

  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", async (req, socket, head) => {
    const { pathname } = parse(req.url || "/", true);
    const match = pathname?.match(SHELL_PATH_RE);

    if (!match) {
      // Non-shell WebSocket (e.g. Next.js HMR) — pass through silently
      return;
    }

    const slug = match[1];
    console.log(`[shell] WebSocket upgrade request for tenant: ${slug}`);

    // Auth check: verify Supabase access token from query param or cookie
    let sessionEmail = "";
    if (!dev) {
      // Extract Supabase access token from query string
      const { query } = parse(req.url || "/", true);
      const token = (query.access_token as string) || "";

      if (!token) {
        console.error(`[shell] Auth failed for ${slug}: no access token`);
        socket.destroy();
        return;
      }

      const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);
      if (error || !user?.email) {
        console.error(`[shell] Auth failed for ${slug}: invalid token`);
        socket.destroy();
        return;
      }

      sessionEmail = user.email;
      console.log(`[shell] Auth via Supabase token for ${slug}: ${sessionEmail}`);

      // Check tenant ownership (admin or email match)
      const { data: tenant } = await supabaseAdmin
        .from("tenants")
        .select("email")
        .eq("slug", slug)
        .single();
      if (!tenant) {
        console.error(`[shell] Auth failed for ${slug}: tenant not found`);
        socket.destroy();
        return;
      }
      const adminEmails = (process.env.ADMIN_EMAILS || "").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
      const isAdmin = adminEmails.includes(sessionEmail.toLowerCase());
      if (!isAdmin && tenant.email !== sessionEmail) {
        console.error(`[shell] Auth failed for ${slug}: user ${sessionEmail} does not own tenant (owner: ${tenant.email})`);
        socket.destroy();
        return;
      }
      console.log(`[shell] Authorization successful for ${slug}: ${sessionEmail} (isAdmin=${isAdmin})`);
    } else {
      console.log(`[shell] Dev mode: skipping auth for ${slug}`);
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req, slug);
    });
  });

  wss.on("connection", async (ws: WebSocket, _req: IncomingMessage, slug: string) => {
    console.log(`[shell] WebSocket connected for tenant: ${slug}`);
    let streamDestroyed = false;

    // Keepalive: ping every 30s to prevent Cloudflare/proxy idle timeouts
    const pingInterval = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.ping();
      }
    }, 30_000);

    ws.on("close", () => {
      console.log(`[shell] WebSocket closed for tenant: ${slug}`);
      clearInterval(pingInterval);
    });
    ws.on("error", (err) => {
      console.error(`[shell] WebSocket error for tenant ${slug}:`, err);
      clearInterval(pingInterval);
    });

    try {
      const { data: tenant } = await supabaseAdmin
        .from("tenants")
        .select("*, vps_instances(*)")
        .eq("slug", slug)
        .single();
      if (!tenant) {
        console.error(`[shell] Tenant not found: ${slug}`);
        ws.send(JSON.stringify({ type: "error", message: "Tenant not found" }));
        ws.close();
        return;
      }

      // For Docker tenants, verify container is running
      if (tenant.provider === "docker") {
        if (!tenant.container_id) {
          console.error(`[shell] Container not found for tenant: ${slug}`);
          ws.send(JSON.stringify({ type: "error", message: "Container not found" }));
          ws.close();
          return;
        }
        const containerInfo = await docker.getContainer(tenant.container_id).inspect();
        if (!containerInfo.State.Running) {
          console.error(`[shell] Container not running for tenant: ${slug} (state: ${containerInfo.State.Status})`);
          ws.send(JSON.stringify({ type: "error", message: "Container not running" }));
          ws.close();
          return;
        }
      }

      // For VPS tenants, verify VM is accessible
      if (tenant.provider === "vps" && !tenant.vps_instances?.tunnel_id) {
        console.error(`[shell] VPS not ready for tenant: ${slug}`);
        ws.send(JSON.stringify({ type: "error", message: "VPS not ready" }));
        ws.close();
        return;
      }

      console.log(`[shell] Starting shell for tenant: ${slug} (provider: ${tenant.provider})`);

      const provider = await getProvider(tenant);
      const shell = await provider.execShell(tenant);
      console.log(`[shell] Shell started successfully for tenant: ${slug}`);

      // Audit log
      supabaseAdmin
        .from("audit_logs")
        .insert({
          tenant_id: tenant.id,
          action: "shell_access",
          details: { slug },
        })
        .then(() => {});

      // Shell output -> WebSocket
      shell.stream.on("data", (chunk: Buffer) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "output", data: chunk.toString("utf-8") }));
        }
      });

      shell.stream.on("end", () => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "exit" }));
          ws.close();
        }
      });

      // WebSocket input -> shell
      ws.on("message", async (raw) => {
        try {
          const msg = JSON.parse(raw.toString());
          if (msg.type === "input" && typeof msg.data === "string") {
            shell.stream.write(msg.data);
          } else if (msg.type === "resize" && msg.cols && msg.rows) {
            await shell.resize(msg.cols, msg.rows).catch(() => {});
          }
        } catch {
          // ignore malformed messages
        }
      });

      ws.on("close", () => {
        if (!streamDestroyed) {
          streamDestroyed = true;
          shell.destroy();
        }
      });

      shell.stream.on("error", () => {
        if (!streamDestroyed) {
          streamDestroyed = true;
          shell.destroy();
        }
        if (ws.readyState === WebSocket.OPEN) {
          ws.close();
        }
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Shell error";
      console.error(`[shell] Error for tenant ${slug}:`, err);
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "error", message }));
        ws.close();
      }
    }
  });

  server.listen(port, hostname, () => {
    console.log(`> Ready on http://${hostname}:${port}`);

    if (process.env.BACKUP_BUCKET) {
      import("./src/lib/backup").then(({ startBackupMonitor }) => {
        startBackupMonitor();
        console.log(`[backup] Monitor started (every ${process.env.BACKUP_INTERVAL_MIN || 15}m)`);
      }).catch((err) => {
        console.error("[backup] Failed to load backup module:", err);
      });
    }
  });
});
