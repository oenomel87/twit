import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { DatabaseSync } from 'node:sqlite'
import { getThreadForUi, listThreads } from '../core/queries.js'
import { PAGE_HTML } from './page.js'

export interface UiServer {
  url: string
  port: number
  close(): Promise<void>
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
  })
  res.end(payload)
}

function handle(db: DatabaseSync, req: IncomingMessage, res: ServerResponse): void {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1')
  const method = req.method ?? 'GET'
  const api = url.pathname === '/api/threads' || url.pathname.startsWith('/api/threads/')

  if (api && method !== 'GET') {
    sendJson(res, 405, { error: 'METHOD_NOT_ALLOWED' })
    return
  }

  if (method === 'GET' && url.pathname === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    res.end(PAGE_HTML)
    return
  }

  if (method === 'GET' && url.pathname === '/api/threads') {
    sendJson(res, 200, { threads: listThreads(db) })
    return
  }

  const match = url.pathname.match(/^\/api\/threads\/([^/]+)$/)
  if (method === 'GET' && match?.[1]) {
    const thread = getThreadForUi(db, decodeURIComponent(match[1]))
    if (!thread) {
      sendJson(res, 404, { error: 'NOT_FOUND' })
      return
    }
    sendJson(res, 200, thread)
    return
  }

  sendJson(res, 404, { error: 'NOT_FOUND' })
}

export function startUiServer(db: DatabaseSync): Promise<UiServer> {
  const server = createServer((req, res) => {
    try {
      handle(db, req, res)
    } catch (err) {
      if (res.headersSent) return
      if (err instanceof URIError) {
        sendJson(res, 404, { error: 'NOT_FOUND' })
        return
      }
      sendJson(res, 500, { error: 'INTERNAL' })
    }
  })
  return new Promise((resolve, reject) => {
    const onError = (err: Error) => {
      server.off('error', onError)
      reject(err)
    }
    server.once('error', onError)
    server.listen(0, '127.0.0.1', () => {
      server.off('error', onError)
      const addr = server.address()
      if (!addr || typeof addr === 'string') {
        server.close()
        reject(new Error('UI 서버 주소를 확인하지 못했습니다'))
        return
      }
      resolve({
        url: `http://127.0.0.1:${addr.port}`,
        port: addr.port,
        close: () =>
          new Promise((done, fail) => {
            server.close((err) => (err ? fail(err) : done()))
          }),
      })
    })
  })
}
