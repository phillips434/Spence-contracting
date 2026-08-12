const assert = require('assert');
const geometryPhase1 = require('../lib/geometryPhase1');

describe('geometryPhase1', () => {
  it('marks roofing eligible and siding/sheathing ineligible when door height is unresolved', () => {
    const parsed = {
      geometry: {
        footprint: {
          length_ft: { value: 12, evidence: "Build a new 12' x 12' detached storage shed on a new concrete slab." },
          width_ft: { value: 12, evidence: "Build a new 12' x 12' detached storage shed on a new concrete slab." }
        },
        wallHeight_ft: { value: 8, evidence: 'The walls are 8 feet tall.' },
        roof: {
          type: { value: 'gable', evidence: 'The roof is a gable roof.' },
          pitch: { value: null, evidence: null },
          overhang_in: { value: null, evidence: null }
        }
      },
      openings: [
        {
          width_ft: 6,
          height_ft: null,
          evidence: "The shed has one 6' wide double entry door."
        },
        {
          width_ft: 3,
          height_ft: 3,
          evidence: "One vinyl window is 3' x 3'."
        },
        {
          width_ft: 3,
          height_ft: 3,
          evidence: "The other vinyl window is also 3' x 3'."
        }
      ],
      noOpeningsEvidence: null,
      lineItems: [
        {
          category: 'Roofing',
          desc: 'Roofing system',
          qty: 1,
          unit: 'lot',
          materials: [
            {
              desc: 'architectural shingles',
              qty: 180,
              unit: 'sqft',
              unitCost: 0.85,
              primary: true,
              quantityBasis: 'roof-area',
              basisPerUnit: null
            }
          ],
          laborHours: 24,
          equipmentOrSubCost: 120,
          metadata: { assumptions: 'Roofing based on user-provided shed dimensions and gable roof type.' }
        },
        {
          category: 'Siding',
          desc: 'Vinyl siding',
          qty: 1,
          unit: 'lot',
          materials: [
            {
              desc: 'vinyl siding',
              qty: 420,
              unit: 'sqft',
              unitCost: 1.75,
              primary: true,
              quantityBasis: 'siding-area',
              basisPerUnit: null
            }
          ],
          laborHours: 18,
          equipmentOrSubCost: 80,
          metadata: { assumptions: 'Siding includes openings.' }
        }
      ]
    };

    const questionContext = {
      originalPrompt: "Build a new 12' x 12' detached storage shed on a new concrete slab.",
      history: [
        { answer: 'The walls are 8 feet tall.' },
        { answer: 'The roof is a gable roof.' },
        { answer: "The shed has one 6' wide double entry door." },
        { answer: "One vinyl window is 3' x 3'." },
        { answer: "The other vinyl window is also 3' x 3'." }
      ]
    };

    const verified = geometryPhase1.verifyAndComputeCanonical(parsed, questionContext);

    assert.strictEqual(verified.openingsStatus, 'unresolved');
    assert.strictEqual(verified.guards.roofing, true);
    assert.strictEqual(verified.guards.siding, false);
    assert.strictEqual(verified.guards.sheathing, false);
  });

  it('marks siding/sheathing eligible when door height is explicitly verified', () => {
    const parsed = {
      geometry: {
        footprint: {
          length_ft: { value: 12, evidence: "Build a new 12' x 12' detached storage shed on a new concrete slab." },
          width_ft: { value: 12, evidence: "Build a new 12' x 12' detached storage shed on a new concrete slab." }
        },
        wallHeight_ft: { value: 8, evidence: 'The walls are 8 feet tall.' },
        roof: {
          type: { value: 'gable', evidence: 'The roof is a gable roof.' },
          pitch: { value: null, evidence: null },
          overhang_in: { value: null, evidence: null }
        }
      },
      openings: [
        {
          width_ft: 6,
          height_ft: 7,
          evidence: "The shed has one 6' wide double entry door that is 7 feet tall."
        },
        {
          width_ft: 3,
          height_ft: 3,
          evidence: "One vinyl window is 3' x 3'."
        },
        {
          width_ft: 3,
          height_ft: 3,
          evidence: "The other vinyl window is also 3' x 3'."
        }
      ],
      noOpeningsEvidence: null,
      lineItems: []
    };

    const questionContext = {
      originalPrompt: "Build a new 12' x 12' detached storage shed on a new concrete slab.",
      history: [
        { answer: 'The walls are 8 feet tall.' },
        { answer: 'The roof is a gable roof.' },
        { answer: "The shed has one 6' wide double entry door that is 7 feet tall." },
        { answer: "One vinyl window is 3' x 3'." },
        { answer: "The other vinyl window is also 3' x 3'." }
      ]
    };

    const verified = geometryPhase1.verifyAndComputeCanonical(parsed, questionContext);

    assert.strictEqual(verified.openingsStatus, 'verified');
    assert.strictEqual(verified.guards.siding, true);
    assert.strictEqual(verified.guards.sheathing, true);
  });

  it('derives wallHeight 8 from evidence when GPT provides value 10', () => {
    const parsed = {
      geometry: {
        footprint: {
          length_ft: { value: 12, evidence: "Build a new 12' x 12' detached storage shed on a new concrete slab." },
          width_ft: { value: 12, evidence: "Build a new 12' x 12' detached storage shed on a new concrete slab." }
        },
        wallHeight_ft: { value: 10, evidence: 'The walls are 8 feet tall.' },
        roof: {
          type: { value: 'gable', evidence: 'The roof is a gable roof.' },
          pitch: { value: null, evidence: null },
          overhang_in: { value: null, evidence: null }
        }
      },
      openings: [],
      noOpeningsEvidence: null,
      lineItems: []
    };

    const questionContext = {
      originalPrompt: "Build a new 12' x 12' detached storage shed on a new concrete slab.",
      history: [
        { answer: 'The walls are 8 feet tall.' },
        { answer: 'The roof is a gable roof.' }
      ]
    };

    const verified = geometryPhase1.verifyAndComputeCanonical(parsed, questionContext);

    assert.strictEqual(verified.geometry.wallHeight_ft.value, 8);
    assert.strictEqual(verified.geometry.wallHeight_ft.sourceType, 'user-derived');
  });

  it('rejects unverified 8/12 pitch and uses ContractorDesk default 4/12', () => {
    const parsed = {
      geometry: {
        footprint: {
          length_ft: { value: 12, evidence: "Build a new 12' x 12' detached storage shed on a new concrete slab." },
          width_ft: { value: 12, evidence: "Build a new 12' x 12' detached storage shed on a new concrete slab." }
        },
        wallHeight_ft: { value: 8, evidence: 'The walls are 8 feet tall.' },
        roof: {
          type: { value: 'gable', evidence: 'The roof is a gable roof.' },
          pitch: { value: 8 / 12, evidence: 'Use an 8/12 pitch.' },
          overhang_in: { value: null, evidence: null }
        }
      },
      openings: [],
      noOpeningsEvidence: null,
      lineItems: []
    };

    const questionContext = {
      originalPrompt: "Build a new 12' x 12' detached storage shed on a new concrete slab.",
      history: [
        { answer: 'The walls are 8 feet tall.' },
        { answer: 'The roof is a gable roof.' }
      ]
    };

    const verified = geometryPhase1.verifyAndComputeCanonical(parsed, questionContext);

    assert.strictEqual(verified.geometry.roof.pitch.value, 4 / 12);
    assert.strictEqual(verified.geometry.roof.pitch.sourceType, 'contractordesk-default');
    assert.strictEqual(verified.geometry.roof.pitch.evidenceFound, false);
  });
});
