/**
 * Claude API 本地代理 + 静态文件服务
 * 同时托管聊天室页面，解决 CORS 问题
 * 运行: node proxy.js
 * 然后访问: http://localhost:3456
 */

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const PORT = 3456;
const CLAUDE_API_KEY = process.env.CLAUDE_API_KEY || '';

const server = http.createServer((req, res) => {
  // ===== 静态文件服务 =====
  if (req.method === 'GET') {
    const filePath = path.join(__dirname, req.url === '/' ? 'index.html' : req.url);
    fs.readFile(filePath, (err, data) => {
      if (err) {
        res.writeHead(404);
        res.end('Not found');
        return;
      }
      const ext = path.extname(filePath);
      const mime = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css' }[ext] || 'text/plain';
      res.writeHead(200, { 'Content-Type': mime + '; charset=utf-8' });
      res.end(data);
    });
    return;
  }

  // ===== CORS 预检 =====
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // ===== Claude API 代理 =====
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
        res.setHeader('Access-Control-Allow-Origin', '*');
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
  console.log('');
  console.log('  👉 打开聊天室: http://localhost:' + PORT);
  console.log('');
  console.log('  保持此窗口开启，关闭后服务停止');
  console.log('');
});
