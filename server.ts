import { createServer, IncomingMessage } from "http";
import { parse } from "url";
import next from "next";
import { WebSocketServer, WebSocket } from "ws";
import { unsealData } from "iron-session";
import { PrismaClient } from "@prisma/client";
import { execShell, docker } from "./src/lib/docker";
import { createRemoteJWKSet, jwtVerify } from "jose";

const dev = process.env.NODE_ENV !== "production";
const hostname = process.env.HOSTNAME || "0.0.0.0";
const port = parseInt(process.env.PORT || "3000", 10);

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

const prisma = new PrismaClient();

const SESSION_PASSWORD =
  process.env.SESSION_SECRET ||
  "complex_password_at_least_32_characters_long_for_iron_session";
const SESSION_COOKIE = "fleet-session";

const TEAM_DOMAIN = process.env.CLOUDFLARE_TEAM_DOMAIN;
const AUD = process.env.CF_ACCESS_AUD;

const JWKS_URL = TEAM_DOMAIN
  ? new URL(`https://${TEAM_DOMAIN}.cloudflareaccess.com/cdn-cgi/access/certs`)
  : undefined;

const jwks = JWKS_URL ? createRemoteJWKSet(JWKS_URL) : undefined;

interface SessionData {
  isAdmin: boolean;
  email: string;
}

function parseCookies(header: string | undefined): Record<string, string> {
  const cookies: Record<string, string> = {};
  if (!header) return cookies;
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key) cookies[key] = rest.join("=");
  }
  return cookies;
}

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
      console.error("[shell] WebSocket upgrade rejected: path does not match shell pattern");
      socket.destroy();
      return;
    }

    const slug = match[1];
    console.log(`[shell] WebSocket upgrade request for tenant: ${slug}`);

    // Auth check: verify Cloudflare Access JWT
    let sessionEmail = "";
    if (!dev) {
      const cfJwt = req.headers["cf-access-jwt-assertion"];
      if (!cfJwt || typeof cfJwt !== "string") {
        console.error(`[shell] Auth failed for ${slug}: no CF Access JWT header`);
        socket.destroy();
        return;
      }

      if (!jwks || !AUD || !TEAM_DOMAIN) {
        console.error(`[shell] Auth failed for ${slug}: CF Access not configured`);
        socket.destroy();
        return;
      }

      try {
        const { payload } = await jwtVerify(cfJwt, jwks, {
          audience: AUD,
          issuer: `https://${TEAM_DOMAIN}.cloudflareaccess.com`,
        });

        const email = payload.email as string | undefined;
        if (!email || !email.endsWith("@revve.ai")) {
          console.error(`[shell] Auth failed for ${slug}: invalid email in JWT (${email})`);
          socket.destroy();
          return;
        }

        sessionEmail = email;
        console.log(`[shell] Auth via CF Access JWT for ${slug}: ${sessionEmail}`);
      } catch (err) {
        console.error(`[shell] Auth failed for ${slug}: JWT verification error:`, err);
        socket.destroy();
        return;
      }

      // Check tenant ownership (admin or email match)
      const tenant = await prisma.tenant.findUnique({ where: { slug } });
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
      const tenant = await prisma.tenant.findUnique({ where: { slug } });
      if (!tenant?.containerId) {
        console.error(`[shell] Container not found for tenant: ${slug}`);
        ws.send(JSON.stringify({ type: "error", message: "Container not found" }));
        ws.close();
        return;
      }

      // Verify container is running
      const containerInfo = await docker.getContainer(tenant.containerId).inspect();
      if (!containerInfo.State.Running) {
        console.error(`[shell] Container not running for tenant: ${slug} (state: ${containerInfo.State.Status})`);
        ws.send(JSON.stringify({ type: "error", message: "Container not running" }));
        ws.close();
        return;
      }

      console.log(`[shell] Starting exec shell for tenant: ${slug} (container: ${tenant.containerId})`);


      const { exec, stream } = await execShell(tenant.containerId);
      console.log(`[shell] Exec shell started successfully for tenant: ${slug}`);

      // Audit log
      prisma.auditLog
        .create({
          data: {
            tenantId: tenant.id,
            action: "shell_access",
            details: `Shell opened for ${slug}`,
          },
        })
        .catch(() => {});

      // Container output -> WebSocket
      stream.on("data", (chunk: Buffer) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "output", data: chunk.toString("utf-8") }));
        }
      });

      stream.on("end", () => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "exit" }));
          ws.close();
        }
      });

      // WebSocket input -> container
      ws.on("message", async (raw) => {
        try {
          const msg = JSON.parse(raw.toString());
          if (msg.type === "input" && typeof msg.data === "string") {
            stream.write(msg.data);
          } else if (msg.type === "resize" && msg.cols && msg.rows) {
            try {
              await exec.resize({ h: msg.rows, w: msg.cols });
            } catch {
              // resize may fail if exec already exited
            }
          }
        } catch {
          // ignore malformed messages
        }
      });

      ws.on("close", () => {
        if (!streamDestroyed) {
          streamDestroyed = true;
          stream.destroy();
        }
      });

      stream.on("error", () => {
        if (!streamDestroyed) {
          streamDestroyed = true;
          stream.destroy();
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
  });
});
