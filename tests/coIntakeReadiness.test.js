const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const http = require('http');
const { app, validateCOIntakeReadiness, buildAuthoritativeLaborFact, applyCOAuthoritativeLabor, buildMaterialCompletenessContractText, buildMaterialPricingContractText } = require('../server');

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

  it('preserves CO intake history into the final generation request context', () => {
    const html = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
    const start = html.indexOf('function buildCOGenerationRequestContext');
    const end = html.indexOf('function deriveAuthoritativeLaborFromScope', start);
    const snippet = html.slice(start, end);
    const context = {
      window: {
        _aiCOQuestionState: {
          active: false,
          originalPrompt: 'Replace additional knob and tube wiring throughout the property. Work will require 2 additional days of labor.',
          questions: ['How many workers will be working for those 2 additional days?'],
          history: [{ questions: ['How many workers will be working for those 2 additional days?'], answer: '1' }]
        }
      },
      DD: { aiProfile: { markup: 40, laborRate: 85 } },
      estimates: [],
      buildHistoricalContext: () => 'history',
      gpr: () => ({ id: 'proj-1' }),
      document: { querySelector: () => null }
    };
    vm.runInNewContext(snippet, context);
    const result = context.buildCOGenerationRequestContext(
      'Replace additional knob and tube wiring throughout the property.',
      'Work will require 2 additional days of labor.',
      context.window._aiCOQuestionState
    );

    assert.strictEqual(result.questionContext.history.length, 1);
    assert.strictEqual(result.questionContext.history[0].answer, '1');
    assert.strictEqual(result.authoritativeLabor.isResolved, true);
    assert.strictEqual(result.authoritativeLabor.crewSize, 1);
    assert.strictEqual(result.authoritativeLabor.durationValue, 2);
    assert.strictEqual(result.authoritativeLabor.durationUnit, 'days');
    assert.strictEqual(result.authoritativeLabor.totalHours, 16);
  });

  it('keeps the prior behavior unchanged when there is no labor follow-up history', () => {
    const html = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
    const start = html.indexOf('function buildCOGenerationRequestContext');
    const end = html.indexOf('function deriveAuthoritativeLaborFromScope', start);
    const snippet = html.slice(start, end);
    const context = {
      window: { _aiCOQuestionState: { active: false, originalPrompt: '', questions: [], history: [] } },
      DD: { aiProfile: { markup: 40, laborRate: 85 } },
      estimates: [],
      buildHistoricalContext: () => '',
      gpr: () => ({ id: 'proj-1' }),
      document: { querySelector: () => null }
    };
    vm.runInNewContext(snippet, context);
    const result = context.buildCOGenerationRequestContext(
      'Replace additional knob and tube wiring throughout the property.',
      'Work will require 2 additional days of labor.',
      context.window._aiCOQuestionState
    );

    assert.strictEqual(result.questionContext.history.length, 0);
    assert.strictEqual(result.authoritativeLabor.isResolved, false);
    assert.strictEqual(result.authoritativeLabor.totalHours, 0);
  });

  it('preserves contractor intake history when the initial intake resolves without asking a follow-up question', async () => {
    const html = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
    const start = html.indexOf('function runCOGenerationRequest');
    const end = html.indexOf('function signCOBtn', start);
    const snippet = html.slice(start, end);
    const calls = [];
    const context = {
      console,
      T: () => {},
      DD: { aiProfile: { markup: 20, laborRate: 85 } },
      estimates: [],
      buildHistoricalContext: () => 'history',
      parseFloat: Number.parseFloat,
      gpr: () => ({ id: 'proj-1' }),
      document: {
        querySelector: () => null,
        getElementById: () => null
      },
      window: {
        _aiCOQuestionState: {
          active: false,
          originalPrompt: 'Replace additional knob and tube wiring throughout the property.',
          questions: [],
          history: [{ questions: ['How many workers will be working for those 2 additional days?'], answer: '1' }]
        }
      },
      fetch: function fetchStub(url, options) {
        const payload = JSON.parse(options.body);
        calls.push({ kind: 'fetch', url, payload });
        return Promise.resolve({ json: () => Promise.resolve({ action: 'ready' }) });
      },
      AbortController: function AbortControllerStub() {
        this.abort = () => {};
      },
      setTimeout: () => 1,
      clearTimeout: () => {},
      updateCOPreview: () => {},
      runCOGenerationRequest: function runCOGenerationRequestStub(title, desc, btnEl, questionState) {
        calls.push({ kind: 'runCOGenerationRequest', title, desc, questionState });
      }
    };
    vm.runInNewContext(snippet, context);
    context.generateCOWithAI({ disabled: false, textContent: 'AI Draft' });
    await new Promise((resolve) => setImmediate(resolve));

    const runCall = calls.find((call) => call.kind === 'runCOGenerationRequest');
    assert.ok(runCall, 'expected the initial intake ready path to call runCOGenerationRequest');
    assert.ok(runCall.questionState, 'expected the preserved historical context to be passed into the final generation request');
    assert.strictEqual(runCall.questionState.history.length, 1);
    assert.strictEqual(runCall.questionState.history[0].answer, '1');
    assert.strictEqual(runCall.questionState.authoritativeLabor.totalHours, 16);
    assert.strictEqual(context.window._aiCOQuestionState.history.length, 0);
  });

  it('uses the authoritative server-computed CO total for base, markup, and client-facing amount', () => {
    const serverPayload = {
      title: 'Electrical add-on',
      description: 'Labor and materials',
      lineItems: [],
      baseCost: 1490,
      markupPct: 40,
      markupAmount: 596,
      budgetImpact: 2086,
      clientTotal: 2086,
      finalTotal: 2086
    };

    const clientTotal = Number(serverPayload.finalTotal ?? serverPayload.clientTotal ?? serverPayload.budgetImpact ?? 0);
    assert.strictEqual(serverPayload.baseCost, 1490);
    assert.strictEqual(serverPayload.markupPct, 40);
    assert.strictEqual(serverPayload.markupAmount, 596);
    assert.strictEqual(clientTotal, 2086);
    assert.notStrictEqual(clientTotal, serverPayload.baseCost);
    assert.strictEqual(clientTotal - serverPayload.baseCost, 596);
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

  it('defines direct-material unit cost semantics for generated pricing', () => {
    const text = buildMaterialPricingContractText();
    const lower = text.toLowerCase();

    assert.ok(lower.includes('direct material acquisition cost only'));
    assert.ok(lower.includes('labor'));
    assert.ok(lower.includes('installation'));
    assert.ok(lower.includes('overhead'));
    assert.ok(lower.includes('markup'));
    assert.ok(lower.includes('unitcost'));
  });

  it('zeroes all non-authoritative AI labor rows when authoritative labor is resolved', () => {
    const parsed = {
      lineItems: [
        { category: 'Electrical', desc: 'Install boxes', qty: 8, unit: 'ea', materials: [], laborHours: 4, equipmentOrSubCost: 0, metadata: { assumptions: 'AI component labor' } },
        { category: 'Labor', desc: 'Additional labor for wiring replacement', qty: 10, unit: 'hrs', materials: [], laborHours: 10, equipmentOrSubCost: 0, metadata: { assumptions: 'AI labor row' } }
      ]
    };

    applyCOAuthoritativeLabor(parsed, { isResolved: true, totalHours: 16, crewSize: 1, durationValue: 2, durationUnit: 'days', source: 'contractor' });

    const totalLabor = parsed.lineItems.reduce((sum, li) => sum + Number(li.laborHours || 0), 0);
    const positiveRows = parsed.lineItems.filter((li) => Number(li.laborHours || 0) > 0);

    assert.strictEqual(totalLabor, 16);
    assert.strictEqual(positiveRows.length, 1);
    assert.strictEqual(positiveRows[0].laborHours, 16);
  });

  it('keeps only one authoritative labor allocation when the model already created multiple labor-bearing rows', () => {
    const parsed = {
      lineItems: [
        { category: 'Electrical', desc: 'Run cable', qty: 120, unit: 'lf', materials: [], laborHours: 8, equipmentOrSubCost: 0, metadata: { assumptions: 'AI labor' } },
        { category: 'Labor', desc: 'Additional labor for wiring replacement', qty: 12, unit: 'hrs', materials: [], laborHours: 12, equipmentOrSubCost: 0, metadata: { assumptions: 'AI labor row' } },
        { category: 'Electrical', desc: 'Install boxes', qty: 10, unit: 'ea', materials: [], laborHours: 6, equipmentOrSubCost: 0, metadata: { assumptions: 'AI labor' } }
      ]
    };

    applyCOAuthoritativeLabor(parsed, { isResolved: true, totalHours: 16, crewSize: 1, durationValue: 2, durationUnit: 'days', source: 'contractor' });

    const totalLabor = parsed.lineItems.reduce((sum, li) => sum + Number(li.laborHours || 0), 0);
    const positiveRows = parsed.lineItems.filter((li) => Number(li.laborHours || 0) > 0);

    assert.strictEqual(totalLabor, 16);
    assert.strictEqual(positiveRows.length, 1);
    assert.strictEqual(positiveRows[0].laborHours, 16);
  });

  it('enforces the authoritative labor total when several rows carry AI labor hours', () => {
    const parsed = {
      lineItems: [
        { category: 'Electrical', desc: 'Pull wire', qty: 500, unit: 'lf', materials: [], laborHours: 9, equipmentOrSubCost: 0, metadata: { assumptions: 'AI labor' } },
        { category: 'Electrical', desc: 'Cut and terminate', qty: 12, unit: 'ea', materials: [], laborHours: 5, equipmentOrSubCost: 0, metadata: { assumptions: 'AI labor' } },
        { category: 'Labor', desc: 'Crew labor', qty: 4, unit: 'hrs', materials: [], laborHours: 4, equipmentOrSubCost: 0, metadata: { assumptions: 'AI labor row' } }
      ]
    };

    applyCOAuthoritativeLabor(parsed, { isResolved: true, totalHours: 16, crewSize: 1, durationValue: 2, durationUnit: 'days', source: 'contractor' });

    const totalLabor = parsed.lineItems.reduce((sum, li) => sum + Number(li.laborHours || 0), 0);
    assert.strictEqual(totalLabor, 16);
  });

  it('leaves labor handling unchanged when authoritative labor is not resolved', () => {
    const parsed = {
      lineItems: [
        { category: 'Electrical', desc: 'Install boxes', qty: 1, unit: 'ea', materials: [], laborHours: 10, equipmentOrSubCost: 0, metadata: { assumptions: 'AI estimate' } }
      ]
    };

    applyCOAuthoritativeLabor(parsed, { isResolved: false, totalHours: 0, crewSize: null, durationValue: null, durationUnit: null, source: 'contractor' });

    assert.strictEqual(parsed.lineItems[0].laborHours, 10);
  });

  it('keeps the authoritative 16-hour labor total through the real CO normalization path', async () => {
    const originalFetch = global.fetch;
    const previousExperiment = process.env.AI_BREAKDOWN_EXPERIMENT;
    const previousAnthropicKey = process.env.ANTHROPIC_KEY;
    const previousOpenAiKey = process.env.OPENAI_API_KEY;

    process.env.ANTHROPIC_KEY = 'test-key';
    process.env.OPENAI_API_KEY = 'test-key';
    process.env.AI_BREAKDOWN_EXPERIMENT = 'true';
    delete require.cache[require.resolve('../server')];

    const serverModule = require('../server');
    const serverApp = serverModule.app;

    const providerResponse = {
      action: 'add',
      lineItems: [
        {
          category: 'Electrical',
          desc: 'Install boxes',
          qty: 8,
          unit: 'ea',
          materials: [{ desc: 'Boxes', qty: 8, unit: 'ea', unitCost: 12.5, primary: true, quantityBasis: 'ai-estimated', basisPerUnit: null }],
          laborHours: 4,
          equipmentOrSubCost: 0,
          metadata: { assumptions: 'AI component labor' }
        },
        {
          category: 'Labor',
          desc: 'Additional labor for wiring replacement',
          qty: 10,
          unit: 'hrs',
          materials: [],
          laborHours: 10,
          equipmentOrSubCost: 0,
          metadata: { assumptions: 'AI labor row' }
        },
        {
          category: 'Electrical',
          desc: 'Install conduit',
          qty: 12,
          unit: 'lf',
          materials: [{ desc: 'Conduit', qty: 12, unit: 'lf', unitCost: 7.5, primary: true, quantityBasis: 'ai-estimated', basisPerUnit: null }],
          laborHours: 2,
          equipmentOrSubCost: 75,
          metadata: { assumptions: 'AI labor' }
        }
      ],
      message: 'ok'
    };

    global.fetch = async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        choices: [{ message: { content: JSON.stringify(providerResponse) } }]
      })
    });

    try {
      const responseBody = await new Promise((resolve, reject) => {
        const server = serverApp.listen(0, () => {
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
                server.close();
                resolve(JSON.parse(body));
              } catch (err) {
                server.close();
                reject(err);
              }
            });
          });

          req.on('error', (err) => {
            server.close();
            reject(err);
          });

          req.write(JSON.stringify({
            mode: 'change-order-generate',
            title: 'Replace additional knob and tube wiring throughout the property.',
            description: 'Work will require 2 additional days of labor.',
            prompt: 'Replace additional knob and tube wiring throughout the property. Work will require 2 additional days of labor.',
            items: '[]',
            excls: '[]',
            markup: 40,
            laborRate: 85,
            questionContext: {
              originalPrompt: 'Replace additional knob and tube wiring throughout the property. Work will require 2 additional days of labor.',
              history: [{ questions: ['How many workers will be working for those 2 additional days?'], answer: '1' }]
            },
            messages: [{ role: 'user', content: 'Replace additional knob and tube wiring throughout the property. Work will require 2 additional days of labor.' }]
          }));
          req.end();
        });
      });

      const totalLaborHours = responseBody.lineItems.reduce((sum, li) => sum + (Number(li.aiBreakdown && li.aiBreakdown.laborHours) || 0), 0);
      const positiveRows = responseBody.lineItems.filter((li) => Number(li.aiBreakdown && li.aiBreakdown.laborHours) > 0);
      const laborCost = responseBody.lineItems.reduce((sum, li) => {
        return sum + ((Number(li.aiBreakdown && li.aiBreakdown.laborHours) || 0) * 85);
      }, 0);
      const materialSnapshot = responseBody.lineItems.map((li) => ({
        desc: li.desc,
        materials: li.materials ? li.materials.map((m) => ({ qty: Number(m.qty), unitCost: Number(m.unitCost) })) : [],
        equipmentOrSubCost: Number(li.aiBreakdown && li.aiBreakdown.equipmentOrSubCost || 0)
      }));

      assert.strictEqual(totalLaborHours, 16);
      assert.strictEqual(positiveRows.length, 1);
      assert.strictEqual(positiveRows[0].aiBreakdown.laborHours, 16);
      assert.strictEqual(laborCost, 1360);
      assert.ok(materialSnapshot.every((entry) => entry.materials.length >= 0));
      assert.strictEqual(responseBody.lineItems[0].aiBreakdown.materials[0].qty, 8);
      assert.strictEqual(responseBody.lineItems[2].aiBreakdown.materials[0].qty, 12);
      assert.strictEqual(responseBody.lineItems[2].aiBreakdown.equipmentOrSubCost, 75);
    } finally {
      global.fetch = originalFetch;
      if (previousExperiment === undefined) {
        delete process.env.AI_BREAKDOWN_EXPERIMENT;
      } else {
        process.env.AI_BREAKDOWN_EXPERIMENT = previousExperiment;
      }
      if (previousAnthropicKey === undefined) {
        delete process.env.ANTHROPIC_KEY;
      } else {
        process.env.ANTHROPIC_KEY = previousAnthropicKey;
      }
      if (previousOpenAiKey === undefined) {
        delete process.env.OPENAI_API_KEY;
      } else {
        process.env.OPENAI_API_KEY = previousOpenAiKey;
      }
      delete require.cache[require.resolve('../server')];
    }
  });

  it('includes the direct-material and completeness contract in estimate and CO generation prompts', async () => {
    const originalFetch = global.fetch;
    process.env.ANTHROPIC_KEY = 'test-key';
    process.env.OPENAI_API_KEY = 'test-key';

    const calls = [];
    global.fetch = async (_url, options) => {
      const body = JSON.parse(options.body || '{}');
      calls.push(body);
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          choices: [{ message: { content: JSON.stringify({ action: 'ready', lineItems: [], deleteIndexes: [], updateItems: [], exclusions: [], message: 'ok' }) } }]
        })
      };
    };

    try {
      const payloads = [
        { mode: 'estimate-generate', title: 'Estimate test', description: 'Two-room remodel', prompt: 'Remodel two rooms', items: '[]', excls: '[]', markup: 20, laborRate: 85, messages: [{ role: 'user', content: 'Remodel two rooms' }] },
        { mode: 'change-order-generate', title: 'CO test', description: 'Electrical scope', prompt: 'Add wiring scope', items: '[]', excls: '[]', markup: 20, laborRate: 85, messages: [{ role: 'user', content: 'Add wiring scope' }] }
      ];

      for (const payload of payloads) {
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
                  JSON.parse(body);
                  server.close();
                  resolve();
                } catch (err) {
                  server.close();
                  reject(err);
                }
              });
            });

            req.on('error', (err) => {
              server.close();
              reject(err);
            });

            req.write(JSON.stringify(payload));
            req.end();
          });
        });
      }

      assert.ok(calls.length >= 2);
      const promptText = calls.map((body) => {
        const messages = Array.isArray(body.messages) ? body.messages : [];
        return messages.map((message) => (message && message.content) || '').join(' ');
      }).join(' ');

      const contract = buildMaterialPricingContractText();
      const completeness = buildMaterialCompletenessContractText();
      assert.ok(contract.toLowerCase().includes('direct material acquisition cost only'));
      assert.ok(contract.toLowerCase().includes('complete direct-material package'));
      assert.ok(contract.toLowerCase().includes('supporting'));
      assert.ok(contract.toLowerCase().includes('quantity basis'));
      assert.ok(contract.toLowerCase().includes('labor'));
      assert.ok(contract.toLowerCase().includes('markup'));
      assert.ok(completeness.toLowerCase().includes('complete direct-material package'));
      assert.ok(promptText.toLowerCase().includes('complete direct-material package'));
      assert.ok(promptText.toLowerCase().includes('supporting'));
    } finally {
      global.fetch = originalFetch;
    }
  });

  it('shows item-level material, labor, base, markup, and final total details without offering the pre-markup total as the client total', () => {
    const html = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
    const start = html.indexOf('function formatMoney');
    const end = html.indexOf('function addCO', start);
    const snippet = html.slice(start, end);
    const card = { style: {}, innerHTML: '' };
    const title = { value: 'Replace knob and tube wiring' };
    const desc = { value: 'Remove and replace additional knob and tube wiring throughout property\n\nLine Item Summary\n• Run cable — 500 LF × $0.62 = $310.00' };
    const budget = { value: '2287.60' };
    const status = { value: 'Draft' };
    const context = {
      window: {
        _coDraftItems: [{
          desc: 'Run cable',
          qty: 500,
          unit: 'LF',
          unitCost: 0.62,
          total: 310,
          markup: 40,
          aiBreakdown: {
            materials: [{ desc: '12-2 Romex', qty: 500, unit: 'LF', unitCost: 0.62 }],
            laborHours: 16,
            equipmentOrSubCost: 0,
            assumptions: 'CO scope'
          }
        }, {
          desc: 'Install boxes',
          qty: 10,
          unit: 'ea',
          unitCost: 132.4,
          total: 1324,
          markup: 40,
          aiBreakdown: {
            materials: [{ desc: 'Old work boxes', qty: 10, unit: 'ea', unitCost: 32.4 }],
            laborHours: 0,
            equipmentOrSubCost: 0,
            assumptions: 'CO scope'
          }
        }],
        _coDraftItemsStale: false
      },
      DD: { aiProfile: { laborRate: 85, markup: 40 } },
      document: {
        getElementById: (id) => {
          if (id === 'coPreviewCard') return card;
          if (id === 'coTitle') return title;
          if (id === 'coDesc') return desc;
          if (id === 'coBudget') return budget;
          if (id === 'coStatus') return status;
          return null;
        }
      }
    };
    vm.runInNewContext(snippet, context);
    context.updateCOPreview();

    assert.ok(card.innerHTML.includes('12-2 Romex'));
    assert.ok(card.innerHTML.includes('Material Subtotal'));
    assert.ok(card.innerHTML.includes('Labor: 16 hrs'));
    assert.ok(card.innerHTML.includes('Base Cost'));
    assert.ok(card.innerHTML.includes('Markup (40%)'));
    assert.ok(card.innerHTML.includes('$2,287.60'));
    assert.ok(card.innerHTML.includes('Base Cost Before Markup'));
    assert.ok(!card.innerHTML.includes('Use This Total'));
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

  it('CASE A: applies the catalog price when 12/2 Romex is in feet and matches the catalog unit', () => {
    const { applyAuthoritativeMaterialPricing, MATERIAL_PRICE_CATALOG } = require('../server');
    const parsed = {
      lineItems: [{
        category: 'Electrical',
        desc: 'Run cable',
        qty: 500,
        unit: 'ft',
        laborHours: 8,
        equipmentOrSubCost: 0,
        materials: [{ desc: '12/2 Romex', qty: 500, unit: 'ft', unitCost: 1.25, primary: true, quantityBasis: 'ai-estimated', basisPerUnit: null }],
        metadata: { assumptions: 'test' }
      }]
    };

    applyAuthoritativeMaterialPricing(parsed);

    assert.strictEqual(parsed.lineItems[0].materials[0].unitCost, MATERIAL_PRICE_CATALOG['nm-b 12/2'].unitCost);
    assert.strictEqual(parsed.lineItems[0].materials[0].qty, 500);
    assert.strictEqual(parsed.lineItems[0].materials[0].unit, 'ft');
  });

  it('CASE B: normalizes LF to ft and allows the catalog match', () => {
    const { applyAuthoritativeMaterialPricing, MATERIAL_PRICE_CATALOG } = require('../server');
    const parsed = {
      lineItems: [{
        category: 'Electrical',
        desc: 'Run cable',
        qty: 500,
        unit: 'ft',
        laborHours: 8,
        equipmentOrSubCost: 0,
        materials: [{ desc: '12/2 Romex', qty: 500, unit: 'LF', unitCost: 1.25, primary: true, quantityBasis: 'ai-estimated', basisPerUnit: null }],
        metadata: { assumptions: 'test' }
      }]
    };

    applyAuthoritativeMaterialPricing(parsed);

    assert.strictEqual(parsed.lineItems[0].materials[0].unitCost, MATERIAL_PRICE_CATALOG['nm-b 12/2'].unitCost);
    assert.strictEqual(parsed.lineItems[0].materials[0].qty, 500);
  });

  it('CASE C: does not apply the catalog price when unit is incompatible (roll)', () => {
    const { applyAuthoritativeMaterialPricing } = require('../server');
    const parsed = {
      lineItems: [{
        category: 'Electrical',
        desc: 'Run cable',
        qty: 2,
        unit: 'roll',
        laborHours: 2,
        equipmentOrSubCost: 0,
        materials: [{ desc: '12/2 Romex', qty: 2, unit: 'roll', unitCost: 99.00, primary: true, quantityBasis: 'ai-estimated', basisPerUnit: null }],
        metadata: { assumptions: 'test' }
      }]
    };

    applyAuthoritativeMaterialPricing(parsed);

    assert.strictEqual(parsed.lineItems[0].materials[0].unitCost, 99.00);
  });

  it('CASE D: applies the catalog price for a single gang box in each units', () => {
    const { applyAuthoritativeMaterialPricing, MATERIAL_PRICE_CATALOG } = require('../server');
    const parsed = {
      lineItems: [{
        category: 'Electrical',
        desc: 'Install boxes',
        qty: 10,
        unit: 'ea',
        laborHours: 3,
        equipmentOrSubCost: 0,
        materials: [{ desc: 'single gang box', qty: 10, unit: 'ea', unitCost: 7.25, primary: true, quantityBasis: 'ai-estimated', basisPerUnit: null }],
        metadata: { assumptions: 'test' }
      }]
    };

    applyAuthoritativeMaterialPricing(parsed);

    assert.strictEqual(parsed.lineItems[0].materials[0].unitCost, MATERIAL_PRICE_CATALOG['standard single-gang electrical box'].unitCost);
  });

  it('CASE E: does not apply the catalog price when the unit is an unrecognized incompatible unit', () => {
    const { applyAuthoritativeMaterialPricing } = require('../server');
    const parsed = {
      lineItems: [{
        category: 'Electrical',
        desc: 'Install boxes',
        qty: 1,
        unit: 'box',
        laborHours: 1,
        equipmentOrSubCost: 0,
        materials: [{ desc: 'single gang box', qty: 1, unit: 'box', unitCost: 4.50, primary: true, quantityBasis: 'ai-estimated', basisPerUnit: null }],
        metadata: { assumptions: 'test' }
      }]
    };

    applyAuthoritativeMaterialPricing(parsed);

    assert.strictEqual(parsed.lineItems[0].materials[0].unitCost, 4.50);
  });

  it('CASE F: unknown material keeps the AI unitCost exactly as before', () => {
    const { applyAuthoritativeMaterialPricing } = require('../server');
    const parsed = {
      lineItems: [{
        category: 'Electrical',
        desc: 'Run custom wire',
        qty: 3,
        unit: 'ft',
        laborHours: 2,
        equipmentOrSubCost: 0,
        materials: [{ desc: 'Custom copper conductor', qty: 3, unit: 'ft', unitCost: 12.50, primary: true, quantityBasis: 'ai-estimated', basisPerUnit: null }],
        metadata: { assumptions: 'test' }
      }]
    };

    applyAuthoritativeMaterialPricing(parsed);

    assert.strictEqual(parsed.lineItems[0].materials[0].unitCost, 12.50);
  });

  it('CASE G: leaves unrelated labor, markup, quantities, and pricing behavior unchanged', () => {
    const { applyAuthoritativeMaterialPricing } = require('../server');
    const parsed = {
      lineItems: [{
        category: 'Electrical',
        desc: 'Run cable',
        qty: 125,
        unit: 'ft',
        laborHours: 10,
        equipmentOrSubCost: 75,
        materials: [{ desc: '12/2 Romex', qty: 125, unit: 'ft', unitCost: 1.20, primary: true, quantityBasis: 'ai-estimated', basisPerUnit: null }],
        metadata: { assumptions: 'test' },
        markup: 35
      }]
    };

    const beforeQty = parsed.lineItems[0].qty;
    const beforeMaterialQty = parsed.lineItems[0].materials[0].qty;
    const beforeLabor = parsed.lineItems[0].laborHours;
    const beforeMarkup = parsed.lineItems[0].markup;
    const beforeEquipment = parsed.lineItems[0].equipmentOrSubCost;

    applyAuthoritativeMaterialPricing(parsed);

    assert.strictEqual(parsed.lineItems[0].qty, beforeQty);
    assert.strictEqual(parsed.lineItems[0].materials[0].qty, beforeMaterialQty);
    assert.strictEqual(parsed.lineItems[0].laborHours, beforeLabor);
    assert.strictEqual(parsed.lineItems[0].equipmentOrSubCost, beforeEquipment);
    assert.strictEqual(parsed.lineItems[0].markup, beforeMarkup);
  });

  it('CASE H: blank or missing material.unit prevents catalog override and keeps the AI price', () => {
    const { applyAuthoritativeMaterialPricing } = require('../server');
    const parsed = {
      lineItems: [{
        category: 'Electrical',
        desc: 'Run cable',
        qty: 500,
        unit: 'ft',
        laborHours: 8,
        equipmentOrSubCost: 0,
        materials: [{ desc: '12/2 Romex', qty: 500, unit: '', unitCost: 9.99, primary: true, quantityBasis: 'ai-estimated', basisPerUnit: null }],
        metadata: { assumptions: 'test' }
      }]
    };

    applyAuthoritativeMaterialPricing(parsed);

    assert.strictEqual(parsed.lineItems[0].materials[0].unitCost, 9.99);
    assert.strictEqual(parsed.lineItems[0].materials[0].qty, 500);
    assert.strictEqual(parsed.lineItems[0].materials[0].unit, '');
  });
});
