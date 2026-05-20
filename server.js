const express = require('express');
const cors = require('cors');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 5000;

const corsOptions = {
  origin: [
    'https://spence-contracting--phillip95.replit.app',
    'https://app.getcontractordesk.com',
    'https://getcontractordesk.com',
    /\.replit\.app$/,
    /\.replit\.dev$/,
    'http://localhost:5000'
  ],
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type'],
  credentials: false
};

app.options(/.*/, cors(corsOptions));
app.use(cors(corsOptions));
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.post('/api/estimate', async (req, res) => {
  console.log('[/api/estimate] REQUEST RECEIVED', new Date().toISOString());

  const apiKey = process.env.ANTHROPIC_KEY;
  if (!apiKey) {
    console.error('[/api/estimate] ERROR: ANTHROPIC_KEY is not set');
    return res.status(500).json({ error: 'ANTHROPIC_KEY secret is not configured.' });
  }

  try {
    let body = req.body;
    const mode = body.mode || 'passthrough';
    const keys = Object.keys(body).join(',');
    console.log('[/api/estimate] mode:', mode, '| keys:', keys);

    if (body.mode === 'estimate') {
      const items         = body.items      || '[]';
      const existingExcls = body.excls      || '[]';
      const markup        = body.markup     || 20;
      const laborRate     = body.laborRate  || 85;
      const location      = body.location   || '';
      const histCtx       = body.histCtx    || '';
      const prompt        = body.prompt     || '';
      const model         = body.model      || 'claude-haiku-4-5-20251001';
      const maxTok        = body.max_tokens || 2000;

      const systemPrompt =
        'IMPORTANT: Your entire response must be a single raw JSON object.' +
        ' No markdown, no code fences, no backticks, no explanation.' +
        ' Start your response with { and end with }.' +
        ' You are a construction estimator.' +
        ' Format: {"action":"add","lineItems":[{"category":"Labor","desc":"description","qty":1,"unit":"hrs","unitCost":85,"total":85,"markup":20}],"deleteIndexes":[],"updateItems":[],"exclusions":[],"message":"what was done"}' +
        ' IMPORTANT: total = qty * unitCost. markup = percentage for client price.' +
        ' Current items: ' + items +
        ' Current exclusions: ' + existingExcls +
        ' Markup: ' + markup + '%. Labor: $' + laborRate + '/hr.' +
        (location ? ' Location: ' + location + '.' : '') +
        (histCtx  ? ' HISTORICAL: ' + histCtx  + '.' : '') +
        ' Rules: lineItems=ADD, deleteIndexes=DELETE, updateItems=UPDATE.' +
        ' When adding exclusions, return them as plain strings in the exclusions array.' +
        ' Example exclusions: ["Permit fees are excluded unless specifically noted.","Hidden damage or concealed conditions are excluded.","Painting is excluded unless listed in the scope."]' +
        ' Do not repeat exclusions already in the current exclusions list.';

      body = {
        model:      model,
        max_tokens: maxTok,
        system:     systemPrompt,
        messages:   [{ role: 'user', content: prompt }]
      };

      console.log('[/api/estimate] Estimate mode | prompt len:', prompt.length, '| model:', model);
    }

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify(body)
    });

    console.log('[/api/estimate] Anthropic response status:', response.status);
    const data = await response.json();

    if (!response.ok) {
      console.error('[/api/estimate] Anthropic error:', data.error ? data.error.message : response.status);
    } else {
      console.log('[/api/estimate] Success | stop_reason:', data.stop_reason, '| tokens:', JSON.stringify(data.usage));
    }

    res.status(response.status).json(data);

  } catch (err) {
    console.error('[/api/estimate] Error:', err.message);
    res.status(500).json({ error: 'Failed to reach Anthropic API.' });
  }
});

app.use((req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log('Server running on port', PORT);
});
