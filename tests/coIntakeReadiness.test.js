const assert = require('assert');
const http = require('http');
const { app, validateCOIntakeReadiness } = require('../server');

describe('coIntakeReadiness', () => {
  it('returns questions when a labor duration is stated without crew size or total labor hours', () => {
    const payload = {
      title: 'Replace knob and tube wiring',
      description: 'Replace additional knob and tube wiring throughout will need 2 additional days of work 500 lf of 12-2 romex 10 round old work boxes 8 single gang old work boxes 1 double gang old work box',
      prompt: 'Replace additional knob and tube wiring throughout will need 2 additional days of work 500 lf of 12-2 romex 10 round old work boxes 8 single gang old work boxes 1 double gang old work box',
      questionContext: {
        originalPrompt: 'Replace additional knob and tube wiring throughout will need 2 additional days of work 500 lf of 12-2 romex 10 round old work boxes 8 single gang old work boxes 1 double gang old work box',
        history: []
      }
    };

    const result = validateCOIntakeReadiness(payload);

    assert.ok(result);
    assert.strictEqual(result.action, 'questions');
    assert.ok(Array.isArray(result.questions));
    assert.ok(result.questions.some((q) => q.toLowerCase().includes('workers') || q.toLowerCase().includes('labor hours')));
  });

  it('recognizes a question + answer as resolving crew-size ambiguity on a second intake round', () => {
    const payload = {
      title: 'Work will require 2 additional days of labor.',
      description: 'Work will require 2 additional days of labor.',
      prompt: 'Work will require 2 additional days of labor.',
      questionContext: {
        originalPrompt: 'Work will require 2 additional days of labor.',
        history: [
          {
            questions: ['How many workers will be working for those 2 additional days?'],
            answer: '1'
          }
        ]
      }
    };

    const result = validateCOIntakeReadiness(payload);

    assert.strictEqual(result, null);
  });

  it('allows ready when labor duration is paired with crew-size fact', () => {
    const payload = {
      title: 'Replace knob and tube wiring',
      description: 'Replace additional knob and tube wiring throughout will need 2 additional days of work with 2 electricians. 500 lf of 12-2 romex 10 round old work boxes 8 single gang old work boxes 1 double gang old work box',
      prompt: 'Replace additional knob and tube wiring throughout will need 2 additional days of work with 2 electricians. 500 lf of 12-2 romex 10 round old work boxes 8 single gang old work boxes 1 double gang old work box',
      questionContext: {
        originalPrompt: 'Replace additional knob and tube wiring throughout will need 2 additional days of work with 2 electricians. 500 lf of 12-2 romex 10 round old work boxes 8 single gang old work boxes 1 double gang old work box',
        history: []
      }
    };

    const result = validateCOIntakeReadiness(payload);

    assert.strictEqual(result, null);
  });

  it('returns a valid provider intake response without failing on parse after a valid OpenAI question payload', async () => {
    const originalFetch = global.fetch;
    process.env.ANTHROPIC_KEY = 'test-key';
    process.env.OPENAI_API_KEY = 'test-key';

    const providerResponse = {
      action: 'questions',
      questions: ['How many workers will be working for those 2 additional days?']
    };

    global.fetch = async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        choices: [{ message: { content: JSON.stringify(providerResponse) } }]
      })
    });

    await new Promise((resolve, reject) => {
      const server = app.listen(0, () => {
        const port = server.address().port;
        const req = http.request({
          host: '127.0.0.1',
          port,
          path: '/api/estimate',
          method: 'POST',
          headers: { 'Content-Type': 'application/json' }
        }, (res) => {
          let body = '';
          res.on('data', (chunk) => { body += chunk; });
          res.on('end', () => {
            try {
              const parsed = JSON.parse(body);
              assert.deepStrictEqual(parsed, providerResponse);
              server.close();
              global.fetch = originalFetch;
              resolve();
            } catch (err) {
              server.close();
              global.fetch = originalFetch;
              reject(err);
            }
          });
        });

        req.on('error', (err) => {
          server.close();
          global.fetch = originalFetch;
          reject(err);
        });

        req.write(JSON.stringify({
          mode: 'change-order-intake',
          model: 'gpt-4.1',
          max_tokens: 1200,
          prompt: '1',
          title: 'CO title',
          description: 'Work will require 2 additional days of labor.',
          questionContext: {
            originalPrompt: 'Work will require 2 additional days of labor.',
            history: [{
              questions: ['How many workers will be working for those 2 additional days?'],
              answer: '1'
            }]
          },
          messages: [{ role: 'user', content: '1' }]
        }));
        req.end();
      });
    });
  });
});
