// Vercel Serverless Function - /api/chat
// CatDesk 用 DeepSeek，OpenClaw 用飞书净虾说

const FEISHU_APP_ID = 'cli_a947681bdf615bb6';
const FEISHU_APP_SECRET = process.env.FEISHU_APP_SECRET || 'w653qutyxcTu55ZOxUBJ3fuVFAM2qtgl';
const FEISHU_USER_OPEN_ID = 'ou_e63dc60b894fbe7e6172bcd146f082c8';
const FEISHU_CHAT_ID = 'oc_b6e9d59177fdfdc618b7bd2c86da9d99';

// 获取飞书 tenant_access_token
async function getFeishuToken() {
  const resp = await fetch('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ app_id: FEISHU_APP_ID, app_secret: FEISHU_APP_SECRET }),
  });
  const data = await resp.json();
  return data.tenant_access_token;
}

// 通过飞书发消息给净虾说（以机器人身份发到单聊）
async function sendToJingXiaSuo(token, text) {
  const resp = await fetch('https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=open_id', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({
      receive_id: FEISHU_USER_OPEN_ID,
      msg_type: 'text',
      content: JSON.stringify({ text }),
    }),
  });
  const data = await resp.json();
  return data.data?.message_id;
}

// 轮询获取净虾说的最新回复（等待 app 类型的新消息）
async function pollFeishuReply(token, afterMessageId, maxWaitMs = 15000) {
  const startTime = Date.now();
  let lastAppMsgId = afterMessageId;

  while (Date.now() - startTime < maxWaitMs) {
    await new Promise(r => setTimeout(r, 1500));

    const resp = await fetch(
      `https://open.feishu.cn/open-apis/im/v1/messages?container_id_type=chat&container_id=${FEISHU_CHAT_ID}&sort_type=ByCreateTimeDesc&page_size=5`,
      { headers: { 'Authorization': `Bearer ${token}` } }
    );
    const data = await resp.json();
    const items = data.data?.items || [];

    // 找最新的 app 回复（排除我们刚发的那条）
    for (const item of items) {
      if (item.sender?.sender_type === 'app' && item.message_id !== lastAppMsgId && item.message_id !== afterMessageId) {
        // 解析消息内容
        try {
          const body = JSON.parse(item.body?.content || '{}');
          // 纯文本消息
          if (body.text) return body.text;
          // 富文本消息
          if (body.content) {
            return body.content
              .flat()
              .filter(n => n.tag === 'text')
              .map(n => n.text)
              .join('');
          }
        } catch (e) {
          return item.body?.content || '（回复解析失败）';
        }
      }
    }
  }
  return '（净虾说没有及时回复，请稍后再试）';
}

export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { messages, botName } = req.body;

  // OpenClaw → 飞书净虾说
  if (botName === 'OpenClaw') {
    try {
      const token = await getFeishuToken();

      // 取最后一条用户消息作为发送内容
      const lastUserMsg = [...messages].reverse().find(m => m.role === 'user');
      const text = lastUserMsg?.content || '你好';

      // 先记录当前最新的 app 消息 id，用于区分新回复
      const histResp = await fetch(
        `https://open.feishu.cn/open-apis/im/v1/messages?container_id_type=chat&container_id=${FEISHU_CHAT_ID}&sort_type=ByCreateTimeDesc&page_size=3`,
        { headers: { 'Authorization': `Bearer ${token}` } }
      );
      const histData = await histResp.json();
      const latestAppMsgId = (histData.data?.items || []).find(i => i.sender?.sender_type === 'app')?.message_id;

      // 发消息给净虾说
      const sentMsgId = await sendToJingXiaSuo(token, text);

      // 轮询等待回复
      const reply = await pollFeishuReply(token, latestAppMsgId || sentMsgId);
      return res.status(200).json({ reply });

    } catch (e) {
      console.error('Feishu error:', e);
      return res.status(500).json({ error: e.message });
    }
  }

  // CatDesk → DeepSeek
  const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;
  if (!DEEPSEEK_API_KEY) {
    return res.status(500).json({ error: 'DEEPSEEK_API_KEY not configured' });
  }

  try {
    const response = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${DEEPSEEK_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: messages,
        max_tokens: 400,
        temperature: 0.7,
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      console.error('DeepSeek API error:', err);
      return res.status(500).json({ error: 'DeepSeek API error', detail: err });
    }

    const data = await response.json();
    const reply = data.choices?.[0]?.message?.content || '（无回复）';
    return res.status(200).json({ reply });

  } catch (e) {
    console.error('Handler error:', e);
    return res.status(500).json({ error: e.message });
  }
}
