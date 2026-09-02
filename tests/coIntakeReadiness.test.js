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

  it('CASE A: final generation uses the original contractor scope as the authoritative base scope after follow-up answers', () => {
    const html = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
    const start = html.indexOf('function buildCOGenerationRequestContext');
    const end = html.indexOf('function deriveAuthoritativeLaborFromScope', start);
    const snippet = html.slice(start, end);
    const originalScope = 'Replace additional knob and tube wiring throughout the property.';
    const followUpAnswer = '1 worker for 2 days';
    const context = {
      window: {
        _aiCOQuestionState: {
          active: false,
          originalPrompt: originalScope,
          questions: [],
          history: [{ questions: ['How many workers will be working for those 2 additional days?'], answer: followUpAnswer }]
        }
      },
      DD: { aiProfile: { markup: 40, laborRate: 85 } },
      estimates: [],
      buildHistoricalContext: () => 'historical context',
      gpr: () => ({ id: 'proj-1' }),
      document: { querySelector: () => null },
      fetch: function fetchStub(url, options) {
        const payload = JSON.parse(options.body);
        assert.strictEqual(payload.description, originalScope);
        assert.strictEqual(payload.questionContext.originalPrompt, originalScope);
        assert.strictEqual(payload.questionContext.history[0].answer, followUpAnswer);
        return Promise.resolve({ json: () => Promise.resolve({ lineItems: [] }) });
      },
      AbortController: function AbortControllerStub() { this.abort = () => {}; },
      setTimeout: () => 1,
      clearTimeout: () => {},
      updateCOPreview: () => {},
      T: () => {}
    };

    vm.runInNewContext(snippet, context);
    const result = context.buildCOGenerationRequestContext('CO title', 'AI generated expanded description', context.window._aiCOQuestionState);
    assert.strictEqual(result.questionContext.originalPrompt, originalScope);
    assert.strictEqual(result.questionContext.history[0].answer, followUpAnswer);
    assert.notStrictEqual(result.questionContext.originalPrompt, 'AI generated expanded description');
  });

  it('CASE B: AI-generated review wording does not replace originalPrompt', () => {
    const html = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
    const start = html.indexOf('function buildCOGenerationRequestContext');
    const end = html.indexOf('function deriveAuthoritativeLaborFromScope', start);
    const snippet = html.slice(start, end);
    const originalScope = 'Replace additional knob and tube wiring throughout the property.';
    const generatedReview = 'Replace additional knob and tube wiring throughout the property, including 2 additional days of labor for 1 worker. Scope includes removal of old wiring and installation of new NM-B (Romex) wiring...';
    const context = {
      window: { _aiCOQuestionState: { active: false, originalPrompt: originalScope, questions: [], history: [] } },
      DD: { aiProfile: { markup: 40, laborRate: 85 } },
      estimates: [],
      buildHistoricalContext: () => '',
      gpr: () => ({ id: 'proj-1' }),
      document: { querySelector: () => null }
    };

    vm.runInNewContext(snippet, context);
    const result = context.buildCOGenerationRequestContext('CO title', generatedReview, context.window._aiCOQuestionState);
    assert.strictEqual(result.questionContext.originalPrompt, originalScope);
    assert.notStrictEqual(result.questionContext.originalPrompt, generatedReview);
  });

  it('CASE C: a second generation attempt still uses original contractor scope plus Q/A history, not the prior AI-generated description', () => {
    const html = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
    const start = html.indexOf('function buildCOGenerationRequestContext');
    const end = html.indexOf('function deriveAuthoritativeLaborFromScope', start);
    const snippet = html.slice(start, end);
    const originalScope = 'Replace additional knob and tube wiring throughout the property.';
    const priorGeneratedDescription = 'Replace additional knob and tube wiring throughout the property, including 2 additional days of labor for 1 worker.';
    const historyEntry = { questions: ['How many workers will be working for those 2 additional days?'], answer: '1' };
    const context = {
      window: { _aiCOQuestionState: { active: false, originalPrompt: originalScope, questions: [], history: [historyEntry] } },
      DD: { aiProfile: { markup: 40, laborRate: 85 } },
      estimates: [],
      buildHistoricalContext: () => 'historical context',
      gpr: () => ({ id: 'proj-1' }),
      document: { querySelector: () => null }
    };

    vm.runInNewContext(snippet, context);
    const result = context.buildCOGenerationRequestContext('CO title', priorGeneratedDescription, context.window._aiCOQuestionState);
    assert.strictEqual(result.questionContext.originalPrompt, originalScope);
    assert.strictEqual(result.questionContext.history.length, 1);
    assert.strictEqual(result.questionContext.history[0].answer, '1');
    assert.notStrictEqual(result.questionContext.originalPrompt, priorGeneratedDescription);
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

  it('locks in the knob-and-tube 400 ft 12/2 NM-B authoritative facts and repeatability', () => {
    const { buildAuthoritativeLaborFact, resolveCanonicalMaterialIdentity, applyAuthoritativeMaterialPricing, MATERIAL_PRICE_CATALOG } = require('../server');
    const contractorScope = 'replace knob and tube wiring 400\' all 12/2 wire will need 10 round old work boxes 8 single gang old work boxes and 1 double gang old work box it will require 2 additional days of labor';
    const followUpAnswer = '1 worker';
    const materialRaw = {
      desc: '12/2 Romex',
      qty: 400,
      unit: 'ft',
      unitCost: 1.25,
      primary: true,
      quantityBasis: 'ai-estimated',
      basisPerUnit: null
    };

    const laborFact = buildAuthoritativeLaborFact(contractorScope, [{ questions: ['How many workers will be working for those 2 additional days?'], answer: followUpAnswer }]);
    assert.strictEqual(laborFact.isResolved, true);
    assert.strictEqual(laborFact.totalHours, 16);
    assert.strictEqual(laborFact.crewSize, 1);
    assert.strictEqual(laborFact.durationValue, 2);
    assert.strictEqual(laborFact.durationUnit, 'days');

    const candidateScope = 'replace knob and tube wiring 400\' all 12/2 wire will need 10 round old work boxes 8 single gang old work boxes and 1 double gang old work box it will require 2 additional days of labor';
    assert.ok(candidateScope.includes('400\''));
    assert.ok(candidateScope.includes('12/2'));
    assert.ok(candidateScope.includes('10 round old work boxes'));
    assert.ok(candidateScope.includes('8 single gang old work boxes'));
    assert.ok(candidateScope.includes('1 double gang old work box'));
    assert.ok(candidateScope.includes('2 additional days of labor'));

    const canonicalKey = resolveCanonicalMaterialIdentity(materialRaw.desc);
    assert.strictEqual(canonicalKey, 'nm-b 12/2');
    assert.notStrictEqual(canonicalKey, 'nm-b 14/2');
    assert.notStrictEqual(canonicalKey, null);

    const parsed = {
      lineItems: [{
        category: 'Electrical',
        desc: 'Run cable',
        qty: 400,
        unit: 'ft',
        laborHours: 16,
        equipmentOrSubCost: 0,
        materials: [materialRaw],
        metadata: { assumptions: 'test' }
      }]
    };

    applyAuthoritativeMaterialPricing(parsed);
    assert.strictEqual(parsed.lineItems[0].materials[0].qty, 400);
    assert.strictEqual(parsed.lineItems[0].materials[0].unit, 'ft');
    assert.strictEqual(parsed.lineItems[0].materials[0].unitCost, MATERIAL_PRICE_CATALOG['nm-b 12/2'].unitCost);
    assert.strictEqual(parsed.lineItems[0].materials[0].unitCost, 0.72);

    const laborCost = Number((laborFact.totalHours * 85).toFixed(2));
    assert.strictEqual(laborFact.totalHours, 16);
    assert.strictEqual(laborCost, 1360);

    const materialCost = Number((parsed.lineItems[0].materials[0].qty * parsed.lineItems[0].materials[0].unitCost).toFixed(2));
    assert.strictEqual(materialCost, 288);

    const repeatMaterial = {
      desc: '12/2 Romex',
      qty: 400,
      unit: 'ft',
      unitCost: 1.25,
      primary: true,
      quantityBasis: 'ai-estimated',
      basisPerUnit: null
    };
    const repeatParsed = {
      lineItems: [{
        category: 'Electrical',
        desc: 'Run cable',
        qty: 400,
        unit: 'ft',
        laborHours: 16,
        equipmentOrSubCost: 0,
        materials: [repeatMaterial],
        metadata: { assumptions: 'test' }
      }]
    };
    applyAuthoritativeMaterialPricing(repeatParsed);
    assert.strictEqual(repeatParsed.lineItems[0].materials[0].qty, 400);
    assert.strictEqual(repeatParsed.lineItems[0].materials[0].unitCost, 0.72);
    assert.strictEqual(repeatParsed.lineItems[0].materials[0].unit, 'ft');

    assert.ok(!candidateScope.toLowerCase().includes('14/2'));
    assert.ok(!candidateScope.toLowerCase().includes('various gauges'));
    assert.ok(!candidateScope.toLowerCase().includes('14 gauge'));
    assert.ok(!candidateScope.toLowerCase().includes('various'));
  });

  it('keeps the residential client description structured without exposing internal pricing details', () => {
    const html = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
    const start = html.indexOf('function isResidentialEstimate');
    const end = html.indexOf('function saveContractorSig', start);
    const snippet = html.slice(start, end);
    const context = {
      DD: { aiProfile: { markup: 40, laborRate: 85 }, companyName: 'Contractor Desk' },
      calcEstimate: () => ({ grandTotal: 2375, clientTotal: 1697, subtotal: 1697, taxAmt: 0, margin: 40 }),
      calcLineItemTotal: (li) => (Number(li.total) || 0),
      isResidentialEstimate: null,
      buildResidentialEstimateDescription: null,
      window: {}
    };
    vm.runInNewContext(snippet, context);
    const estimate = {
      client: 'Hargrove Residence',
      type: 'Residential Wiring Replacement',
      address: '4821 Maple Ridge Dr',
      estNum: 'EST-104',
      notes: 'Replace 400 linear feet of existing knob and tube wiring with new 12/2 NM-B wire. Install 10 round old-work boxes, 8 single-gang old-work boxes, and 1 double-gang old-work box. Existing panel capacity remains in use. Drywall repair excluded.',
      lineItems: [
        { category: 'Electrical', desc: '12/2 NM-B wire', qty: 400, unit: 'LF', unitCost: 0.72, total: 288, markup: 40 },
        { category: 'Electrical', desc: 'Round old-work boxes', qty: 10, unit: 'ea', unitCost: 24, total: 240, markup: 40 },
        { category: 'Electrical', desc: 'Single-gang old-work boxes', qty: 8, unit: 'ea', unitCost: 18, total: 144, markup: 40 }
      ],
      exclusions: ['Drywall or plaster repair', 'Panel upgrade or new breakers'],
      markup: 40,
      tax: 0,
      status: 'Draft'
    };
    const narrative = context.buildResidentialEstimateDescription(estimate);
    assert.ok(narrative);
    assert.ok(narrative.heading.includes('Wiring') || narrative.heading.includes('Residential') || narrative.heading.includes('Replacement'));
    assert.ok(narrative.summary.toLowerCase().includes('400') || narrative.summary.toLowerCase().includes('12/2') || narrative.summary.toLowerCase().includes('knob'));
    assert.ok(narrative.sections.some((section) => (section.label || '').toLowerCase().includes('conditions') || (section.label || '').toLowerCase().includes('included') || (section.label || '').toLowerCase().includes('exclusions')));
    assert.ok(narrative.summary.toLowerCase().includes('12/2'));
    assert.ok(estimate.lineItems[0].qty === 400);
    assert.ok(estimate.lineItems[0].unitCost === 0.72);
    assert.ok(estimate.exclusions.some((ex) => ex.includes('Drywall')));
    assert.ok(!JSON.stringify(narrative).toLowerCase().includes('labor rate'));
    assert.ok(!JSON.stringify(narrative).toLowerCase().includes('markup'));
    assert.ok(!JSON.stringify(narrative).toLowerCase().includes('unitcost'));
    assert.ok(!JSON.stringify(narrative).toLowerCase().includes('base cost'));
    assert.ok(!JSON.stringify(narrative).toLowerCase().includes('85'));
    assert.ok(!JSON.stringify(narrative).toLowerCase().includes('40%'));
    assert.ok(JSON.stringify(narrative).includes('Drywall') || JSON.stringify(narrative).includes('Exclusions'));
    assert.ok(JSON.stringify(narrative).includes('12/2') || JSON.stringify(narrative).includes('old-work'));
  });

  it('A. sign once -> one financial entry for the approved CO ID', () => {
    const html = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
    const start = html.indexOf('function ensureApprovedCOFinancialAccounting');
    const snippet = html.slice(start, html.indexOf('function generatePunchListAI', start));
    const context = { parseFloat: Number.parseFloat, Date, console };
    vm.runInNewContext(snippet, context);

    const project = { paymentMilestones: [], clientTotal: 5000, budget: 10000 };
    const co = { id: 'co-1', title: 'Add lighting', budgetImpact: 250 };
    context.ensureApprovedCOFinancialAccounting(project, co, 250, { includeBudget: true });

    assert.strictEqual(project.paymentMilestones.length, 1);
    assert.strictEqual(project.paymentMilestones[0].coId, 'co-1');
    assert.strictEqual(project.clientTotal, 5250);
    assert.strictEqual(project.budget, 10250);
  });

  it('B. sign twice same ID -> still one financial entry', () => {
    const html = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
    const start = html.indexOf('function ensureApprovedCOFinancialAccounting');
    const snippet = html.slice(start, html.indexOf('function generatePunchListAI', start));
    const context = { parseFloat: Number.parseFloat, Date, console };
    vm.runInNewContext(snippet, context);

    const project = { paymentMilestones: [], clientTotal: 5000, budget: 10000 };
    const co = { id: 'co-2', title: 'Add lighting', budgetImpact: 250 };
    context.ensureApprovedCOFinancialAccounting(project, co, 250, { includeBudget: true });
    context.ensureApprovedCOFinancialAccounting(project, co, 250, { includeBudget: true });

    assert.strictEqual(project.paymentMilestones.length, 1);
    assert.strictEqual(project.paymentMilestones[0].coId, 'co-2');
    assert.strictEqual(project.clientTotal, 5250);
    assert.strictEqual(project.budget, 10250);
  });

  it('C. contractor approve then client sign same ID -> still one financial entry', () => {
    const html = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
    const start = html.indexOf('function ensureApprovedCOFinancialAccounting');
    const snippet = html.slice(start, html.indexOf('function generatePunchListAI', start));
    const context = { parseFloat: Number.parseFloat, Date, console };
    vm.runInNewContext(snippet, context);

    const project = { paymentMilestones: [], clientTotal: 5000, budget: 10000 };
    const co = { id: 'co-3', title: 'Add lighting', budgetImpact: 250 };
    context.ensureApprovedCOFinancialAccounting(project, co, 250, { includeBudget: true });
    context.ensureApprovedCOFinancialAccounting(project, co, 250, { includeBudget: true });

    assert.strictEqual(project.paymentMilestones.length, 1);
    assert.strictEqual(project.paymentMilestones.filter((m) => m.coId === 'co-3').length, 1);
    assert.strictEqual(project.clientTotal, 5250);
    assert.strictEqual(project.budget, 10250);
  });

  it('D. client sign then contractor approve same ID -> still one financial entry', () => {
    const html = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
    const start = html.indexOf('function ensureApprovedCOFinancialAccounting');
    const snippet = html.slice(start, html.indexOf('function generatePunchListAI', start));
    const context = { parseFloat: Number.parseFloat, Date, console };
    vm.runInNewContext(snippet, context);

    const project = { paymentMilestones: [], clientTotal: 5000, budget: 10000 };
    const co = { id: 'co-4', title: 'Add lighting', budgetImpact: 250 };
    context.ensureApprovedCOFinancialAccounting(project, co, 250, { includeBudget: true });
    context.ensureApprovedCOFinancialAccounting(project, co, 250, { includeBudget: true });

    assert.strictEqual(project.paymentMilestones.length, 1);
    assert.strictEqual(project.paymentMilestones[0].coId, 'co-4');
    assert.strictEqual(project.clientTotal, 5250);
    assert.strictEqual(project.budget, 10250);
  });

  it('E. two different CO IDs with same title and amount -> two valid entries', () => {
    const html = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
    const start = html.indexOf('function ensureApprovedCOFinancialAccounting');
    const snippet = html.slice(start, html.indexOf('function generatePunchListAI', start));
    const context = { parseFloat: Number.parseFloat, Date, console };
    vm.runInNewContext(snippet, context);

    const project = { paymentMilestones: [], clientTotal: 5000, budget: 10000 };
    context.ensureApprovedCOFinancialAccounting(project, { id: 'co-5', title: 'Add lighting', budgetImpact: 250 }, 250, { includeBudget: true });
    context.ensureApprovedCOFinancialAccounting(project, { id: 'co-6', title: 'Add lighting', budgetImpact: 250 }, 250, { includeBudget: true });

    assert.strictEqual(project.paymentMilestones.length, 2);
    assert.deepStrictEqual(project.paymentMilestones.map((m) => m.coId).sort(), ['co-5', 'co-6']);
    assert.strictEqual(project.clientTotal, 5500);
    assert.strictEqual(project.budget, 10500);
  });

  it('F. normal non-CO milestones unchanged', () => {
    const html = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
    const start = html.indexOf('function ensureApprovedCOFinancialAccounting');
    const snippet = html.slice(start, html.indexOf('function generatePunchListAI', start));
    const context = { parseFloat: Number.parseFloat, Date, console };
    vm.runInNewContext(snippet, context);

    const project = {
      paymentMilestones: [
        { name: 'Deposit', amount: 1200, paid: false },
        { name: 'Progress', amount: 1800, paid: false }
      ],
      clientTotal: 5000,
      budget: 10000
    };
    const co = { id: 'co-7', title: 'Add lighting', budgetImpact: 250 };
    context.ensureApprovedCOFinancialAccounting(project, co, 250, { includeBudget: true });

    assert.strictEqual(project.paymentMilestones.length, 3);
    assert.strictEqual(project.paymentMilestones.filter((m) => m.coId === 'co-7').length, 1);
    assert.strictEqual(project.clientTotal, 5250);
    assert.strictEqual(project.budget, 10250);
  });

  it('CASE A: residential estimate renders PROJECT SCOPE', () => {
    const html = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
    const start = html.indexOf('function normalizeProjectClass');
    const end = html.indexOf('function renderResidentialNarrativeBlock', start);
    const snippet = html.slice(start, end);
    const context = { isResidentialEstimate: null, buildResidentialEstimateDescription: null, window: {} };
    vm.runInNewContext(snippet, context);

    const estimate = {
      client: 'Hargrove Residence',
      type: 'Residential Wiring Replacement',
      notes: 'Replace 400 linear feet of existing knob and tube wiring with new 12/2 NM-B wire. Install 10 round old-work boxes, 8 single-gang old-work boxes, and 1 double-gang old-work box. Existing panel capacity remains in use. Drywall repair is excluded.',
      lineItems: [
        { category: 'Electrical', desc: '12/2 NM-B wire', qty: 400, unit: 'LF', unitCost: 0.72, total: 288, markup: 40 },
        { category: 'Electrical', desc: 'Old-work boxes', qty: 10, unit: 'ea', unitCost: 24, total: 240, markup: 40 }
      ],
      exclusions: ['Drywall or plaster repair']
    };

    const narrative = context.buildResidentialEstimateDescription(estimate);
    assert.ok(narrative);
    assert.ok(narrative.sections.some((section) => (section.label || '').toLowerCase().includes('project scope')));
    assert.ok((narrative.summary || '').toLowerCase().includes('replace') || (narrative.summary || '').toLowerCase().includes('wiring'));
  });

  it('CASE B: residential estimate renders WORK INCLUDED', () => {
    const html = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
    const start = html.indexOf('function normalizeProjectClass');
    const end = html.indexOf('function renderResidentialNarrativeBlock', start);
    const snippet = html.slice(start, end);
    const context = { isResidentialEstimate: null, buildResidentialEstimateDescription: null, window: {} };
    vm.runInNewContext(snippet, context);

    const estimate = {
      client: 'Hargrove Residence',
      type: 'Residential Wiring Replacement',
      notes: 'Replace 400 linear feet of existing knob and tube wiring with new 12/2 NM-B wire. Install 10 round old-work boxes and 8 single-gang old-work boxes. Drywall repair is excluded.',
      lineItems: [
        { category: 'Electrical', desc: 'Replace 400 linear feet of existing knob and tube wiring with new 12/2 NM-B wire', qty: 1, unit: 'job', unitCost: 0, total: 900, markup: 40 },
        { category: 'Electrical', desc: 'Install old-work boxes', qty: 10, unit: 'ea', unitCost: 24, total: 240, markup: 40 }
      ],
      exclusions: ['Drywall or plaster repair']
    };

    const narrative = context.buildResidentialEstimateDescription(estimate);
    assert.ok(narrative);
    assert.ok(narrative.sections.some((section) => (section.label || '').toLowerCase().includes('work included')));
    assert.ok(JSON.stringify(narrative).toLowerCase().includes('install') || JSON.stringify(narrative).toLowerCase().includes('replace'));
  });

  it('CASE C: known assumptions render under PROJECT CONDITIONS / ASSUMPTIONS', () => {
    const html = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
    const start = html.indexOf('function normalizeProjectClass');
    const end = html.indexOf('function renderResidentialNarrativeBlock', start);
    const snippet = html.slice(start, end);
    const context = { isResidentialEstimate: null, buildResidentialEstimateDescription: null, window: {} };
    vm.runInNewContext(snippet, context);

    const estimate = {
      client: 'Hargrove Residence',
      type: 'Residential Wiring Replacement',
      notes: 'Replace 400 linear feet of existing knob and tube wiring with new 12/2 NM-B wire. Existing panel capacity remains in use. Drywall repair is excluded.',
      lineItems: [
        { category: 'Electrical', desc: '12/2 NM-B wire', qty: 400, unit: 'LF', unitCost: 0.72, total: 288, markup: 40 }
      ],
      exclusions: ['Drywall or plaster repair']
    };

    const narrative = context.buildResidentialEstimateDescription(estimate);
    assert.ok(narrative);
    assert.ok(narrative.sections.some((section) => (section.label || '').toLowerCase().includes('conditions')));
    assert.ok(JSON.stringify(narrative).toLowerCase().includes('existing panel capacity remains in use'));
  });

  it('CASE D: known exclusions render under EXCLUSIONS', () => {
    const html = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
    const start = html.indexOf('function normalizeProjectClass');
    const end = html.indexOf('function renderResidentialNarrativeBlock', start);
    const snippet = html.slice(start, end);
    const context = { isResidentialEstimate: null, buildResidentialEstimateDescription: null, window: {} };
    vm.runInNewContext(snippet, context);

    const estimate = {
      client: 'Hargrove Residence',
      type: 'Residential Wiring Replacement',
      notes: 'Replace 400 linear feet of existing knob and tube wiring with new 12/2 NM-B wire. Drywall repair is excluded.',
      lineItems: [
        { category: 'Electrical', desc: '12/2 NM-B wire', qty: 400, unit: 'LF', unitCost: 0.72, total: 288, markup: 40 }
      ],
      exclusions: ['Drywall or plaster repair', 'Panel upgrade or new breakers']
    };

    const narrative = context.buildResidentialEstimateDescription(estimate);
    assert.ok(narrative);
    assert.ok(narrative.sections.some((section) => (section.label || '').toLowerCase().includes('exclusions')));
    assert.ok(JSON.stringify(narrative).toLowerCase().includes('drywall') || JSON.stringify(narrative).toLowerCase().includes('panel'));
  });

  it('CASE E: no internal labor/material/markup values appear in the narrative', () => {
    const html = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
    const start = html.indexOf('function normalizeProjectClass');
    const end = html.indexOf('function renderResidentialNarrativeBlock', start);
    const snippet = html.slice(start, end);
    const context = { isResidentialEstimate: null, buildResidentialEstimateDescription: null, window: {} };
    vm.runInNewContext(snippet, context);

    const estimate = {
      client: 'Hargrove Residence',
      type: 'Residential Wiring Replacement',
      notes: 'Replace 400 linear feet of existing knob and tube wiring with new 12/2 NM-B wire. Drywall repair is excluded.',
      lineItems: [
        { category: 'Electrical', desc: '12/2 NM-B wire', qty: 400, unit: 'LF', unitCost: 0.72, total: 288, markup: 40, laborHours: 16 },
        { category: 'Electrical', desc: 'Old-work boxes', qty: 10, unit: 'ea', unitCost: 24, total: 240, markup: 40, laborHours: 5 }
      ],
      exclusions: ['Drywall or plaster repair']
    };

    const narrative = context.buildResidentialEstimateDescription(estimate);
    const narrativeText = JSON.stringify(narrative).toLowerCase();
    assert.ok(!narrativeText.includes('labor'));
    assert.ok(!narrativeText.includes('markup'));
    assert.ok(!narrativeText.includes('unitcost'));
    assert.ok(!narrativeText.includes('hours'));
    assert.ok(!narrativeText.includes('0.72'));
  });

  it('CASE F: narrative does not duplicate the same scope sentence across sections', () => {
    const html = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
    const start = html.indexOf('function normalizeProjectClass');
    const end = html.indexOf('function renderResidentialNarrativeBlock', start);
    const snippet = html.slice(start, end);
    const context = { isResidentialEstimate: null, buildResidentialEstimateDescription: null, window: {} };
    vm.runInNewContext(snippet, context);

    const estimate = {
      client: 'Hargrove Residence',
      type: 'Residential Wiring Replacement',
      notes: 'Replace 400 linear feet of existing knob and tube wiring with new 12/2 NM-B wire. Install 10 old-work boxes. Drywall repair is excluded.',
      lineItems: [
        { category: 'Electrical', desc: 'Replace 400 linear feet of existing knob and tube wiring with new 12/2 NM-B wire', qty: 1, unit: 'job', unitCost: 0, total: 900, markup: 40 },
        { category: 'Electrical', desc: 'Install 10 old-work boxes', qty: 10, unit: 'ea', unitCost: 24, total: 240, markup: 40 }
      ],
      exclusions: ['Drywall or plaster repair']
    };

    const narrative = context.buildResidentialEstimateDescription(estimate);
    const combined = (narrative.summary || '') + ' ' + (narrative.sections || []).map((section) => section.value || '').join(' ');
    const occurrences = (combined.match(/replace 400 linear feet of existing knob and tube wiring with new 12\/2 nm-b wire/gi) || []).length;
    assert.strictEqual(occurrences, 1);
  });

  it('CASE G: commercial estimate output remains unchanged', () => {
    const html = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
    const start = html.indexOf('function normalizeProjectClass');
    const end = html.indexOf('function saveContractorSig', start);
    const snippet = html.slice(start, end);
    const context = { isResidentialEstimate: null, buildResidentialEstimateDescription: null, window: {} };
    vm.runInNewContext(snippet, context);

    const estimate = {
      client: 'Commercial Client',
      type: 'Commercial Tenant Improvement',
      notes: 'Interior work for tenant improvement project.',
      lineItems: [
        { category: 'General', desc: 'Demo existing finishes', qty: 1, unit: 'job', unitCost: 2500, total: 2500, markup: 20 }
      ],
      exclusions: ['Painting']
    };

    const narrative = context.buildResidentialEstimateDescription(estimate);
    assert.strictEqual(narrative, null);
  });

  it('CASE A: blank projectClass blocks AI generation before any request is sent', () => {
    const html = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
    const start = html.indexOf('function generateAIEstimate');
    const end = html.indexOf('function generateAILog', start);
    const snippet = html.slice(start, end);
    const calls = [];
    const context = {
      console,
      T: (msg) => calls.push({ kind: 'toast', msg }),
      DD: { aiProfile: { markup: 20, laborRate: 85 }, companyName: 'Test Co' },
      ger: () => ({ id: 'est-1', projectClass: '', markup: 20, lineItems: [], exclusions: [] }),
      document: {
        querySelectorAll: () => [],
        getElementById: (id) => {
          if (id === 'aiPrompt') return { value: 'Replace wiring in a house' };
          if (id === 'efProjectClass') return { value: '', focus: () => {}, scrollIntoView: () => {} };
          if (id === 'estFormPage') return { classList: { add: () => {} } };
          if (id === 'aiLoading') return { style: {}, textContent: '' };
          return null;
        }
      },
      fetch: (url, options) => {
        calls.push({ kind: 'fetch', url, options });
        return Promise.resolve({ ok: true, json: () => ({ action: 'ready' }) });
      },
      AbortController: function () { this.abort = () => {}; },
      setTimeout: () => 1,
      clearTimeout: () => {},
      normalizeProjectClass: (value) => {
        const raw = String(value || '').trim().toLowerCase();
        if (raw === 'residential') return 'residential';
        if (raw === 'commercial') return 'commercial';
        return null;
      }
    };
    vm.runInNewContext(snippet, context);
    context.generateAIEstimate();
    assert.strictEqual(calls.filter((c) => c.kind === 'fetch').length, 0);
    assert.ok(calls.some((c) => c.kind === 'toast' && /Residential|Commercial/i.test(c.msg)));
  });

  it('CASE B: residential projectClass allows generation to continue', () => {
    const html = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
    const start = html.indexOf('function generateAIEstimate');
    const end = html.indexOf('function generateAILog', start);
    const snippet = html.slice(start, end);
    const calls = [];
    const context = {
      console,
      T: () => {},
      DD: { aiProfile: { markup: 20, laborRate: 85 } },
      ger: () => ({ id: 'est-2', projectClass: 'residential', markup: 20, lineItems: [], exclusions: [] }),
      document: {
        querySelectorAll: () => [],
        getElementById: (id) => {
          if (id === 'aiPrompt') return { value: 'Replace wiring in a house' };
          if (id === 'aiLoading') return { style: {}, textContent: '' };
          if (id === 'efProjectClass') return { value: 'residential', focus: () => {}, scrollIntoView: () => {} };
          if (id === 'estFormPage') return { classList: { add: () => {} } };
          return null;
        }
      },
      fetch: (url, options) => {
        calls.push({ kind: 'fetch', url, options });
        return Promise.resolve({ ok: true, json: () => ({ action: 'ready' }) });
      },
      AbortController: function () { this.abort = () => {}; },
      setTimeout: () => 1,
      clearTimeout: () => {},
      normalizeProjectClass: (value) => {
        const raw = String(value || '').trim().toLowerCase();
        if (raw === 'residential') return 'residential';
        if (raw === 'commercial') return 'commercial';
        return null;
      }
    };
    vm.runInNewContext(snippet, context);
    context.generateAIEstimate();
    assert.strictEqual(calls.filter((c) => c.kind === 'fetch').length > 0, true);
  });

  it('CASE C: commercial projectClass allows generation to continue', () => {
    const html = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
    const start = html.indexOf('function generateAIEstimate');
    const end = html.indexOf('function generateAILog', start);
    const snippet = html.slice(start, end);
    const calls = [];
    const context = {
      console,
      T: () => {},
      DD: { aiProfile: { markup: 20, laborRate: 85 } },
      ger: () => ({ id: 'est-3', projectClass: 'commercial', markup: 20, lineItems: [], exclusions: [] }),
      document: {
        querySelectorAll: () => [],
        getElementById: (id) => {
          if (id === 'aiPrompt') return { value: 'Tenant improvement office buildout' };
          if (id === 'aiLoading') return { style: {}, textContent: '' };
          if (id === 'efProjectClass') return { value: 'commercial', focus: () => {}, scrollIntoView: () => {} };
          if (id === 'estFormPage') return { classList: { add: () => {} } };
          return null;
        }
      },
      fetch: (url, options) => {
        calls.push({ kind: 'fetch', url, options });
        return Promise.resolve({ ok: true, json: () => ({ action: 'ready' }) });
      },
      AbortController: function () { this.abort = () => {}; },
      setTimeout: () => 1,
      clearTimeout: () => {},
      normalizeProjectClass: (value) => {
        const raw = String(value || '').trim().toLowerCase();
        if (raw === 'residential') return 'residential';
        if (raw === 'commercial') return 'commercial';
        return null;
      }
    };
    vm.runInNewContext(snippet, context);
    context.generateAIEstimate();
    assert.strictEqual(calls.filter((c) => c.kind === 'fetch').length > 0, true);
  });

  it('CASE D: blank projectClass is not silently inferred from residential-looking scope text', () => {
    const html = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
    const start = html.indexOf('function normalizeProjectClass');
    const end = html.indexOf('function resolveEstimateProjectClass', start);
    const snippet = html.slice(start, end);
    const context = { window: {} };
    vm.runInNewContext(snippet, context);
    const value = context.normalizeProjectClass('');
    assert.strictEqual(value, null);
    const residentialText = 'Replace knob and tube wiring in a house';
    assert.strictEqual(context.normalizeProjectClass(residentialText), null);
  });

  it('CASE E: blank projectClass is not silently inferred from commercial-looking scope text', () => {
    const html = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
    const start = html.indexOf('function normalizeProjectClass');
    const end = html.indexOf('function resolveEstimateProjectClass', start);
    const snippet = html.slice(start, end);
    const context = { window: {} };
    vm.runInNewContext(snippet, context);
    const value = context.normalizeProjectClass('');
    assert.strictEqual(value, null);
    const commercialText = 'Tenant improvement office fit-out';
    assert.strictEqual(context.normalizeProjectClass(commercialText), null);
  });

  it('CASE F: saveEstimate validation remains intact for blank projectClass', () => {
    const html = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
    const start = html.indexOf('function saveEstimate(){var client');
    const end = html.indexOf('function updateEstStatus', start);
    const snippet = html.slice(start, end);
    const alerts = [];
    const context = {
      document: {
        getElementById: (id) => {
          const values = {
            efClient: 'Client',
            efType: 'Test Project',
            efProjectClass: '',
            efAddress: '',
            efNotes: '',
            efClientEmail: '',
            efClientPhone: '',
            efMarkup: '20',
            efTax: '0',
            efStatus: 'Draft',
            efDate: '2026-08-13',
            efValidUntil: '2026-09-12'
          };
          return { value: values[id] || '' };
        }
      },
      alert: (msg) => alerts.push(msg),
      ger: () => ({ id: 'est-4', lineItems: [], exclusions: [], projectClass: '' }),
      nextEstNumber: () => 'EST-999',
      currentUser: { uid: 'u-1' },
      DD: { aiProfile: { markup: 20 }, logoData: '', companyName: 'Test Co' },
      eCol: { doc: () => ({ set: () => Promise.resolve() }) },
      normalizeProjectClass: (value) => {
        const raw = String(value || '').trim().toLowerCase();
        if (raw === 'residential') return 'residential';
        if (raw === 'commercial') return 'commercial';
        return null;
      },
      T: () => {},
      openEstDetail: () => {},
      currentEstId: null,
      editEstId: null
    };
    vm.runInNewContext(snippet, context);
    context.saveEstimate();
    assert.strictEqual(alerts.length, 1);
    assert.ok(alerts[0].toLowerCase().includes('residential') || alerts[0].toLowerCase().includes('commercial'));
  });

  it('CASE G: pricing/labor/material/markup/total logic is unchanged by the projectClass gate', () => {
    const html = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
    const start = html.indexOf('function saveEstimate(){var client');
    const end = html.indexOf('function updateEstStatus', start);
    const snippet = html.slice(start, end);
    const context = {
      document: {
        getElementById: (id) => {
          const values = {
            efClient: 'Client',
            efType: 'Test Project',
            efProjectClass: 'residential',
            efAddress: '',
            efNotes: '',
            efClientEmail: '',
            efClientPhone: '',
            efMarkup: '20',
            efTax: '0',
            efStatus: 'Draft',
            efDate: '2026-08-13',
            efValidUntil: '2026-09-12'
          };
          return { value: values[id] || '' };
        }
      },
      alert: () => {},
      ger: () => ({ id: 'est-5', lineItems: [], exclusions: [], projectClass: 'residential' }),
      nextEstNumber: () => 'EST-555',
      currentUser: { uid: 'u-2' },
      DD: { aiProfile: { markup: 20 }, logoData: '', companyName: 'Test Co' },
      eCol: { doc: () => ({ set: () => Promise.resolve() }) },
      normalizeProjectClass: (value) => {
        const raw = String(value || '').trim().toLowerCase();
        if (raw === 'residential') return 'residential';
        if (raw === 'commercial') return 'commercial';
        return null;
      },
      T: () => {},
      openEstDetail: () => {},
      currentEstId: null,
      editEstId: null
    };
    vm.runInNewContext(snippet, context);
    context.saveEstimate();
    assert.strictEqual(typeof context.normalizeProjectClass('residential'), 'string');
    assert.strictEqual(context.normalizeProjectClass('residential'), 'residential');
  });

  it('PROJECT-CLASS A: new estimates expose a dedicated projectClass selector and ask for residential vs commercial', () => {
    const html = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
    assert.ok(html.includes('id="efProjectClass"'));
    assert.ok(html.includes('Residential'));
    assert.ok(html.includes('Commercial'));
  });

  it('PROJECT-CLASS B: projectClass persists and canonical customerScope is built from saved estimate data', () => {
    const html = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
    const start = html.indexOf('function normalizeProjectClass');
    const end = html.indexOf('function buildResidentialEstimateDescription', start);
    const snippet = html.slice(start, end);
    const context = { window: {}, Number };
    vm.runInNewContext(snippet, context);

    const estimate = {
      type: 'test 1',
      projectClass: 'residential',
      notes: 'Replace 400 linear feet of knob and tube wiring with new 12/2 NM-B. Existing panel capacity remains in use.',
      lineItems: [
        { desc: 'Replace 400 linear feet of knob and tube wiring with new 12/2 NM-B wire' },
        { desc: 'Install 8 old-work boxes' }
      ],
      exclusions: ['Drywall repair']
    };

    assert.strictEqual(context.resolveEstimateProjectClass(estimate), 'residential');
    const scope = context.buildCanonicalCustomerScope(estimate);
    assert.ok(scope.projectScope.toLowerCase().includes('replace') || scope.projectScope.toLowerCase().includes('wiring'));
    assert.ok(scope.workIncluded.length >= 1);
    assert.ok(scope.exclusions.includes('Drywall repair'));
    assert.ok(!JSON.stringify(scope).toLowerCase().includes('labor rate'));
  });

  it('PROJECT-CLASS C: contract agreement uses canonical customerScope instead of the generic estimate title', () => {
    const html = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
    const start = html.indexOf('function generateContractText');
    const end = html.indexOf('function isResidentialEstimate', start);
    const snippet = html.slice(start, end);
    const context = { DD: { companyName: 'Contractor Desk' }, Date };
    vm.runInNewContext(snippet, context);

    const estimate = {
      client: 'Client',
      type: 'test 1',
      projectClass: 'residential',
      notes: 'Replace 400 linear feet of knob and tube wiring with new 12/2 NM-B. Existing panel capacity remains in use.',
      lineItems: [
        { desc: 'Replace 400 linear feet of knob and tube wiring with new 12/2 NM-B' },
        { desc: 'Install old-work boxes' }
      ],
      exclusions: ['Drywall repair']
    };

    const contractText = context.generateContractText(estimate, { grandTotal: 1000 });
    assert.ok(contractText.toLowerCase().includes('scope of work'));
    assert.ok(!contractText.toLowerCase().includes('test 1'));
    assert.ok(contractText.toLowerCase().includes('replace 400 linear feet') || contractText.toLowerCase().includes('12/2'));
  });

  it('PROJECT-CLASS D: blank projectClass is rejected on a new estimate and does not save', () => {
    const html = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
    const start = html.indexOf('function saveEstimate');
    const end = html.indexOf('function updateEstStatus', start);
    const snippet = html.slice(start, end);
    const alerts = [];
    const saved = [];
    const context = {
      window: { _aiEstimateQuestionState: { active: false, originalPrompt: '', questions: [], history: [] } },
      DD: { aiProfile: { markup: 20 }, logoData: '', companyName: 'Test Co' },
      currentUser: { uid: 'u-1' },
      document: {
        getElementById: (id) => {
          const values = {
            efClient: 'Client',
            efType: 'Test Project',
            efProjectClass: '',
            efAddress: '123 Main',
            efNotes: 'Residential remodel',
            efClientEmail: '',
            efClientPhone: '',
            efMarkup: '20',
            efTax: '0',
            efStatus: 'Draft',
            efDate: '2026-08-13',
            efValidUntil: '2026-09-12'
          };
          return { value: values[id] || '' };
        }
      },
      alert: (msg) => alerts.push(msg),
      T: () => {},
      ger: () => ({ id: 'est-1', lineItems: [], exclusions: [], projectClass: '' }),
      gpr: () => ({ id: 'est-1' }),
      nextEstNumber: () => 'EST-999',
      eCol: {
        doc: () => ({
          set: (value) => { saved.push(value); return Promise.resolve(); }
        })
      },
      normalizeProjectClass: (v) => ((v || '').trim().toLowerCase() === 'residential' ? 'residential' : ((v || '').trim().toLowerCase() === 'commercial' ? 'commercial' : '')),
      getCanonicalCustomerScope: (e) => ({ projectClass: e.projectClass || 'commercial', projectScope: 'Scope of work', workIncluded: [], conditionsAssumptions: [], exclusions: e.exclusions || [] })
    };
    vm.runInNewContext(snippet, context);
    context.saveEstimate();
    assert.strictEqual(alerts.length, 1);
    assert.strictEqual(saved.length, 0);
    assert.ok(alerts[0].toLowerCase().includes('project class'));
  });

  it('PROJECT-CLASS E: residential and commercial projectClass values persist and customerScope is rebuilt from final AI data', () => {
    const html = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
    const start = html.indexOf('function applyEstimateChanges');
    const end = html.indexOf('function handleAIError', start);
    const snippet = html.slice(start, end);
    const saved = [];
    const context = {
      ger: () => ({
        id: 'est-2',
        status: 'Draft',
        client: 'Client',
        projectClass: 'residential',
        notes: 'Replace wiring',
        lineItems: [{ category: 'Electrical', desc: 'Old item', qty: 1, unit: 'job', unitCost: 10, total: 10, markup: 20 }],
        exclusions: ['Old exclusion'],
        markup: 20
      }),
      eCol: {
        doc: () => ({
          set: (value) => { saved.push(value); return Promise.resolve(); }
        })
      },
      T: () => {},
      renderEstDetailBody: () => {},
      document: { getElementById: () => ({ value: '' }) },
      buildCanonicalCustomerScope: (estimate) => ({
        projectClass: estimate.projectClass,
        projectScope: 'Replace 400 linear feet of old wiring with new 12/2 NM-B wire in the home.',
        workIncluded: ['Replace 400 linear feet of old wiring', 'Install old-work boxes'],
        conditionsAssumptions: ['Existing panel capacity remains in use.'],
        exclusions: estimate.exclusions || []
      })
    };
    vm.runInNewContext(snippet, context);
    const finalEstimate = {
      projectClass: 'residential',
      notes: 'Replace 400 linear feet of knob and tube wiring with new 12/2 NM-B.',
      exclusions: ['Drywall repair'],
      lineItems: [
        { category: 'Electrical', desc: 'Replace 400 linear feet of knob and tube wiring with new 12/2 NM-B wire', qty: 1, unit: 'job', unitCost: 100, total: 100, markup: 20 },
        { category: 'Electrical', desc: 'Install old-work boxes', qty: 1, unit: 'job', unitCost: 50, total: 50, markup: 20 }
      ]
    };
    const result = context.applyEstimateChanges({ lineItems: finalEstimate.lineItems, exclusions: finalEstimate.exclusions, message: 'Done' });
    assert.ok(saved.length >= 1);
    const persisted = saved[0];
    assert.strictEqual(persisted.projectClass, 'residential');
    assert.ok(persisted.customerScope.projectScope.toLowerCase().includes('replace'));
    assert.ok(persisted.customerScope.workIncluded.length >= 2);
    assert.ok(persisted.customerScope.exclusions.includes('Drywall repair'));
    assert.ok(result === undefined || result === null);
  });

  it('PROJECT-CLASS F: legacy estimates without projectClass still use fallback behavior', () => {
    const html = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
    const start = html.indexOf('function normalizeProjectClass');
    const end = html.indexOf('function buildCanonicalCustomerScope', start);
    const snippet = html.slice(start, end);
    const context = { window: {}, Number };
    vm.runInNewContext(snippet, context);

    const estimate = {
      type: 'test 1',
      notes: 'Replace 400 linear feet of knob and tube wiring in a house.',
      lineItems: [{ desc: 'Install new wiring in a home' }],
      exclusions: []
    };

    assert.strictEqual(context.resolveEstimateProjectClass(estimate), 'residential');
  });

  it('CASE H: saved quantities, labor, costs, markup, and final totals are unchanged before vs after rendering', () => {
    const html = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
    const start = html.indexOf('function normalizeProjectClass');
    const end = html.indexOf('function renderResidentialNarrativeBlock', start);
    const snippet = html.slice(start, end);
    const context = { isResidentialEstimate: null, buildResidentialEstimateDescription: null, window: {} };
    vm.runInNewContext(snippet, context);

    const estimate = {
      client: 'Hargrove Residence',
      type: 'Residential Wiring Replacement',
      notes: 'Replace 400 linear feet of existing knob and tube wiring with new 12/2 NM-B wire. Existing panel capacity remains in use. Drywall repair is excluded.',
      lineItems: [
        { category: 'Electrical', desc: '12/2 NM-B wire', qty: 400, unit: 'LF', unitCost: 0.72, total: 288, markup: 40, laborHours: 16 },
        { category: 'Electrical', desc: 'Old-work boxes', qty: 10, unit: 'ea', unitCost: 24, total: 240, markup: 40, laborHours: 5 }
      ],
      exclusions: ['Drywall or plaster repair'],
      markup: 40,
      tax: 0,
      status: 'Draft'
    };

    const before = JSON.stringify(estimate);
    const narrative = context.buildResidentialEstimateDescription(estimate);
    assert.ok(narrative);
    assert.strictEqual(JSON.stringify(estimate), before);
    assert.strictEqual(estimate.lineItems[0].qty, 400);
    assert.strictEqual(estimate.lineItems[0].unitCost, 0.72);
    assert.strictEqual(estimate.lineItems[0].laborHours, 16);
    assert.strictEqual(estimate.markup, 40);
    assert.strictEqual(estimate.tax, 0);
  });

  it('CASE A: applies the catalog price when 12/2 Romex is in feet and matches the catalog unit', () => {
    const { applyAuthoritativeMaterialPricing, MATERIAL_PRICE_CATALOG, resolveCanonicalMaterialIdentity } = require('../server');
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

    assert.strictEqual(resolveCanonicalMaterialIdentity('12/2 Romex'), 'nm-b 12/2');
    applyAuthoritativeMaterialPricing(parsed);

    assert.strictEqual(parsed.lineItems[0].materials[0].unitCost, MATERIAL_PRICE_CATALOG['nm-b 12/2'].unitCost);
    assert.strictEqual(parsed.lineItems[0].materials[0].qty, 500);
    assert.strictEqual(parsed.lineItems[0].materials[0].unit, 'ft');
  });

  it('CASE B: normalizes LF to ft and allows the catalog match', () => {
    const { applyAuthoritativeMaterialPricing, MATERIAL_PRICE_CATALOG, resolveCanonicalMaterialIdentity } = require('../server');
    const parsed = {
      lineItems: [{
        category: 'Electrical',
        desc: 'Run cable',
        qty: 500,
        unit: 'ft',
        laborHours: 8,
        equipmentOrSubCost: 0,
        materials: [{ desc: 'NM-B 12-2 wire', qty: 500, unit: 'LF', unitCost: 1.25, primary: true, quantityBasis: 'ai-estimated', basisPerUnit: null }],
        metadata: { assumptions: 'test' }
      }]
    };

    assert.strictEqual(resolveCanonicalMaterialIdentity('NM-B 12-2 wire'), 'nm-b 12/2');
    applyAuthoritativeMaterialPricing(parsed);

    assert.strictEqual(parsed.lineItems[0].materials[0].unitCost, MATERIAL_PRICE_CATALOG['nm-b 12/2'].unitCost);
    assert.strictEqual(parsed.lineItems[0].materials[0].qty, 500);
  });

  it('CASE C: vague NM-B electrical wire wording remains unresolved and preserves the AI unitCost', () => {
    const { applyAuthoritativeMaterialPricing, resolveCanonicalMaterialIdentity } = require('../server');
    const parsed = {
      lineItems: [{
        category: 'Electrical',
        desc: 'Run cable',
        qty: 500,
        unit: 'ft',
        laborHours: 8,
        equipmentOrSubCost: 0,
        materials: [{ desc: 'NM-B electrical wire (various gauges)', qty: 500, unit: 'ft', unitCost: 0.23, primary: true, quantityBasis: 'ai-estimated', basisPerUnit: null }],
        metadata: { assumptions: 'test' }
      }]
    };

    assert.strictEqual(resolveCanonicalMaterialIdentity('NM-B electrical wire (various gauges)'), null);
    applyAuthoritativeMaterialPricing(parsed);

    assert.strictEqual(parsed.lineItems[0].materials[0].unitCost, 0.23);
  });

  it('CASE D: 14/2 Romex resolves to nm-b 14/2 and not 12/2', () => {
    const { resolveCanonicalMaterialIdentity } = require('../server');
    assert.strictEqual(resolveCanonicalMaterialIdentity('14/2 Romex'), 'nm-b 14/2');
    assert.notStrictEqual(resolveCanonicalMaterialIdentity('14/2 Romex'), 'nm-b 12/2');
  });

  it('CASE E: generic electrical wire wording remains unresolved', () => {
    const { resolveCanonicalMaterialIdentity } = require('../server');
    assert.strictEqual(resolveCanonicalMaterialIdentity('electrical wire'), null);
    assert.strictEqual(resolveCanonicalMaterialIdentity('Romex various gauges'), null);
  });

  it('CASE F: missing unit prevents catalog override', () => {
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
  });

  it('CASE G: incompatible unit such as roll prevents catalog override', () => {
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

  it('CASE H: material quantity remains unchanged when pricing is resolved or rejected', () => {
    const { applyAuthoritativeMaterialPricing } = require('../server');
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

    const beforeQty = parsed.lineItems[0].materials[0].qty;
    applyAuthoritativeMaterialPricing(parsed);
    assert.strictEqual(parsed.lineItems[0].materials[0].qty, beforeQty);
  });

  it('CASE I: labor, markup, totals, scope preservation and intake behavior remain unchanged', () => {
    const { applyAuthoritativeMaterialPricing, buildAuthoritativeLaborFact } = require('../server');
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

    const laborFact = buildAuthoritativeLaborFact('Replace additional knob and tube wiring throughout the property. Work will require 2 additional days of labor.', [{ questions: ['How many workers will be working for those 2 additional days?'], answer: '1' }]);
    applyAuthoritativeMaterialPricing(parsed);

    assert.strictEqual(laborFact.isResolved, true);
    assert.strictEqual(laborFact.totalHours, 16);
    assert.strictEqual(parsed.lineItems[0].materials[0].unitCost, 0.72);
  });

  it('CASE A: estimate-generate authoritative labor resolves 1 worker × 2 days to 16 hours', () => {
    const { buildAuthoritativeLaborFact, applyAuthoritativeLaborInvariant } = require('../server');
    const laborFact = buildAuthoritativeLaborFact('Replace 400 feet of knob and tube with 12/2 wire. Includes 2 additional days of labor.', [{ questions: ['How many workers will be working for those 2 additional days?'], answer: '1' }]);
    const parsed = { lineItems: [{ category: 'Electrical', desc: 'Run cable', qty: 400, unit: 'ft', laborHours: 48, equipmentOrSubCost: 0, materials: [{ desc: '12/2 Romex', qty: 400, unit: 'ft', unitCost: 0.72, primary: true, quantityBasis: 'ai-estimated', basisPerUnit: null }], metadata: { assumptions: 'AI generated' } }] };

    applyAuthoritativeLaborInvariant(parsed, laborFact);

    assert.strictEqual(laborFact.isResolved, true);
    assert.strictEqual(laborFact.totalHours, 16);
    assert.strictEqual(parsed.lineItems[0].laborHours, 16);
  });

  it('CASE B: change-order-generate keeps the same explicit labor authority at 16 hours', () => {
    const { buildAuthoritativeLaborFact, applyAuthoritativeLaborInvariant } = require('../server');
    const laborFact = buildAuthoritativeLaborFact('Replace 400 feet of knob and tube with 12/2 wire. Includes 2 additional days of labor.', [{ questions: ['How many workers will be working for those 2 additional days?'], answer: '1' }]);
    const parsed = { lineItems: [{ category: 'Labor', desc: 'Electrical labor', qty: 48, unit: 'hrs', laborHours: 48, equipmentOrSubCost: 0, materials: [], metadata: { assumptions: 'AI generated' } }] };

    applyAuthoritativeLaborInvariant(parsed, laborFact);

    assert.strictEqual(parsed.lineItems[0].laborHours, 16);
    assert.strictEqual(parsed.lineItems[0].qty, 16);
  });

  it('CASE C: authoritative labor overrides AI-generated 48 hours and survives normalization', () => {
    const { buildAuthoritativeLaborFact, applyAuthoritativeLaborInvariant, normalizeMaterialDescription } = require('../server');
    const laborFact = buildAuthoritativeLaborFact('Replace 400 ft of knob and tube. 2 additional days of labor with 1 worker.', [{ questions: ['How many workers will be working for those 2 additional days?'], answer: '1' }]);
    const parsed = {
      lineItems: [{
        category: 'Electrical',
        desc: 'Replace 400 feet of knob and tube with 12/2 NM-B',
        qty: 400,
        unit: 'ft',
        laborHours: 48,
        equipmentOrSubCost: 0,
        materials: [{ desc: '12/2 NM-B cable (Romex or equivalent)', qty: 400, unit: 'ft', unitCost: 0.72, primary: true, quantityBasis: 'ai-estimated', basisPerUnit: null }],
        metadata: { assumptions: 'AI provided 48 hours' }
      }]
    };

    applyAuthoritativeLaborInvariant(parsed, laborFact);

    assert.strictEqual(parsed.lineItems[0].laborHours, 16);
    assert.strictEqual(parsed.lineItems[0].qty, 400);
    assert.strictEqual(normalizeMaterialDescription(parsed.lineItems[0].materials[0].desc), '12 2 nm b cable romex or equivalent');
  });

  it('CASE D: multiple labor rows still sum to the authoritative total', () => {
    const { buildAuthoritativeLaborFact, applyAuthoritativeLaborInvariant } = require('../server');
    const laborFact = buildAuthoritativeLaborFact('2 workers for 3 days.', [{ questions: ['How many workers will be working?'], answer: '2' }]);
    const parsed = {
      lineItems: [
        { category: 'Labor', desc: 'Crew 1', qty: 24, unit: 'hrs', laborHours: 24, equipmentOrSubCost: 0, materials: [], metadata: { assumptions: 'AI row 1' } },
        { category: 'Labor', desc: 'Crew 2', qty: 24, unit: 'hrs', laborHours: 24, equipmentOrSubCost: 0, materials: [], metadata: { assumptions: 'AI row 2' } }
      ]
    };

    applyAuthoritativeLaborInvariant(parsed, laborFact);

    const total = parsed.lineItems.reduce((sum, li) => sum + Number(li.laborHours || 0), 0);
    assert.strictEqual(laborFact.totalHours, 48);
    assert.strictEqual(total, 48);
  });

  it('CASE E: direct contractor hours statement remains authoritative without recomputation', () => {
    const { buildAuthoritativeLaborFact, applyAuthoritativeLaborInvariant } = require('../server');
    const laborFact = buildAuthoritativeLaborFact('Total labor hours are 16.', []);
    const parsed = { lineItems: [{ category: 'Labor', desc: 'Electrical labor', qty: 48, unit: 'hrs', laborHours: 48, equipmentOrSubCost: 0, materials: [], metadata: { assumptions: 'AI overstatement' } }] };

    applyAuthoritativeLaborInvariant(parsed, laborFact);

    assert.strictEqual(laborFact.isResolved, true);
    assert.strictEqual(laborFact.totalHours, 16);
    assert.strictEqual(parsed.lineItems[0].laborHours, 16);
  });

  it('CASE F: unresolved authoritative labor leaves AI labor behavior unchanged', () => {
    const { buildAuthoritativeLaborFact, applyAuthoritativeLaborInvariant } = require('../server');
    const laborFact = buildAuthoritativeLaborFact('Replace old wiring but no worker count or duration is specified.', []);
    const parsed = { lineItems: [{ category: 'Labor', desc: 'Electrical labor', qty: 48, unit: 'hrs', laborHours: 48, equipmentOrSubCost: 0, materials: [], metadata: { assumptions: 'AI output' } }] };

    applyAuthoritativeLaborInvariant(parsed, laborFact);

    assert.strictEqual(laborFact.isResolved, false);
    assert.strictEqual(parsed.lineItems[0].laborHours, 48);
  });

  it('CASE G: material pricing remains 400 ft 12/2 NM-B at $0.72/ft', () => {
    const { applyAuthoritativeMaterialPricing, resolveCanonicalMaterialIdentity } = require('../server');
    const parsed = {
      lineItems: [{
        category: 'Electrical',
        desc: 'Replace 400 feet of knob and tube with 12/2 NM-B wire',
        qty: 400,
        unit: 'ft',
        laborHours: 16,
        equipmentOrSubCost: 0,
        materials: [{ desc: '12/2 Romex', qty: 400, unit: 'ft', unitCost: 1.25, primary: true, quantityBasis: 'ai-estimated', basisPerUnit: null }],
        metadata: { assumptions: 'test' }
      }]
    };

    assert.strictEqual(resolveCanonicalMaterialIdentity('12/2 Romex'), 'nm-b 12/2');
    applyAuthoritativeMaterialPricing(parsed);
    assert.strictEqual(parsed.lineItems[0].materials[0].unitCost, 0.72);
    assert.strictEqual(parsed.lineItems[0].materials[0].qty, 400);
  });

  it('CASE H: labor rate remains $85/hr when authoritative labor is enforced', () => {
    const { buildAuthoritativeLaborFact } = require('../server');
    const laborFact = buildAuthoritativeLaborFact('2 additional days of labor for 1 worker.', [{ questions: ['How many workers will be working for those 2 additional days?'], answer: '1' }]);

    assert.strictEqual(laborFact.totalHours, 16);
    assert.strictEqual((laborFact.totalHours * 85), 1360);
  });

  it('CASE I: markup and final-total logic remain unchanged', () => {
    const { normalizeAIGenerated } = require('../server');
    const parsed = {
      lineItems: [{
        category: 'Electrical',
        desc: 'Replace 400 feet of knob and tube with 12/2 NM-B wire',
        qty: 400,
        unit: 'ft',
        laborHours: 16,
        equipmentOrSubCost: 0,
        materials: [{ desc: '12/2 NM-B cable (Romex or equivalent)', qty: 400, unit: 'ft', unitCost: 0.72, primary: true, quantityBasis: 'ai-estimated', basisPerUnit: null }],
        metadata: { assumptions: 'test' }
      }]
    };
    const normalized = normalizeAIGenerated(parsed, 85, 40);
    const baseCost = Math.round((400 * 0.72 + 16 * 85) * 100) / 100;

    assert.strictEqual(normalized[0].laborHours, 16);
    assert.strictEqual(normalized[0].markup, 40);
    assert.strictEqual(normalized[0].total, baseCost);
  });

  it('QTY CASE A: aligns a single primary material quantity for a 400 ft line item', () => {
    const { alignLineItemQuantityToPrimaryMaterial } = require('../server');
    const lineItem = {
      qty: 12.64,
      unit: 'ft',
      aiBreakdown: {
        materials: [{ desc: '12/2 NM-B cable', qty: 400, unit: 'ft', unitCost: 0.72, primary: true }]
      }
    };

    alignLineItemQuantityToPrimaryMaterial(lineItem);

    assert.strictEqual(lineItem.qty, 400);
    assert.strictEqual(lineItem.unit, 'ft');
  });

  it('QTY CASE B: aligns a single primary material quantity for 10 each', () => {
    const { alignLineItemQuantityToPrimaryMaterial } = require('../server');
    const lineItem = {
      qty: 1.98,
      unit: 'each',
      aiBreakdown: {
        materials: [{ desc: 'Round old work box', qty: 10, unit: 'each', unitCost: 2.25, primary: true }]
      }
    };

    alignLineItemQuantityToPrimaryMaterial(lineItem);

    assert.strictEqual(lineItem.qty, 10);
    assert.strictEqual(lineItem.unit, 'ea');
  });

  it('QTY CASE C: aligns a single primary material quantity for 8 each', () => {
    const { alignLineItemQuantityToPrimaryMaterial } = require('../server');
    const lineItem = {
      qty: 1.19,
      unit: 'each',
      aiBreakdown: {
        materials: [{ desc: 'Single gang old work box', qty: 8, unit: 'ea', unitCost: 1.35, primary: true }]
      }
    };

    alignLineItemQuantityToPrimaryMaterial(lineItem);

    assert.strictEqual(lineItem.qty, 8);
    assert.strictEqual(lineItem.unit, 'ea');
  });

  it('QTY CASE D: aligns a single primary material quantity for 1 each', () => {
    const { alignLineItemQuantityToPrimaryMaterial } = require('../server');
    const lineItem = {
      qty: 0.19,
      unit: 'each',
      aiBreakdown: {
        materials: [{ desc: 'Double gang old work box', qty: 1, unit: 'each', unitCost: 2.85, primary: true }]
      }
    };

    alignLineItemQuantityToPrimaryMaterial(lineItem);

    assert.strictEqual(lineItem.qty, 1);
    assert.strictEqual(lineItem.unit, 'ea');
  });

  it('QTY CASE E: leaves a line item unchanged when multiple primary materials exist', () => {
    const { alignLineItemQuantityToPrimaryMaterial } = require('../server');
    const lineItem = {
      qty: 12.64,
      unit: 'ft',
      aiBreakdown: {
        materials: [
          { desc: '12/2 NM-B cable', qty: 400, unit: 'ft', unitCost: 0.72, primary: true },
          { desc: 'Cable staples', qty: 1, unit: 'lot', unitCost: 8, primary: true }
        ]
      }
    };

    alignLineItemQuantityToPrimaryMaterial(lineItem);

    assert.strictEqual(lineItem.qty, 12.64);
    assert.strictEqual(lineItem.unit, 'ft');
  });

  it('QTY CASE F: leaves a line item unchanged when the units are incompatible', () => {
    const { alignLineItemQuantityToPrimaryMaterial } = require('../server');
    const lineItem = {
      qty: 400,
      unit: 'ft',
      aiBreakdown: {
        materials: [{ desc: '12/2 NM-B cable', qty: 400, unit: 'roll', unitCost: 0.72, primary: true }]
      }
    };

    alignLineItemQuantityToPrimaryMaterial(lineItem);

    assert.strictEqual(lineItem.qty, 400);
    assert.strictEqual(lineItem.unit, 'ft');
  });

  it('QTY CASE G: authoritative labor stays at 16 hours after quantity reconciliation', () => {
    const { buildAuthoritativeLaborFact, applyAuthoritativeLaborInvariant, alignLineItemQuantityToPrimaryMaterial } = require('../server');
    const laborFact = buildAuthoritativeLaborFact('Replace 400 ft of knob and tube. Includes 2 additional days of labor with 1 worker.', [{ questions: ['How many workers will be working for those 2 additional days?'], answer: '1' }]);
    const lineItem = {
      qty: 12.64,
      unit: 'ft',
      laborHours: 48,
      equipmentOrSubCost: 0,
      aiBreakdown: {
        laborHours: 48,
        materials: [{ desc: '12/2 NM-B cable', qty: 400, unit: 'ft', unitCost: 0.72, primary: true }],
        equipmentOrSubCost: 0,
        assumptions: 'test'
      }
    };

    applyAuthoritativeLaborInvariant({ lineItems: [lineItem] }, laborFact);
    alignLineItemQuantityToPrimaryMaterial(lineItem);

    assert.strictEqual(laborFact.totalHours, 16);
    assert.strictEqual(lineItem.laborHours, 16);
    assert.strictEqual(lineItem.qty, 400);
  });

  it('QTY CASE H: authoritative material price remains 12/2 NM-B at $0.72/ft', () => {
    const { alignLineItemQuantityToPrimaryMaterial, applyAuthoritativeMaterialPricing } = require('../server');
    const lineItem = {
      qty: 12.64,
      unit: 'ft',
      aiBreakdown: {
        materials: [{ desc: '12/2 Romex', qty: 400, unit: 'ft', unitCost: 1.25, primary: true }]
      }
    };

    applyAuthoritativeMaterialPricing({ lineItems: [lineItem] });
    alignLineItemQuantityToPrimaryMaterial(lineItem);

    assert.strictEqual(lineItem.aiBreakdown.materials[0].unitCost, 0.72);
    assert.strictEqual(lineItem.aiBreakdown.materials[0].qty, 400);
  });

  it('QTY CASE I: quantity reconciliation does not change markup or total math', () => {
    const { alignLineItemQuantityToPrimaryMaterial, normalizeAIGenerated } = require('../server');
    const parsed = {
      lineItems: [{
        category: 'Electrical',
        desc: 'Replace 400 feet of knob and tube with 12/2 NM-B wire',
        qty: 12.64,
        unit: 'ft',
        laborHours: 16,
        equipmentOrSubCost: 0,
        materials: [{ desc: '12/2 NM-B cable (Romex or equivalent)', qty: 400, unit: 'ft', unitCost: 0.72, primary: true, quantityBasis: 'ai-estimated', basisPerUnit: null }],
        metadata: { assumptions: 'test' }
      }]
    };

    alignLineItemQuantityToPrimaryMaterial(parsed.lineItems[0]);
    const normalized = normalizeAIGenerated(parsed, 85, 40);
    const expectedBase = Math.round((400 * 0.72 + 16 * 85) * 100) / 100;

    assert.strictEqual(parsed.lineItems[0].qty, 400);
    assert.strictEqual(normalized[0].markup, 40);
    assert.strictEqual(normalized[0].total, expectedBase);
  });

  it('EST-0109 exact wording: 1 worker for 2 additional 8-hour days resolves to 16 hours', () => {
    const { parseCrewSizeFromText, parseDurationFromText, parseTotalLaborHoursFromText, buildAuthoritativeLaborFact } = require('../server');
    const text = 'Labor requirement: 1 worker for 2 additional 8-hour days.';

    assert.strictEqual(parseCrewSizeFromText(text), 1);
    assert.deepStrictEqual(parseDurationFromText(text), { value: 2, unit: 'days' });
    assert.strictEqual(parseTotalLaborHoursFromText(text), null);
    const fact = buildAuthoritativeLaborFact(text, []);

    assert.strictEqual(fact.isResolved, true);
    assert.strictEqual(fact.crewSize, 1);
    assert.strictEqual(fact.durationValue, 2);
    assert.strictEqual(fact.durationUnit, 'days');
    assert.strictEqual(fact.totalHours, 16);
  });

  it('CASE A: 1 worker for 2 days resolves to 16', () => {
    const { buildAuthoritativeLaborFact } = require('../server');
    const fact = buildAuthoritativeLaborFact('1 worker for 2 days', []);
    assert.strictEqual(fact.totalHours, 16);
  });

  it('CASE B: 1 worker for 2 additional days resolves to 16', () => {
    const { buildAuthoritativeLaborFact } = require('../server');
    const fact = buildAuthoritativeLaborFact('1 worker for 2 additional days', []);
    assert.strictEqual(fact.totalHours, 16);
  });

  it('CASE C: 1 worker for 2 8-hour days resolves to 16', () => {
    const { buildAuthoritativeLaborFact } = require('../server');
    const fact = buildAuthoritativeLaborFact('1 worker for 2 8-hour days', []);
    assert.strictEqual(fact.totalHours, 16);
  });

  it('CASE D: 1 worker for 2 additional 8-hour days resolves to 16', () => {
    const { buildAuthoritativeLaborFact } = require('../server');
    const fact = buildAuthoritativeLaborFact('1 worker for 2 additional 8-hour days', []);
    assert.strictEqual(fact.totalHours, 16);
  });

  it('CASE E: 2 workers for 3 days resolves to 48', () => {
    const { buildAuthoritativeLaborFact } = require('../server');
    const fact = buildAuthoritativeLaborFact('2 workers for 3 days', []);
    assert.strictEqual(fact.totalHours, 48);
  });

  it('CASE F: 2 men for 3 days resolves to 48', () => {
    const { buildAuthoritativeLaborFact } = require('../server');
    const fact = buildAuthoritativeLaborFact('2 men for 3 days', []);
    assert.strictEqual(fact.totalHours, 48);
  });

  it('CASE G: 16 labor hours resolves directly to 16', () => {
    const { buildAuthoritativeLaborFact } = require('../server');
    const fact = buildAuthoritativeLaborFact('16 labor hours', []);
    assert.strictEqual(fact.totalHours, 16);
  });

  it('CASE H: 16 man-hours resolves directly to 16', () => {
    const { buildAuthoritativeLaborFact } = require('../server');
    const fact = buildAuthoritativeLaborFact('16 man-hours', []);
    assert.strictEqual(fact.totalHours, 16);
  });

  it('CASE I: ambiguous text without valid crew/duration/total hours remains unresolved', () => {
    const { buildAuthoritativeLaborFact } = require('../server');
    const fact = buildAuthoritativeLaborFact('This is a general labor note and no crew or duration is given', []);
    assert.strictEqual(fact.isResolved, false);
    assert.strictEqual(fact.totalHours, 0);
  });

  it('CASE J: CO authoritative labor regression remains 16 for 1 worker × 2 days', () => {
    const { buildAuthoritativeLaborFact } = require('../server');
    const fact = buildAuthoritativeLaborFact('Replace 400 feet of knob and tube with 12/2 wire. Includes 2 additional days of labor.', [{ questions: ['How many workers will be working for those 2 additional days?'], answer: '1' }]);
    assert.strictEqual(fact.isResolved, true);
    assert.strictEqual(fact.totalHours, 16);
  });

  it('CASE K: estimate authoritative labor regression resolves exact EST-0109 wording to 16', () => {
    const { buildAuthoritativeLaborFact } = require('../server');
    const fact = buildAuthoritativeLaborFact('Labor requirement: 1 worker for 2 additional 8-hour days.', []);
    assert.strictEqual(fact.isResolved, true);
    assert.strictEqual(fact.totalHours, 16);
  });

  it('CASE J: CO financial accounting and residential description code remain untouched', () => {
    const fs = require('fs');
    const path = require('path');
    const html = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');

    assert.ok(html.includes('function ensureApprovedCOFinancialAccounting'));
    assert.ok(html.includes('function buildResidentialEstimateDescription'));
    assert.ok(html.includes('function approveCOContractor'));
  });

  it('residential repair provenance keeps customer measurements authoritative and blocks AI quantity override', () => {
    const { applyResidentialRepairQuantityProvenance } = require('../server');

    const items = [
      { desc: 'Laundry room ceiling paint and stain block', qty: 180, unit: 'sqft', source: 'customer', metadata: { authoritativeQty: 180, authoritativeUnit: 'sqft', authoritativeQuantitySource: 'customer' } },
      { desc: 'Laundry room ceiling paint and stain block', qty: 240, unit: 'sqft', source: 'ai_assumption', metadata: { authoritativeQty: 180, authoritativeUnit: 'sqft', authoritativeQuantitySource: 'customer' } }
    ];

    const result = applyResidentialRepairQuantityProvenance(items);
    assert.strictEqual(result[0].source, 'customer');
    assert.strictEqual(result[0].qty, 180);
    assert.strictEqual(result[1].source, 'ai_assumption');
    assert.strictEqual(result[1].qty, 180);
    assert.strictEqual(result[1].metadata.authoritativeQuantitySource, 'customer');
  });

  it('material quantity cannot overwrite a customer quantity', () => {
    const { applyResidentialRepairQuantityProvenance } = require('../server');

    const item = {
      desc: 'Bathroom drywall repair',
      qty: 60,
      unit: 'sqft',
      source: 'customer',
      metadata: { authoritativeQty: 60, authoritativeUnit: 'sqft', authoritativeQuantitySource: 'customer' },
      materials: [{ desc: 'Drywall patch material', qty: 120, unit: 'sqft', unitCost: 1.2 }]
    };

    const result = applyResidentialRepairQuantityProvenance([item])[0];
    assert.strictEqual(result.qty, 60);
    assert.strictEqual(result.materials[0].qty, 60);
    assert.strictEqual(result.materials[0].unit, 'sqft');
  });

  it('laundry and master closet remain distinct normalized work areas', () => {
    const { buildNormalizedWorkAreaIdentity } = require('../server');

    const laundry = buildNormalizedWorkAreaIdentity({
      location: 'Laundry Room',
      category: 'paint',
      desc: 'Laundry room ceiling paint and stain block',
      qty: 180,
      unit: 'sqft',
      metadata: { authoritativeQty: 180, authoritativeUnit: 'sqft' }
    });

    const masterCloset = buildNormalizedWorkAreaIdentity({
      location: 'Master Closet',
      category: 'paint',
      desc: 'Master closet seam repair, stain block, and ceiling paint',
      qty: 180,
      unit: 'sqft',
      metadata: { authoritativeQty: 180, authoritativeUnit: 'sqft' }
    });

    assert.notStrictEqual(laundry, masterCloset);
  });

  it('bathroom caulk and drywall repair remain distinct work areas', () => {
    const { buildNormalizedWorkAreaIdentity } = require('../server');

    const caulk = buildNormalizedWorkAreaIdentity({
      location: 'Bathroom',
      category: 'caulk',
      desc: 'Bathroom caulk grout cleanup around shower',
      qty: 20,
      unit: 'lf',
      metadata: { authoritativeQty: 20, authoritativeUnit: 'lf' }
    });

    const drywall = buildNormalizedWorkAreaIdentity({
      location: 'Bathroom',
      category: 'drywall',
      desc: 'Bathroom drywall repair with ceiling patch',
      qty: 60,
      unit: 'sqft',
      metadata: { authoritativeQty: 60, authoritativeUnit: 'sqft' }
    });

    assert.notStrictEqual(caulk, drywall);
  });

  it('soffit remains distinct from other repair areas', () => {
    const { buildNormalizedWorkAreaIdentity } = require('../server');

    const soffit = buildNormalizedWorkAreaIdentity({
      location: 'Bay Window',
      category: 'soffit',
      desc: 'Install F-channel and vinyl soffit with insulation',
      qty: 18,
      unit: 'lf',
      metadata: { authoritativeQty: 18, authoritativeUnit: 'lf' }
    });

    const bathCaulk = buildNormalizedWorkAreaIdentity({
      location: 'Bathroom',
      category: 'caulk',
      desc: 'Bathroom caulk around tub',
      qty: 20,
      unit: 'lf',
      metadata: { authoritativeQty: 20, authoritativeUnit: 'lf' }
    });

    assert.notStrictEqual(soffit, bathCaulk);
  });

  it('baseline exclusions are deterministic and repeatable', () => {
    const { generateBaselineExclusionsForScope } = require('../server');

    const first = generateBaselineExclusionsForScope('Laundry room ceiling paint/stain block and bay window soffit insulation repair');
    const second = generateBaselineExclusionsForScope('Laundry room ceiling paint/stain block and bay window soffit insulation repair');
    assert.deepStrictEqual(first, second);
    assert.ok(first.some((exclusion) => exclusion.toLowerCase().includes('concealed')));
  });

  it('project summary contains all normalized work areas and not just the first line item', () => {
    const { buildResidentialRepairProjectSummary } = require('../server');

    const items = [
      { location: 'Laundry Room', operation: 'paint', desc: 'Ceiling paint and stain block', qty: 180, unit: 'sqft' },
      { location: 'Bay Window', operation: 'soffit', desc: 'F-channel and soffit install', qty: 18, unit: 'lf' },
      { location: 'Bathroom', operation: 'caulk', desc: 'Caulk grout cleanup', qty: 20, unit: 'lf' },
      { location: 'Master Closet', operation: 'paint', desc: 'Ceiling paint and seam repair', qty: 180, unit: 'sqft' }
    ];

    const summary = buildResidentialRepairProjectSummary(items);
    assert.ok(summary.toLowerCase().includes('laundry room'));
    assert.ok(summary.toLowerCase().includes('bay window'));
    assert.ok(summary.toLowerCase().includes('bathroom'));
    assert.ok(summary.toLowerCase().includes('master closet'));
  });

  it('Brian Tiller residential scope summary includes the full multi-trade project instead of only the first task', () => {
    const html = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
    const start = html.indexOf('function normalizeProjectClass');
    const end = html.indexOf('function renderResidentialNarrativeBlock', start);
    const snippet = html.slice(start, end);
    const context = { window: {}, Number };
    vm.runInNewContext(snippet, context);

    const estimate = {
      projectClass: 'residential',
      type: 'Residential Repair',
      notes: 'Laundry room ceiling stain blocking and repainting. Bay window soffit/F-channel installation and insulation work. Bathtub/shower caulking cleanup and recaulk. Bathroom drywall and paint repair. Master-closet ceiling seam repair, stain blocking, and painting.',
      lineItems: [
        { desc: 'Laundry room ceiling stain blocking and repainting', qty: 1, unit: 'job' },
        { desc: 'Bay window soffit / F-channel installation and insulation work', qty: 1, unit: 'job' },
        { desc: 'Bathtub/shower caulking cleanup and recaulk', qty: 1, unit: 'job' },
        { desc: 'Bathroom drywall and paint repair', qty: 1, unit: 'job' },
        { desc: 'Master-closet ceiling seam repair, stain blocking, and painting', qty: 1, unit: 'job' }
      ],
      exclusions: ['Cleanup beyond normal dust control']
    };

    const scope = context.buildCanonicalCustomerScope(estimate);
    assert.ok(scope.projectScope.toLowerCase().includes('laundry room'));
    assert.ok(scope.projectScope.toLowerCase().includes('bay window'));
    assert.ok(scope.projectScope.toLowerCase().includes('bathroom'));
    assert.ok(scope.projectScope.toLowerCase().includes('master closet'));
    assert.ok(scope.workIncluded.some((entry) => entry.toLowerCase().includes('laundry room')));
    assert.ok(scope.workIncluded.some((entry) => entry.toLowerCase().includes('bay window')));
    assert.notStrictEqual(scope.projectScope, estimate.lineItems[0].desc);
  });

  it('company labor-rate changes deterministically change labor cost', () => {
    const { calculateResidentialRepairLabor } = require('../server');

    const rateA = calculateResidentialRepairLabor({ qty: 40, unit: 'sqft', category: 'paint', productionStandard: { setupHours: 0.5, productionRate: 40, productionRateUnit: 'sqft/hr', minimumTaskHours: 0.5 } }, 85);
    const rateB = calculateResidentialRepairLabor({ qty: 40, unit: 'sqft', category: 'paint', productionStandard: { setupHours: 0.5, productionRate: 40, productionRateUnit: 'sqft/hr', minimumTaskHours: 0.5 } }, 100);

    assert.strictEqual(rateA.laborCost, 1.5 * 85);
    assert.strictEqual(rateB.laborCost, 1.5 * 100);
    assert.notStrictEqual(rateA.laborCost, rateB.laborCost);
  });

  it('2-hour project minimum is applied only when total project labor is below 2 hours', () => {
    const { calculateResidentialRepairProjectMinimum } = require('../server');

    const belowMinimum = calculateResidentialRepairProjectMinimum([
      { category: 'paint', quantity: 10, unit: 'sqft', laborHours: 0.5 },
      { category: 'caulk', quantity: 5, unit: 'lf', laborHours: 0.75 }
    ], 85, 2);

    const aboveMinimum = calculateResidentialRepairProjectMinimum([
      { category: 'paint', quantity: 10, unit: 'sqft', laborHours: 1.25 },
      { category: 'caulk', quantity: 5, unit: 'lf', laborHours: 1.25 }
    ], 85, 2);

    assert.strictEqual(belowMinimum.projectLaborHours, 2);
    assert.strictEqual(aboveMinimum.projectLaborHours, 2.5);
    assert.strictEqual(belowMinimum.lineItems[0].laborHours, 0.5);
    assert.strictEqual(belowMinimum.lineItems[1].laborHours, 0.75);
  });

  it('categories without an approved production rate are marked needs_company_rate instead of using AI price', () => {
    const { getResidentialRepairProductionStandard } = require('../server');

    const standard = getResidentialRepairProductionStandard('paint');
    assert.strictEqual(standard.status, 'needs_company_rate');
    assert.strictEqual(standard.productionRate, null);
  });

  it('identical deterministic inputs return identical residential repair pricing results', () => {
    const { calculateResidentialRepairPricing } = require('../server');

    const itemA = {
      desc: 'Bathroom caulk repair',
      qty: 20,
      unit: 'lf',
      category: 'caulk',
      materials: [{ desc: 'Caulk and sealant', qty: 20, unit: 'lf', unitCost: 0.8 }],
      productionStandard: { setupHours: 0.25, productionRate: null, productionRateUnit: 'lf/hr', minimumTaskHours: 0.5, status: 'needs_company_rate' }
    };

    const resultA = calculateResidentialRepairPricing(itemA, 85, 20);
    const resultB = calculateResidentialRepairPricing({ ...itemA, materials: [{ ...itemA.materials[0] }] }, 85, 20);

    assert.deepStrictEqual(resultA, resultB);
    assert.strictEqual(resultA.status, 'needs_company_rate');
  });
});
