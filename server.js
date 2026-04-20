const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.post('/api/estimate', async (req, res) => {
  const apiKey = process.env.ANTHROPIC_KEY;
  if (!apiKey) {
    console.error('[/api/estimate] ERROR: ANTHROPIC_KEY is not set');
    return res.status(500).json({ error: 'ANTHROPIC_KEY secret is not configured.' });
  }
  console.log('[/api/estimate] Request received:', JSON.stringify(req.body, null, 2));
  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify(req.body)
    });
    console.log('[/api/estimate] Anthropic response status:', response.status);
    const data = await response.json();
    if (!response.ok) {
      console.error('[/api/estimate] Anthropic error body:', JSON.stringify(data, null, 2));
    } else {
      console.log('[/api/estimate] Success — tokens used:', data.usage);
      const bodyPreview = JSON.stringify(data).slice(0, 500);
      console.log('[/api/estimate] Response body (first 500 chars):', bodyPreview);
    }
    res.status(response.status).json(data);
  } catch (err) {
    console.error('[/api/estimate] Fetch/network error:', err.message);
    res.status(500).json({ error: 'Failed to reach Anthropic API.' });
  }
});

app.use((req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
});
