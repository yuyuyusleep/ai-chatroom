// Cloudflare Worker - AI Chatroom 中转
// 部署到 Cloudflare Workers 后，把 index.html 里的 /api/chat 改成这个 Worker 的 URL

const DEEPSEEK_API_KEY = 'sk-8f5ba8d190a148fea59e34e9aff010a7';

const OPENCLAW_BASE = 'https://wmkoqvc4bq-app_4juv8k69pmm6b-1861268274721987.aiforce.run';
const OPENCLAW_TOKEN = 'chatroom-openclaw-2026';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export default {
  async fetch(request, env) {
    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    if (request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405, headers: CORS_HEADERS });
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
        status: 400, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
      });
    }

    const { messages, botName } = body;

    // ── OpenClaw → 飞书云端净虾说 ──────────────────
    if (botName === 'OpenClaw') {
      try {
        const res = await fetch(`${OPENCLAW_BASE}/v1/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${OPENCLAW_TOKEN}`,
          },
          body: JSON.stringify({
            model: 'openclaw',
            messages,
            max_tokens: 400,
            temperature: 0.8,
          }),
        });
        if (!res.ok) {
          const err = await res.text();
          return new Response(JSON.stringify({ error: `OpenClaw ${res.status}: ${err.substring(0, 200)}` }), {
            status: 200, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
          });
        }
        const data = await res.json();
        const reply = data.choices?.[0]?.message?.content?.trim() || '（OpenClaw 暂时无法回复）';
        return new Response(JSON.stringify({ reply }), {
          status: 200, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
        });
      } catch (e) {
        return new Response(JSON.stringify({ error: `OpenClaw 连接失败: ${e.message}` }), {
          status: 200, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
        });
      }
    }

    // ── CatDesk → DeepSeek ─────────────────────────
    try {
      const res = await fetch('https://api.deepseek.com/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${DEEPSEEK_API_KEY}`,
        },
        body: JSON.stringify({
          model: 'deepseek-chat',
          messages,
          max_tokens: 400,
          temperature: 0.7,
        }),
      });
      if (!res.ok) {
        const err = await res.text();
        return new Response(JSON.stringify({ error: `DeepSeek ${res.status}: ${err.substring(0, 200)}` }), {
          status: 200, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
        });
      }
      const data = await res.json();
      const reply = data.choices?.[0]?.message?.content?.trim() || '（CatDesk 暂时无法回复）';
      return new Response(JSON.stringify({ reply }), {
        status: 200, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
      });
    } catch (e) {
      return new Response(JSON.stringify({ error: `DeepSeek 连接失败: ${e.message}` }), {
        status: 200, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
      });
    }
  }
};
