const assert = require('assert');
const http = require('http');
const { app, validateCOIntakeReadiness, buildAuthoritativeLaborFact, applyCOAuthoritativeLabor } = require('../server');

describe('coIntakeReadiness', () => {
  it('builds a contractor authoritative labor fact from a 2-day 1-worker scope', () => {
    const result = buildAuthoritativeLaborFact(
      'Replace additional knob and tube wiring throughout. 2 additional days of work.',
      [{ questions: ['How many workers will be working for those 2 additional days?'], answer: '1' }]
    );

    assert.strictEqual(result.isResolved, true);
    assert.strictEqual(result.totalHours, 16);
    assert.strictEqual(result.crewSize, 1);
    assert.strictEqual(result.durationValue, 2);
    assert.strictEqual(result.durationUnit, 'days');
  });

  it('enforces the authoritative 16-hour total when AI item labor duplicates the contractor scope', () => {
    const parsed = {
      lineItems: [
        { category: 'Labor', desc: 'Additional labor for wiring replacement (2 days)', qty: 16, unit: 'hrs', materials: [], laborHours: 16, equipmentOrSubCost: 0, metadata: { assumptions: 'contractor labor' } },
        { category: 'Electrical', desc: 'Install single gang old work boxes', qty: 8, unit: 'ea', materials: [], laborHours: 1.6, equipmentOrSubCost: 0, metadata: { assumptions: 'component labor' } },
        { category: 'Electrical', desc: 'Install double gang old work box', qty: 1, unit: 'ea', materials: [], laborHours: 0.25, equipmentOrSubCost: 0, metadata: { assumptions: 'component labor' } }
      ]
    };

    applyCOAuthoritativeLabor(parsed, { isResolved: true, totalHours: 16, crewSize: 1, durationValue: 2, durationUnit: 'days', source: 'contractor' });

    const totalLabor = parsed.lineItems.reduce((sum, li) => sum + Number(li.laborHours || 0), 0);
    assert.strictEqual(totalLabor, 16);
    assert.strictEqual(parsed.lineItems[0].laborHours, 16);
    assert.strictEqual(parsed.lineItems[1].laborHours, 0);
    assert.strictEqual(parsed.lineItems[2].laborHours, 0);
  });

  it('CASE A: resolves a bare numeric worker answer from structured history', () => {
    const result = buildAuthoritativeLaborFact(
      'Replace additional knob and tube wiring. 2 additional days of work.',
      [{ questions: ['How many workers will be working for those 2 additional days?'], answer: '1' }]
    );

    assert.strictEqual(result.isResolved, true);
    assert.strictEqual(result.crewSize, 1);
    assert.strictEqual(result.totalHours, 16);
  });

  it('CASE B: resolves a crew-size answer from a people question', () => {
    const result = buildAuthoritativeLaborFact(
      '1 day of work.',
      [{ questions: ['How many people will be on the crew?'], answer: '3' }]
    );

    assert.strictEqual(result.isResolved, true);
    assert.strictEqual(result.crewSize, 3);
    assert.strictEqual(result.totalHours, 24);
  });

  it('CASE C: resolves a worker count for a short duration', () => {
    const result = buildAuthoritativeLaborFact(
      '4 hours of work.',
      [{ questions: ['How many workers?'], answer: '2' }]
    );

    assert.strictEqual(result.isResolved, true);
    assert.strictEqual(result.crewSize, 2);
    assert.strictEqual(result.totalHours, 8);
  });

  it('CASE D: ignores numeric answers when the question is not about workers or crew size', () => {
    const result = buildAuthoritativeLaborFact(
      '2 additional days of work.',
      [{ questions: ['What is the total number of items to inspect?'], answer: '1' }]
    );

    assert.strictEqual(result.crewSize, null);
    assert.strictEqual(result.isResolved, false);
  });

  it('CASE E: ignores non-numeric answers for crew-size questions', () => {
    const result = buildAuthoritativeLaborFact(
      '2 additional days of work.',
      [{ questions: ['How many workers will be working for those 2 additional days?'], answer: 'Unknown' }]
    );

    assert.strictEqual(result.crewSize, null);
    assert.strictEqual(result.isResolved, false);
  });

  it('resolves 3 workers for 1 day to 24 hours', () => {
    const result = buildAuthoritativeLaborFact(
      'Framing crew. 3 workers for 1 day.',
      []
    );

    assert.strictEqual(result.isResolved, true);
    assert.strictEqual(result.totalHours, 24);
  });

  it('resolves 2 workers for 4 hours to 8 hours', () => {
    const result = buildAuthoritativeLaborFact(
      '2 workers for 4 hours',
      []
    );

    assert.strictEqual(result.isResolved, true);
    assert.strictEqual(result.totalHours, 8);
  });

  it('leaves labor estimation unchanged when no contractor labor is resolved', () => {
    const parsed = {
      lineItems: [
        { category: 'Electrical', desc: 'Install boxes', qty: 1, unit: 'ea', materials: [], laborHours: 10, equipmentOrSubCost: 0, metadata: { assumptions: 'AI estimate' } }
      ]
    };

    applyCOAuthoritativeLabor(parsed, { isResolved: false, totalHours: 0, crewSize: null, durationValue: null, durationUnit: null, source: 'contractor' });

    assert.strictEqual(parsed.lineItems[0].laborHours, 10);
  });

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
