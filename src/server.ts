import express, { type Request } from "express";
import multer from "multer";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import path from "path";
import { promises as fs } from "fs";
import crypto from "crypto";

const app = express();

const PORT = Number(process.env.PORT ?? 3001);
const DATA_ROOT = "/data";
const TMP_DIR = path.join(DATA_ROOT, "tmp");
const MEDIA_BASE_URL = (process.env.MEDIA_BASE_URL ?? "https://media.amodomio.com.br").replace(/\/+$/, "");
const UPLOAD_API_KEY = process.env.UPLOAD_API_KEY;
const VALID_SEGMENT = /^[a-zA-Z0-9_-]+$/;
const TRUST_PROXY_HOPS = Number(process.env.TRUST_PROXY_HOPS ?? 1);
const RATE_LIMIT_WINDOW_MS = Number(process.env.RATE_LIMIT_WINDOW_MS ?? 60_000);
const RATE_LIMIT_MAX = Number(process.env.RATE_LIMIT_MAX ?? 120);
const RATE_LIMIT_UPLOAD_MAX = Number(process.env.RATE_LIMIT_UPLOAD_MAX ?? 20);
const REQUEST_TIMEOUT_MS = Number(process.env.REQUEST_TIMEOUT_MS ?? 30_000);
const HEADERS_TIMEOUT_MS = Number(process.env.HEADERS_TIMEOUT_MS ?? 35_000);
const KEEP_ALIVE_TIMEOUT_MS = Number(process.env.KEEP_ALIVE_TIMEOUT_MS ?? 5_000);

type Kind = "image" | "video";

const EXT_BY_MIMETYPE: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "video/mp4": "mp4"
};

const LIMIT_BY_KIND: Record<Kind, number> = {
  image: 10 * 1024 * 1024,
  video: 20 * 1024 * 1024
};

function badRequest(res: express.Response, message: string): void {
  res.status(400).json({ ok: false, error: message });
}

function readKind(req: Request): Kind | null {
  const kind = req.query.kind;
  if (kind === "image" || kind === "video") {
    return kind;
  }
  return null;
}

function readSegment(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  if (!VALID_SEGMENT.test(value)) {
    return null;
  }
  return value;
}

function normalizePositiveInt(input: number, fallback: number): number {
  if (!Number.isFinite(input)) {
    return fallback;
  }
  const value = Math.trunc(input);
  return value > 0 ? value : fallback;
}

function getUploader(fileSizeLimit: number): multer.Multer {
  const storage = multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, TMP_DIR),
    filename: (_req, file, cb) => {
      const unique = `${Date.now()}-${crypto.randomUUID()}`;
      cb(null, `${unique}${path.extname(file.originalname).toLowerCase()}`);
    }
  });

  return multer({
    storage,
    limits: {
      fileSize: fileSizeLimit,
      files: 1
    }
  });
}

async function ensureBaseFolders(): Promise<void> {
  await fs.mkdir(TMP_DIR, { recursive: true });
  await fs.mkdir(path.join(DATA_ROOT, "images"), { recursive: true });
  await fs.mkdir(path.join(DATA_ROOT, "videos"), { recursive: true });
}

function apiKeyGuard(req: Request, res: express.Response, next: express.NextFunction): void {
  if (!UPLOAD_API_KEY) {
    res.status(500).json({ ok: false, error: "UPLOAD_API_KEY is not configured" });
    return;
  }
  if (req.header("x-api-key") !== UPLOAD_API_KEY) {
    res.status(401).json({ ok: false, error: "unauthorized" });
    return;
  }
  next();
}

app.disable("x-powered-by");
app.set("trust proxy", normalizePositiveInt(TRUST_PROXY_HOPS, 1));

app.use(helmet());

const globalLimiter = rateLimit({
  windowMs: normalizePositiveInt(RATE_LIMIT_WINDOW_MS, 60_000),
  max: normalizePositiveInt(RATE_LIMIT_MAX, 120),
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, error: "too many requests" }
});

const uploadLimiter = rateLimit({
  windowMs: normalizePositiveInt(RATE_LIMIT_WINDOW_MS, 60_000),
  max: normalizePositiveInt(RATE_LIMIT_UPLOAD_MAX, 20),
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, error: "too many upload requests" }
});

app.use(globalLimiter);

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.post("/upload", uploadLimiter, apiKeyGuard, async (req, res) => {
  const kind = readKind(req);
  if (!kind) {
    badRequest(res, "kind must be image or video");
    return;
  }

  const menuItemId = readSegment(req.query.menuItemId);
  if (!menuItemId) {
    badRequest(res, "menuItemId is invalid");
    return;
  }

  const slot = readSegment(req.query.slot);
  if (!slot) {
    badRequest(res, "slot is invalid");
    return;
  }

  const upload = getUploader(LIMIT_BY_KIND[kind]).single("file");

  upload(req, res, async (err: unknown) => {
    try {
      if (err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE") {
        res.status(413).json({ ok: false, error: "file too large" });
        return;
      }
      if (err) {
        res.status(400).json({ ok: false, error: "invalid multipart payload" });
        return;
      }

      const uploaded = req.file;
      if (!uploaded) {
        badRequest(res, "file is required");
        return;
      }

      const ext = EXT_BY_MIMETYPE[uploaded.mimetype];
      if (!ext) {
        await fs.unlink(uploaded.path).catch(() => undefined);
        res.status(415).json({ ok: false, error: "unsupported media type" });
        return;
      }

      const isImage = uploaded.mimetype.startsWith("image/");
      const isVideo = uploaded.mimetype === "video/mp4";
      if ((kind === "image" && !isImage) || (kind === "video" && !isVideo)) {
        await fs.unlink(uploaded.path).catch(() => undefined);
        res.status(415).json({ ok: false, error: "unsupported media type for kind" });
        return;
      }

      const parentDir = path.join(DATA_ROOT, kind === "image" ? "images" : "videos", "menu-items", menuItemId);
      await fs.mkdir(parentDir, { recursive: true });

      const finalFilename = `${slot}.${ext}`;
      const finalPath = path.join(parentDir, finalFilename);
      await fs.rename(uploaded.path, finalPath);

      const publicPrefix = kind === "image" ? "images" : "videos";
      const urlPath = `/${publicPrefix}/menu-items/${menuItemId}/${finalFilename}`;

      res.json({
        ok: true,
        kind,
        menuItemId,
        slot,
        url: `${MEDIA_BASE_URL}${urlPath}`
      });
    } catch (uploadError) {
      const uploaded = req.file;
      if (uploaded?.path) {
        await fs.unlink(uploaded.path).catch(() => undefined);
      }
      res.status(500).json({ ok: false, error: "internal upload error" });
      console.error("Upload error", uploadError);
    }
  });
});

async function main(): Promise<void> {
  if (!UPLOAD_API_KEY) {
    throw new Error("UPLOAD_API_KEY is required");
  }

  await ensureBaseFolders();

  const server = app.listen(PORT, () => {
    console.log(`Media uploader running on port ${PORT}`);
  });

  server.requestTimeout = normalizePositiveInt(REQUEST_TIMEOUT_MS, 30_000);
  server.headersTimeout = normalizePositiveInt(HEADERS_TIMEOUT_MS, 35_000);
  server.keepAliveTimeout = normalizePositiveInt(KEEP_ALIVE_TIMEOUT_MS, 5_000);
}

main().catch((error: unknown) => {
  console.error("Failed to start server", error);
  process.exit(1);
});
