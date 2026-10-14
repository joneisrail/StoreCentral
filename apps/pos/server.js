const http = require("node:http")
const fs = require("node:fs")
const path = require("node:path")

const PORT = 8001
const ROOT = __dirname

const MIME = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
}

http
  .createServer((req, res) => {
    const reqPath = req.url === "/" ? "/index.html" : req.url
    const filePath = path.join(ROOT, path.normalize(reqPath).replace(/^(\.\.[/\\])+/, ""))

    fs.readFile(filePath, (err, data) => {
      if (err) {
        res.writeHead(404)
        res.end("Not found")
        return
      }
      const ext = path.extname(filePath)
      res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" })
      res.end(data)
    })
  })
  .listen(PORT, () => {
    console.log(`POS running at http://localhost:${PORT}`)
  })
