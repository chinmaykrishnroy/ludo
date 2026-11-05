import type { Request, Response } from "express";

export function sendAudio(
  req: Request,
  res: Response,
  bytes: Buffer,
  mime: string,
) {
  res.set({
    "Content-Type": mime,
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
    "Accept-Ranges": "bytes",
  });
  const range = req.headers.range;
  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    const start = match?.[1]
      ? Number(match[1])
      : Math.max(0, bytes.length - Number(match?.[2]));
    const end =
      match?.[1] && match[2]
        ? Math.min(bytes.length - 1, Number(match[2]))
        : bytes.length - 1;
    if (
      !match ||
      (!match[1] && !match[2]) ||
      !Number.isSafeInteger(start) ||
      !Number.isSafeInteger(end) ||
      start < 0 ||
      start >= bytes.length ||
      end < start
    ) {
      res.status(416).set("Content-Range", `bytes */${bytes.length}`).end();
      return;
    }
    res
      .status(206)
      .set("Content-Range", `bytes ${start}-${end}/${bytes.length}`)
      .send(bytes.subarray(start, end + 1));
    return;
  }
  res.send(bytes);
}
