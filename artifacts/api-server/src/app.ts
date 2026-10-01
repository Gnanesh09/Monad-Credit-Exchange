import express, { type Express, type NextFunction, type Request, type Response } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { HttpError } from "./lib/http";
import { logger } from "./lib/logger";

const app: Express = express();
// Requests arrive through Replit's proxy, which replaces any X-Forwarded-For the client sends
// (checked with a spoofed header), so the leftmost entry is the real client address. Trusting a
// fixed internal range instead could put every user in one bucket if a public hop is added.
app.set("trust proxy", true);

app.use(
  pinoHttp({
    logger,
    // Polling endpoints would flood the log; only record slow or failed requests.
    customLogLevel: (_req, res, err) => (err || res.statusCode >= 500 ? "error" : res.statusCode >= 400 ? "warn" : "silent"),
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors());
app.use(express.json({ limit: "32kb" }));
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);

app.use("/api", (_req: Request, res: Response) => {
  res.status(404).json({ error: "Not found." });
});

app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (error instanceof HttpError) {
    res.status(error.status).json({ error: error.message });
    return;
  }
  if (error instanceof SyntaxError && "body" in error) {
    res.status(400).json({ error: "The request body is not valid JSON." });
    return;
  }
  logger.error({ err: error }, "Unhandled request error");
  res.status(500).json({ error: "Something went wrong on our side." });
});

export default app;
