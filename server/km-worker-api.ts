import type { Express, Request } from "express";
import { createHash, timingSafeEqual } from "node:crypto";
import type { State } from "../src/domain.ts";
import { Store } from "./store.ts";
import { claimKmJob, completeKmJob } from "./km-import.ts";
import { HttpError } from "./http-error.ts";
export function verifyKmWorker(
  headers: { get: (key: string) => string | null },
  s: State,
) {
  const supplied = headers.get("x-km-worker-token") ?? "",
    expected = s.kmWorker?.keyHash ?? "";
  const digest = createHash("sha256").update(supplied).digest("hex");
  if (
    !expected ||
    expected.length !== digest.length ||
    !timingSafeEqual(Buffer.from(expected), Buffer.from(digest))
  )
    throw new HttpError(
      403,
      "Importér km není připojen nebo jeho klíč už neplatí.",
    );
}
export function registerKmWorker(app: Express, store: Store) {
  app.post("/api/km-worker/:action", (req, res, next) => {
    try {
      const result = store.transaction(() => {
        const s = store.load();
        verifyKmWorker({ get: (key) => String(req.headers[key] ?? "") }, s);
        let r;
        if (req.params.action === "claim") r = { job: claimKmJob(s) };
        else if (req.params.action === "complete")
          r = completeKmJob(s, req.body);
        else throw new HttpError(404, "Neznámý požadavek importéru.");
        store.save(s);
        return r;
      });
      res.json(result);
    } catch (e) {
      next(e);
    }
  });
}
