import express from "express";
import http from "node:http";
import { Server as SocketIOServer } from "socket.io";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { readFileSync } from "node:fs";
import "./db.js";
import { SUBPATH } from "./constants.js";
import { registerAuthRoutes, authSocketMiddleware } from "./auth.js";
import { registerAdminRoutes } from "./admin.js";
import { registerRoomHandlers } from "./rooms.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const CLIENT_DIR = join(__dirname, "..", "client");
const PORT = Number(process.env.PORT) || 8088;

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", "loopback, linklocal, uniquelocal");
app.use(express.json({ limit: "32kb" }));

app.get("/healthz", (_req, res) => res.json({ ok: true }));

registerAuthRoutes(app);
registerAdminRoutes(app);

const indexHtml = readFileSync(join(CLIENT_DIR, "index.html"), "utf8").replace(
  /\{\{BASE\}\}/g,
  SUBPATH,
);
app.get("/", (_req, res) => res.type("html").send(indexHtml));
app.use(express.static(CLIENT_DIR, { index: false, extensions: ["html"] }));
app.get(/.*/, (_req, res) => res.type("html").send(indexHtml));

const server = http.createServer(app);
const io = new SocketIOServer(server, {
  serveClient: false,
  cors: { origin: false },
  pingInterval: 20_000,
  pingTimeout: 30_000,
});
io.use(authSocketMiddleware);
registerRoomHandlers(io);

server.listen(PORT, "0.0.0.0", () => {
  console.log(`[wallshoot] listening on :${PORT} subpath="${SUBPATH}"`);
});
