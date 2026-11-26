/**
 * Lightweight Real-time Broadcast Hub using Server-Sent Events (SSE)
 * with strict multi-tenant workspace isolation.
 */
export function createSseHub() {
  const clients = new Set(); // { res, workspaceId }

  const heartbeatTimer = setInterval(() => {
    for (const client of clients) {
      try {
        client.res.write(`event: heartbeat\ndata: {"ts":${Date.now()}}\n\n`);
      } catch {
        clients.delete(client);
      }
    }
  }, 25_000);
  heartbeatTimer.unref?.();

  return {
    addClient(req, res, { workspaceId = 'ws_default', onDisconnect } = {}) {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      });
      const entry = { res, workspaceId };
      clients.add(entry);
      res.write(
        `event: connected\ndata: ${JSON.stringify({ status: 'connected', workspaceId, clients: clients.size })}\n\n`
      );

      req.on('close', () => {
        clients.delete(entry);
        if (typeof onDisconnect === 'function') {
          onDisconnect();
        }
      });
    },

    broadcast(eventName, data, { workspaceId = null } = {}) {
      const frame = `event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`;
      for (const client of clients) {
        if (workspaceId && client.workspaceId !== workspaceId) {
          continue;
        }
        try {
          client.res.write(frame);
        } catch {
          clients.delete(client);
        }
      }
    },

    closeAll() {
      clearInterval(heartbeatTimer);
      for (const client of clients) {
        try {
          client.res.end();
        } catch {
          // ignore
        }
      }
      clients.clear();
    },

    getClientCount(workspaceId = null) {
      if (!workspaceId) return clients.size;
      let count = 0;
      for (const client of clients) {
        if (client.workspaceId === workspaceId) count += 1;
      }
      return count;
    },
  };
}
