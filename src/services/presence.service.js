/**
 * Tracks which agents are currently viewing or typing in each conversation
 * to prevent duplicate / colliding replies across team members (isolated by workspace).
 */
export function createPresenceService({ ttlMs = 45_000 } = {}) {
  const byClient = new Map();

  function pruneStale() {
    const now = Date.now();
    let removed = false;
    for (const [clientId, entry] of byClient.entries()) {
      if (now - entry.updatedAt > ttlMs) {
        byClient.delete(clientId);
        removed = true;
      }
    }
    return removed;
  }

  return {
    setPresence({
      clientId,
      workspaceId = 'ws_default',
      agentId,
      agentName,
      avatarColor = '#2563eb',
      conversationId,
      isTyping = false,
    }) {
      if (!clientId) return this.getSnapshot(workspaceId);
      if (!conversationId) {
        byClient.delete(clientId);
      } else {
        byClient.set(clientId, {
          clientId,
          workspaceId,
          agentId,
          agentName,
          avatarColor,
          conversationId,
          isTyping: Boolean(isTyping),
          updatedAt: Date.now(),
        });
      }
      pruneStale();
      return this.getSnapshot(workspaceId);
    },

    removeClient(clientId) {
      if (!clientId) return false;
      return byClient.delete(clientId);
    },

    getSnapshot(workspaceId = null) {
      pruneStale();
      const byConversation = {};
      for (const entry of byClient.values()) {
        if (workspaceId && entry.workspaceId !== workspaceId) continue;
        if (!byConversation[entry.conversationId]) {
          byConversation[entry.conversationId] = [];
        }
        byConversation[entry.conversationId].push({
          clientId: entry.clientId,
          agentId: entry.agentId,
          agentName: entry.agentName,
          avatarColor: entry.avatarColor,
          isTyping: entry.isTyping,
        });
      }
      return byConversation;
    },
  };
}
