import type http from "node:http"

export const MAX_BODY_BYTES = 64 * 1024

export class BodyError extends Error {
  constructor(readonly status: number) {
    super("body")
  }
}

export const send = (res: http.ServerResponse, status: number, body?: unknown): void => {
  if (body === undefined) {
    res.writeHead(status).end()
    return
  }
  const text = JSON.stringify(body)
  res.writeHead(status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(text),
  })
  res.end(text)
}

export const readJsonBody = (req: http.IncomingMessage, res: http.ServerResponse): Promise<unknown> =>
  new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    let done = false
    const finish = (fn: () => void): void => {
      if (done) return
      done = true
      req.off("data", onData)
      fn()
    }
    const onData = (chunk: Buffer): void => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        finish(() => {
          req.pause()
          res.once("close", () => req.destroy())
          reject(new BodyError(413))
        })
        return
      }
      chunks.push(chunk)
    }
    req.on("data", onData)
    req.once("end", () =>
      finish(() => {
        try {
          const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}")
          if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
            reject(new BodyError(400))
          } else resolve(parsed)
        } catch {
          reject(new BodyError(400))
        }
      })
    )
    req.once("error", () => finish(() => reject(new BodyError(400))))
  })
