/**
 * Shared analytics & multi-tenant helpers used identically by both SQLite and PostgreSQL repositories.
 */
export function resolveDashboardRange(range = '30d') {
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0));
  let start;

  if (range === 'today') {
    start = new Date(now);
    start.setHours(0, 0, 0, 0);
  } else if (range === '7d') {
    start = new Date(now.getTime() - 7 * 86_400_000);
  } else if (range === 'month') {
    start = monthStart;
  } else {
    range = '30d';
    start = new Date(now.getTime() - 30 * 86_400_000);
  }

  return {
    range,
    startIso: start.toISOString(),
    monthStartIso: monthStart.toISOString(),
  };
}

/**
 * Computes average customer->agent first response time (in minutes) overall and per agent.
 * Expects messages sorted by (conversation_id, created_at ASC).
 */
export function computeResponseMetrics(messages = []) {
  const lastUnansweredCustomerTs = new Map();
  let totalMin = 0;
  let totalPairs = 0;
  const agentTotals = new Map(); // agentId -> { sumMin, count }

  for (const m of messages) {
    const ts = Date.parse(m.created_at);
    if (!Number.isFinite(ts)) continue;

    if (m.sender_type === 'customer') {
      if (!lastUnansweredCustomerTs.has(m.conversation_id)) {
        lastUnansweredCustomerTs.set(m.conversation_id, ts);
      }
    } else if (m.sender_type === 'agent') {
      const custTs = lastUnansweredCustomerTs.get(m.conversation_id);
      if (custTs !== undefined && ts >= custTs) {
        const diffMin = (ts - custTs) / 60_000;
        // Cap extreme outliers (>24h) to keep averages realistic
        if (diffMin <= 1440) {
          totalMin += diffMin;
          totalPairs += 1;
          if (m.sender_agent_id) {
            const cur = agentTotals.get(m.sender_agent_id) || { sumMin: 0, count: 0 };
            cur.sumMin += diffMin;
            cur.count += 1;
            agentTotals.set(m.sender_agent_id, cur);
          }
        }
        lastUnansweredCustomerTs.delete(m.conversation_id);
      }
    }
  }

  const byAgent = new Map();
  for (const [agentId, stat] of agentTotals.entries()) {
    byAgent.set(agentId, Number((stat.sumMin / stat.count).toFixed(1)));
  }

  return {
    avgResponseMinutes: totalPairs > 0 ? Number((totalMin / totalPairs).toFixed(1)) : null,
    measuredReplies: totalPairs,
    byAgent,
  };
}

export function normalizeWorkspace(row) {
  if (!row) return null;
  const isActive = Boolean(row.is_active);
  const expiresAt = row.expires_at || null;
  const isExpired = Boolean(expiresAt && Date.parse(expiresAt) < Date.now());
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    plan_code: row.plan_code || 'starter',
    max_channels: Number(row.max_channels ?? 5),
    max_agents: Number(row.max_agents ?? 5),
    ai_enabled: Boolean(row.ai_enabled),
    is_active: isActive,
    is_expired: isExpired,
    expires_at: expiresAt,
    contact_notes: row.contact_notes || '',
    created_at: row.created_at,
  };
}

export function isWorkspaceAccessible(ws) {
  if (!ws) return false;
  if (!ws.is_active) return false;
  if (ws.expires_at && Date.parse(ws.expires_at) < Date.now()) return false;
  return true;
}

export const LINE_REPLY_FREE_QUOTA = 25_000;
