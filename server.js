const express = require('express');
const Anthropic = require('@anthropic-ai/sdk');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '10mb' }));

// CORS
app.use(function(req, res, next) {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

app.get('/', function(req, res) {
  res.json({ status: 'ok', message: 'Contractor Desk AI server running' });
});

app.post('/api/estimate', async function(req, res) {
  console.log('[API] Request received:', new Date().toISOString());
  try {
    const { model, max_tokens, system, messages } = req.body;

    if (!messages || !messages.length) {
      return res.status(400).json({ error: { message: 'messages field is required' } });
    }

    const params = {
      model: model || 'claude-haiku-4-5-20251001',
      max_tokens: max_tokens || 1000,
      messages: messages,
    };

    if (system) params.system = system;

    console.log('[API] model:', params.model, '| system:', !!system, '| max_tokens:', params.max_tokens);

    const response = await anthropic.messages.create(params);

    console.log('[API] Response received | stop_reason:', response.stop_reason);
    res.json(response);

  } catch (err) {
    console.error('[API] Error:', err.message);
    res.status(err.status || 500).json({
      type: 'error',
      error: {
        type: err.error?.type || 'server_error',
        message: err.message || 'Unknown server error',
      }
    });
  }
});

app.listen(PORT, function() {
  console.log('Contractor Desk AI server running on port', PORT);
  console.log('API key present:', !!process.env.ANTHROPIC_API_KEY);
});