/**
 * Lightweight Real-time Broadcast Hub using Server-Sent Events (SSE).
 * In multi-instance production, bridge broadcast() with Redis Pub/Sub.
 */
export function createSseHub() {
  const clients = new Set();

  const heartbeatTimer = setInterval(() => {
    for (const res of clients) {
      res.write(`event: heartbeat\ndata: {"ts":${Date.now()}}\n\n`);
    }
  }, 25_000);
  heartbeatTimer.unref?.();

  return {
    addClient(req, res, { onDisconnect } = {}) {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      });
      res.write(`event: connected\ndata: ${JSON.stringify({ status: 'connected', clients: clients.size + 1 })}\n\n`);
      clients.add(res);

      req.on('close', () => {
        clients.delete(res);
        if (typeof onDisconnect === 'function') {
          onDisconnect();
        }
      });
    },

    broadcast(eventName, data) {
      const frame = `event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`;
      for (const res of clients) {
        try {
          res.write(frame);
        } catch {
          clients.delete(res);
        }
      }
    },

    closeAll() {
      clearInterval(heartbeatTimer);
      for (const res of clients) {
        res.end();
      }
      clients.clear();
    },

    getClientCount() {
      return clients.size;
    },
  };
}
