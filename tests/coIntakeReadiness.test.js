const assert = require('assert');
const { validateCOIntakeReadiness } = require('../server');

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
});
