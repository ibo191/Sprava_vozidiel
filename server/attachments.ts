import { z } from "zod";
import { Buffer } from "node:buffer";
import { HttpError } from "./http-error.ts";
export function parseAttachment(input: unknown) {
  const b = z
    .object({
      name: z.string().min(1).max(200),
      mime: z.enum(["image/jpeg", "image/png", "application/pdf"]),
      data: z.string().max(7000000),
    })
    .parse(input);
  const bytes = Buffer.from(b.data, "base64");
  if (!bytes.length || bytes.length > 5 * 1024 * 1024)
    throw new HttpError(400, "Příloha smí mít nejvýše 5 MB.");
  if (
    !(
      (b.mime === "application/pdf" &&
        bytes.subarray(0, 5).toString() === "%PDF-") ||
      (b.mime === "image/png" &&
        bytes.subarray(0, 8).toString("hex") === "89504e470d0a1a0a") ||
      (b.mime === "image/jpeg" && bytes[0] === 255 && bytes[1] === 216)
    )
  )
    throw new HttpError(400, "Obsah přílohy neodpovídá typu.");
  return b;
}
