/**
 * Claude API 本地代理
 * 解决浏览器直接调用 Claude API 的 CORS 问题
 * 运行: node proxy.js
 */

const http = require('http');
const https = require('https');

const PORT = 3456;
// API Key 从环境变量读取，不写死在代码里
// 启动方式见 start-proxy.bat
const CLAUDE_API_KEY = process.env.CLAUDE_API_KEY || '';

const server = http.createServer((req, res) => {
  // 允许所有来源（本地聊天室需要）
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method !== 'POST' || req.url !== '/claude') {
    res.writeHead(404);
    res.end('Not found');
    return;
  }

  let body = '';
  req.on('data', chunk => body += chunk);
  req.on('end', () => {
    let payload;
    try {
      payload = JSON.parse(body);
    } catch (e) {
      res.writeHead(400);
      res.end('Invalid JSON');
      return;
    }

    const postData = JSON.stringify(payload);
    const options = {
      hostname: 'api.anthropic.com',
      path: '/v1/messages',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': CLAUDE_API_KEY,
        'anthropic-version': '2023-06-01',
        'Content-Length': Buffer.byteLength(postData)
      }
    };

    const proxyReq = https.request(options, proxyRes => {
      let data = '';
      proxyRes.on('data', chunk => data += chunk);
      proxyRes.on('end', () => {
        res.writeHead(proxyRes.statusCode, { 'Content-Type': 'application/json' });
        res.end(data);
      });
    });

    proxyReq.on('error', e => {
      res.writeHead(500);
      res.end(JSON.stringify({ error: e.message }));
    });

    proxyReq.write(postData);
    proxyReq.end();
  });
});

server.listen(PORT, () => {
  console.log('');
  console.log('  🦞 Claude 代理已启动');
  console.log('  监听端口: http://localhost:' + PORT);
  console.log('  聊天室现在可以使用真正的 Claude 了');
  console.log('');
  console.log('  保持此窗口开启，关闭后代理停止');
  console.log('');
});
