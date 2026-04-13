import express from "express";
import type { Request, Response, NextFunction } from "express";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";
import { registerRoutes } from "./routes";
import * as fs from "fs";
import * as path from "path";
import { createProxyMiddleware } from "http-proxy-middleware";

const app = express();
const log = console.log;

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

function setupSecurity(app: express.Application) {
  app.use(helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
  }));

  const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Çok fazla deneme. Lütfen 15 dakika bekleyin." },
    skip: (req) => process.env.NODE_ENV === "development",
  });

  const readingLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 20,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Çok fazla istek. Lütfen bir dakika bekleyin." },
    skip: (req) => process.env.NODE_ENV === "development",
  });

  const emailLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 5,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Çok fazla e-posta isteği. Lütfen bir saat bekleyin." },
    skip: (req) => process.env.NODE_ENV === "development",
  });

  app.use("/api/auth/login", authLimiter);
  app.use("/api/auth/register", authLimiter);
  app.use("/api/auth/forgot-password", emailLimiter);
  app.use("/api/auth/resend", emailLimiter);
  app.use("/api/reading", readingLimiter);
}

function setupCors(app: express.Application) {
  app.use((req, res, next) => {
    const origins = new Set<string>();

    // Dev domain
    if (process.env.REPLIT_DEV_DOMAIN) {
      origins.add(`https://${process.env.REPLIT_DEV_DOMAIN}`);
    }

    // All Replit-managed domains (production deployment + any custom domain)
    if (process.env.REPLIT_DOMAINS) {
      process.env.REPLIT_DOMAINS.split(",").forEach((d) => {
        origins.add(`https://${d.trim()}`);
      });
    }

    // Explicit production URL (set in .replit [userenv.production])
    if (process.env.TENGRI_PROD_URL) {
      origins.add(process.env.TENGRI_PROD_URL.replace(/\/$/, ""));
    }

    const origin = req.header("origin");

    // Allow localhost origins for Expo web development (any port)
    const isLocalhost =
      origin?.startsWith("http://localhost:") ||
      origin?.startsWith("http://127.0.0.1:");

    // Allow any *.replit.app origin (covers production + preview deployments)
    const isReplitApp = origin?.endsWith(".replit.app");

    if (origin && (origins.has(origin) || isLocalhost || isReplitApp)) {
      res.header("Access-Control-Allow-Origin", origin);
      res.header(
        "Access-Control-Allow-Methods",
        "GET, POST, PUT, DELETE, OPTIONS",
      );
      res.header("Access-Control-Allow-Headers", "Content-Type");
      res.header("Access-Control-Allow-Credentials", "true");
    }

    if (req.method === "OPTIONS") {
      return res.sendStatus(200);
    }

    next();
  });
}

function setupBodyParsing(app: express.Application) {
  app.use(
    express.json({
      limit: "25mb",
      verify: (req, _res, buf) => {
        req.rawBody = buf;
      },
    }),
  );

  app.use(express.urlencoded({ extended: false, limit: "25mb" }));
}

function setupRequestLogging(app: express.Application) {
  app.use((req, res, next) => {
    const start = Date.now();
    const path = req.path;
    let capturedJsonResponse: Record<string, unknown> | undefined = undefined;

    const originalResJson = res.json;
    res.json = function (bodyJson, ...args) {
      capturedJsonResponse = bodyJson;
      return originalResJson.apply(res, [bodyJson, ...args]);
    };

    res.on("finish", () => {
      if (!path.startsWith("/api")) return;

      const duration = Date.now() - start;

      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      if (logLine.length > 80) {
        logLine = logLine.slice(0, 79) + "…";
      }

      log(logLine);
    });

    next();
  });
}

function getAppName(): string {
  try {
    const appJsonPath = path.resolve(process.cwd(), "app.json");
    const appJsonContent = fs.readFileSync(appJsonPath, "utf-8");
    const appJson = JSON.parse(appJsonContent);
    return appJson.expo?.name || "App Landing Page";
  } catch {
    return "Tengri Astroloji";
  }
}

function serveExpoManifest(platform: string, req: Request, res: Response) {
  const manifestPath = path.resolve(
    process.cwd(),
    "static-build",
    platform,
    "manifest.json",
  );

  if (!fs.existsSync(manifestPath)) {
    return res
      .status(404)
      .json({ error: `Manifest not found for platform: ${platform}` });
  }

  res.setHeader("expo-protocol-version", "1");
  res.setHeader("expo-sfv-version", "0");
  res.setHeader("content-type", "application/json");

  let manifest = fs.readFileSync(manifestPath, "utf-8");

  // Dynamically rewrite any baked-in domain (dev or otherwise) with the actual
  // request host. This ensures native Expo clients download assets from the
  // correct server (e.g. production astro-muse.replit.app), not the dev domain
  // that was embedded at bundle-build time.
  const forwardedProto = req.header("x-forwarded-proto");
  const forwardedHost = req.header("x-forwarded-host");
  const proto = forwardedProto || req.protocol || "https";
  const host = forwardedHost || req.get("host") || "";
  const currentBaseUrl = `${proto}://${host}`;

  // Replace any absolute URL whose host is a Replit or exp.host domain
  manifest = manifest.replace(
    /https?:\/\/[a-zA-Z0-9._-]+\.(replit\.(app|dev)|exp\.host)(:[0-9]+)?/g,
    currentBaseUrl,
  );

  res.send(manifest);
}

function serveLandingPage({
  req,
  res,
  landingPageTemplate,
  appName,
}: {
  req: Request;
  res: Response;
  landingPageTemplate: string;
  appName: string;
}) {
  const forwardedProto = req.header("x-forwarded-proto");
  const protocol = forwardedProto || req.protocol || "https";
  const forwardedHost = req.header("x-forwarded-host");
  const host = forwardedHost || req.get("host");
  const baseUrl = `${protocol}://${host}`;
  const expsUrl = `${host}`;

  log(`baseUrl`, baseUrl);
  log(`expsUrl`, expsUrl);

  const html = landingPageTemplate
    .replace(/BASE_URL_PLACEHOLDER/g, baseUrl)
    .replace(/EXPS_URL_PLACEHOLDER/g, expsUrl)
    .replace(/APP_NAME_PLACEHOLDER/g, appName);

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.status(200).send(html);
}

function configureExpoAndLanding(app: express.Application) {
  const templatePath = path.resolve(
    process.cwd(),
    "templates",
    "landing-page.html",
  );
  const landingPageTemplate = fs.readFileSync(templatePath, "utf-8");
  const appName = getAppName();

  log("Serving static Expo files with dynamic manifest routing");

  // In development, proxy non-API traffic to the Expo dev server (port 8081)
  // so that the Express backend (port 5000) can be the sole externally exposed port.
  if (process.env.NODE_ENV === "development") {
    const expoDevPort = 8081;
    const expoProxy = createProxyMiddleware({
      target: `http://127.0.0.1:${expoDevPort}`,
      changeOrigin: true,
      ws: true,
      on: {
        error: (err: Error, req: any, res: any) => {
          if (res && !res.headersSent) {
            res.status(502).send("Expo dev server unavailable");
          }
        },
      },
    });

    app.use((req: Request, res: Response, next: NextFunction) => {
      if (req.path.startsWith("/api")) return next();
      (expoProxy as any)(req, res, next);
    });

    log("Dev mode: proxying non-API requests to Expo dev server on port 8081");
    return;
  }

  // Serve native Expo manifest for native clients (Expo Go, custom builds)
  // that send the expo-platform header.
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (req.path.startsWith("/api")) return next();

    if (req.path === "/manifest" || req.path === "/") {
      const platform = req.header("expo-platform");
      if (platform && (platform === "ios" || platform === "android")) {
        return serveExpoManifest(platform, req, res);
      }
    }

    next();
  });

  // Serve native bundle assets (iOS/Android JS bundles and images)
  app.use("/assets", express.static(path.resolve(process.cwd(), "assets")));
  app.use(express.static(path.resolve(process.cwd(), "static-build")));

  // Serve the Expo web build (React Native Web) for ALL other visitors:
  // browsers, WebView-based apps (Median), etc.
  // This replaces the old Expo Go landing page.
  const webDistPath = path.resolve(process.cwd(), "dist");
  const webIndexPath = path.join(webDistPath, "index.html");
  if (fs.existsSync(webDistPath)) {
    app.use(express.static(webDistPath));
    // SPA fallback: all unmatched routes return index.html
    app.use((req: Request, res: Response, next: NextFunction) => {
      if (req.path.startsWith("/api")) return next();
      if (fs.existsSync(webIndexPath)) {
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        res.sendFile(webIndexPath);
      } else {
        next();
      }
    });
    log("Web app: serving Expo web bundle from dist/");
  } else {
    // Fallback: landing page if no web build exists
    app.use((req: Request, res: Response, next: NextFunction) => {
      if (req.path.startsWith("/api")) return next();
      if (req.path === "/") {
        return serveLandingPage({ req, res, landingPageTemplate, appName });
      }
      next();
    });
    log("Web app: no dist/ found, serving landing page");
  }

  log("Expo routing: Checking expo-platform header on / and /manifest");
}

function setupErrorHandler(app: express.Application) {
  app.use((err: unknown, _req: Request, res: Response, next: NextFunction) => {
    const error = err as {
      status?: number;
      statusCode?: number;
      message?: string;
    };

    const status = error.status || error.statusCode || 500;
    const message = error.message || "Internal Server Error";

    console.error("Internal Server Error:", err);

    if (res.headersSent) {
      return next(err);
    }

    return res.status(status).json({ message });
  });
}

(async () => {
  // Trust Replit's reverse proxy so express-rate-limit can read X-Forwarded-For
  // correctly in production. Without this, the rate limiter throws
  // ERR_ERL_UNEXPECTED_X_FORWARDED_FOR and crashes every auth request.
  app.set("trust proxy", 1);

  setupSecurity(app);
  setupCors(app);
  setupBodyParsing(app);
  setupRequestLogging(app);

  configureExpoAndLanding(app);

  const server = await registerRoutes(app);

  setupErrorHandler(app);

  const port = parseInt(process.env.PORT || "5000", 10);
  server.listen(
    {
      port,
      host: "0.0.0.0",
      reusePort: true,
    },
    () => {
      log(`express server serving on port ${port}`);
    },
  );
})();
