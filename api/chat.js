// Vercel Serverless Function - /api/chat
// CatDesk 用 DeepSeek，OpenClaw 用飞书净虾说消息中转
// 待 OpenClaw 恢复后可切换为 HTTP API 直调

const FEISHU_APP_ID = 'cli_a947681bdf615bb6';
const FEISHU_APP_SECRET = process.env.FEISHU_APP_SECRET || 'w653qutyxcTu55ZOxUBJ3fuVFAM2qtgl';
// 净虾说的飞书 open_id（机器人给这个用户发消息，净虾说会回复）
const JINGXIASUO_OPEN_ID = 'ou_e63dc60b894fbe7e6172bcd146f082c8';
// 聊天室所在的飞书群，用于轮询净虾说的回复
const FEISHU_CHAT_ID = 'oc_b6e9d59177fdfdc618b7bd2c86da9d99';

// ── 飞书 tenant_access_token ──────────────────────────────────────────────────
async function getFeishuToken() {
  const resp = await fetch('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ app_id: FEISHU_APP_ID, app_secret: FEISHU_APP_SECRET }),
  });
  const data = await resp.json();
  if (!data.tenant_access_token) throw new Error('获取飞书 token 失败: ' + JSON.stringify(data));
  return data.tenant_access_token;
}

// ── 发消息给净虾说 ─────────────────────────────────────────────────────────────
async function sendToJingXiaSuo(token, text) {
  const resp = await fetch('https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=open_id', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
    body: JSON.stringify({
      receive_id: JINGXIASUO_OPEN_ID,
      msg_type: 'text',
      content: JSON.stringify({ text }),
    }),
  });
  const data = await resp.json();
  if (data.code !== 0) throw new Error('发送飞书消息失败: ' + JSON.stringify(data));
  return data.data?.message_id;
}

// ── 获取群里最新的 app 消息 id ─────────────────────────────────────────────────
async function getLatestAppMsgId(token) {
  const resp = await fetch(
    `https://open.feishu.cn/open-apis/im/v1/messages?container_id_type=chat&container_id=${FEISHU_CHAT_ID}&sort_type=ByCreateTimeDesc&page_size=5`,
    { headers: { 'Authorization': `Bearer ${token}` } }
  );
  const data = await resp.json();
  const items = data.data?.items || [];
  return items.find(i => i.sender?.sender_type === 'app')?.message_id || null;
}

// ── 轮询等待净虾说回复 ─────────────────────────────────────────────────────────
async function pollForReply(token, beforeMsgId, maxWaitMs = 20000) {
  const deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 1500));
    const resp = await fetch(
      `https://open.feishu.cn/open-apis/im/v1/messages?container_id_type=chat&container_id=${FEISHU_CHAT_ID}&sort_type=ByCreateTimeDesc&page_size=8`,
      { headers: { 'Authorization': `Bearer ${token}` } }
    );
    const data = await resp.json();
    const items = data.data?.items || [];
    for (const item of items) {
      // 只取 app 类型的新消息（排除我们发出去的那条）
      if (item.sender?.sender_type === 'app' && item.message_id !== beforeMsgId) {
        try {
          const body = JSON.parse(item.body?.content || '{}');
          if (body.text) return body.text;
          if (body.content) {
            return body.content.flat().filter(n => n.tag === 'text').map(n => n.text).join('');
          }
        } catch {
          return item.body?.content || '（回复解析失败）';
        }
      }
    }
  }
  return '（净虾说没有及时回复，请稍后再试）';
}

// ── 主 handler ────────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { messages, botName } = req.body;

  // ── OpenClaw → 飞书净虾说 ──────────────────────────────────────────────────
  if (botName === 'OpenClaw') {
    try {
      const token = await getFeishuToken();
      const lastUserMsg = [...messages].reverse().find(m => m.role === 'user');
      const text = lastUserMsg?.content || '你好';

      // 记录发送前最新的 app 消息 id，用于区分新回复
      const beforeMsgId = await getLatestAppMsgId(token);

      // 发消息给净虾说
      await sendToJingXiaSuo(token, text);

      // 轮询等待回复
      const reply = await pollForReply(token, beforeMsgId);
      return res.status(200).json({ reply });
    } catch (e) {
      console.error('Feishu error:', e);
      return res.status(500).json({ error: e.message });
    }
  }

  // ── CatDesk → DeepSeek ────────────────────────────────────────────────────
  const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;
  if (!DEEPSEEK_API_KEY) return res.status(500).json({ error: 'DEEPSEEK_API_KEY not configured' });

  try {
    const response = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${DEEPSEEK_API_KEY}` },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages,
        max_tokens: 400,
        temperature: 0.7,
      }),
    });
    if (!response.ok) {
      const err = await response.text();
      return res.status(500).json({ error: 'DeepSeek API error', detail: err });
    }
    const data = await response.json();
    return res.status(200).json({ reply: data.choices?.[0]?.message?.content || '（无回复）' });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
