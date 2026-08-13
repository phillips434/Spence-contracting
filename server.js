const express = require("express");
const cors = require("cors");
const path = require("path");
const { verifyAndComputeCanonical, applyPrimaryMaterialOverrides } = require("./lib/geometryPhase1");
const app = express();
const PORT = process.env.PORT || 5000;
const AI_BREAKDOWN_EXPERIMENT = (process.env.AI_BREAKDOWN_EXPERIMENT === 'true' || process.env.AI_BREAKDOWN_EXPERIMENT === '1');

function _round2(n){ return Math.round((parseFloat(n)||0)*100)/100; }

function buildMaterialCompletenessContractText(){
  return " Material completeness contract: Include the complete direct-material package required to perform the stated scope, including all major materials and any obvious supporting, secondary, accessory, fastening, connection, or installation-support items reasonably necessary for completion. Do not omit required materials merely because they are secondary, accessory, or installation-support items. Quantities must be tied to a clear quantity basis or measured takeoff. Use the same material completeness standard for materially similar scope/context and do not arbitrarily change the material package between otherwise similar runs.";
}

function buildMaterialPricingContractText(){
  return " unitCost means direct material acquisition cost only for one unit of the material before labor, installation, equipment, subcontractor cost, overhead, profit, markup, tax, or delivery unless specifically required separately. " +
    "The model must not include installed cost, fully burdened market price, contractor margin, labor, or markup in unitCost. " +
    "This is the approximate cost a contractor would expect to pay to acquire the material itself for the project. The server applies markup/OHP authoritatively after the model returns the direct material unit cost. " +
    buildMaterialCompletenessContractText();
}

const MATERIAL_PRICE_CATALOG = Object.freeze({
  'nm-b 12/2': { unit: 'ft', unitCost: 0.72, aliases: ['romex 12/2', 'romex 12-2', 'nm-b 12-2', '12/2 nm-b', '12-2 nm-b', 'nm b 12 2', '12 2 nm-b', '12/2 romex', '12-2 romex', 'romex 12 2', '12 2 romex', '12 gauge 2 conductor nm-b', '12 gauge 2 conductor nmb', '12 gauge 2 conductor romex', '12-2 wire', '12/2 wire', '12 2 wire'] },
  'nm-b 14/2': { unit: 'ft', unitCost: 0.58, aliases: ['romex 14/2', 'romex 14-2', 'nm-b 14-2', '14/2 nm-b', '14-2 nm-b', 'nm b 14 2', '14 2 nm-b', '14/2 romex', '14-2 romex', 'romex 14 2', '14 2 romex', '14 gauge 2 conductor nm-b', '14 gauge 2 conductor nmb', '14 gauge 2 conductor romex', '14-2 wire', '14/2 wire', '14 2 wire'] },
  'standard single-gang electrical box': { unit: 'ea', unitCost: 2.35, aliases: ['single-gang electrical box', 'single gang electrical box', 'single gang box', 'single-gang box', 'standard single gang box', 'single gang old work box', 'old work box'] },
  'wire connectors / wire nuts': { unit: 'ea', unitCost: 0.45, aliases: ['wire connectors', 'wire nuts', 'connector', 'wire nut', 'wire connectors / wire nuts', 'wire connectors and wire nuts'] },
  'grounding wire': { unit: 'ft', unitCost: 0.22, aliases: ['grounding wire', 'ground wire', 'equipment grounding conductor', 'egc'] },
  'electrical staples/clamps': { unit: 'ea', unitCost: 0.18, aliases: ['electrical staples', 'staples', 'electrical clamps', 'clamps', 'staple', 'clamp'] }
});

function normalizeMaterialDescription(value){
  if (typeof value !== 'string') return '';
  return value
    .toLowerCase()
    .replace(/[-–—]/g, '-')
    .replace(/[\/]/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function normalizeMaterialUnit(value){
  if (typeof value !== 'string') return '';
  const normalized = value.toLowerCase().trim();
  if (!normalized) return '';
  if (['ft', 'foot', 'feet', 'lf', 'linear foot', 'linear feet'].includes(normalized)) return 'ft';
  if (['ea', 'each', 'piece', 'pc'].includes(normalized)) return 'ea';
  return normalized;
}

function resolveCanonicalMaterialIdentity(description){
  const normalized = normalizeMaterialDescription(description);
  if (!normalized) return null;

  const hasVagueGaugeWording = /(various gauge|various gauges|multiple gauges|mixed gauges|average per day|electrical wire|romex various|wire various)/.test(normalized);
  if (hasVagueGaugeWording) return null;

  const explicit12Gauge2Conductor = /(nm b|romex|wire|electrical).*12.*2|12.*2.*(nm b|romex|wire|electrical)|12.*gauge.*2.*conductor.*(nm b|romex|wire)|12.*gauge.*2.*(nm b|romex|wire)/.test(normalized);
  const explicit14Gauge2Conductor = /(nm b|romex|wire|electrical).*14.*2|14.*2.*(nm b|romex|wire|electrical)|14.*gauge.*2.*conductor.*(nm b|romex|wire)|14.*gauge.*2.*(nm b|romex|wire)/.test(normalized);

  if (explicit12Gauge2Conductor && !/14/.test(normalized)) return 'nm-b 12/2';
  if (explicit14Gauge2Conductor && !/12/.test(normalized)) return 'nm-b 14/2';

  const directMatch = Object.keys(MATERIAL_PRICE_CATALOG).find(function(key){
    return normalizeMaterialDescription(key) === normalized;
  });
  if (directMatch) return directMatch;

  for (const [key, entry] of Object.entries(MATERIAL_PRICE_CATALOG)) {
    const aliases = Array.isArray(entry && entry.aliases) ? entry.aliases : [];
    if (aliases.some(function(alias){ return normalizeMaterialDescription(alias) === normalized; })) {
      return key;
    }
  }

  return null;
}

function resolveCatalogMaterialKey(description){
  const canonicalKey = resolveCanonicalMaterialIdentity(description);
  if (canonicalKey) return canonicalKey;

  const normalized = normalizeMaterialDescription(description);
  if (!normalized) return null;

  const directMatch = Object.keys(MATERIAL_PRICE_CATALOG).find(function(key){
    return normalizeMaterialDescription(key) === normalized;
  });
  if (directMatch) return directMatch;

  for (const [key, entry] of Object.entries(MATERIAL_PRICE_CATALOG)) {
    const aliases = Array.isArray(entry && entry.aliases) ? entry.aliases : [];
    if (aliases.some(function(alias){ return normalizeMaterialDescription(alias) === normalized; })) {
      return key;
    }
  }

  return null;
}

function applyAuthoritativeMaterialPricing(parsed){
  if (!parsed || !Array.isArray(parsed.lineItems)) return parsed;

  parsed.lineItems.forEach(function(li){
    if (!li || !Array.isArray(li.materials)) return;

    li.materials.forEach(function(material){
      if (!material || typeof material !== 'object') return;
      const originalUnitCost = Number(material.unitCost);
      const rawDescription = material.desc || '';
      const canonicalKey = resolveCanonicalMaterialIdentity(rawDescription);
      const catalogKey = canonicalKey || resolveCatalogMaterialKey(rawDescription);
      const canonicalIdentityResolved = !!canonicalKey;

      if (!catalogKey) {
        console.log('MATERIAL_PRICE_DIAGNOSTIC', {
          rawDescription: rawDescription,
          canonicalKey: canonicalKey || null,
          canonicalIdentityResolved: canonicalIdentityResolved,
          description: rawDescription,
          materialUnit: material.unit || null,
          catalogUnit: null,
          aiOriginalUnitCost: Number.isFinite(originalUnitCost) ? originalUnitCost : null,
          finalUnitCost: Number.isFinite(originalUnitCost) ? originalUnitCost : null,
          source: 'ai-fallback'
        });
        return;
      }

      const catalogEntry = MATERIAL_PRICE_CATALOG[catalogKey];
      const materialUnit = normalizeMaterialUnit(material.unit);
      const catalogUnit = normalizeMaterialUnit(catalogEntry.unit);

      if (!materialUnit) {
        console.log('MATERIAL_PRICE_DIAGNOSTIC', {
          rawDescription: rawDescription,
          canonicalKey: canonicalKey || null,
          canonicalIdentityResolved: canonicalIdentityResolved,
          description: rawDescription,
          materialUnit: material.unit || null,
          catalogUnit: catalogUnit,
          aiOriginalUnitCost: Number.isFinite(originalUnitCost) ? originalUnitCost : null,
          finalUnitCost: Number.isFinite(originalUnitCost) ? originalUnitCost : null,
          source: 'ai-fallback-unit-missing'
        });
        return;
      }

      if (!catalogUnit) {
        console.log('MATERIAL_PRICE_DIAGNOSTIC', {
          rawDescription: rawDescription,
          canonicalKey: canonicalKey || null,
          canonicalIdentityResolved: canonicalIdentityResolved,
          description: rawDescription,
          materialUnit: material.unit || null,
          catalogUnit: null,
          aiOriginalUnitCost: Number.isFinite(originalUnitCost) ? originalUnitCost : null,
          finalUnitCost: Number.isFinite(originalUnitCost) ? originalUnitCost : null,
          source: 'ai-fallback'
        });
        return;
      }

      if (materialUnit !== catalogUnit) {
        console.log('MATERIAL_PRICE_DIAGNOSTIC', {
          rawDescription: rawDescription,
          canonicalKey: canonicalKey || null,
          canonicalIdentityResolved: canonicalIdentityResolved,
          description: rawDescription,
          materialUnit: material.unit || null,
          catalogUnit: catalogUnit,
          aiOriginalUnitCost: Number.isFinite(originalUnitCost) ? originalUnitCost : null,
          finalUnitCost: Number.isFinite(originalUnitCost) ? originalUnitCost : null,
          source: 'ai-fallback-unit-mismatch'
        });
        return;
      }

      const finalUnitCost = Number(catalogEntry.unitCost);
      material.unitCost = finalUnitCost;
      console.log('MATERIAL_PRICE_DIAGNOSTIC', {
        rawDescription: rawDescription,
        canonicalKey: canonicalKey || null,
        canonicalIdentityResolved: canonicalIdentityResolved,
        description: rawDescription,
        materialUnit: material.unit || null,
        catalogUnit: catalogUnit,
        aiOriginalUnitCost: Number.isFinite(originalUnitCost) ? originalUnitCost : null,
        finalUnitCost: finalUnitCost,
        source: 'catalog'
      });
    });
  });

  return parsed;
}

function collectHistoryText(history){
  if (!Array.isArray(history)) return '';
  return history.map(function(entry){
    if (!entry) return '';
    if (typeof entry === 'string') return entry;
    if (typeof entry === 'object') {
      const parts = [];
      if (Array.isArray(entry.questions) && entry.questions.length) {
        parts.push(entry.questions.join(' '));
      }
      if (entry.question) parts.push(entry.question);
      if (entry.answer || entry.answer === 0) parts.push(String(entry.answer));
      if (entry.answers && Array.isArray(entry.answers) && entry.answers.length) {
        parts.push(entry.answers.join(' '));
      }
      if (parts.length) return parts.join(' ');
      return JSON.stringify(entry);
    }
    return String(entry);
  }).join(' ');
}

function hasAnswerToQuestion(history, matcher){
  if (!Array.isArray(history)) return false;
  return history.some(function(entry){
    if (!entry || typeof entry !== 'object') return false;
    const questionText = (Array.isArray(entry.questions) ? entry.questions.join(' ') : (entry.question || '')).toLowerCase();
    const answerText = (entry.answer !== undefined && entry.answer !== null) ? String(entry.answer) : '';
    if (!questionText || !answerText) return false;
    return matcher(questionText, answerText);
  });
}

function hasLaborDurationStatement(text){
  if (!text) return false;
  return /(\d+(?:\.\d+)?)\s+(?:additional\s+|more\s+)?(day|days|hour|hours|shift|shifts)\b/i.test(text);
}

function hasResolvedCrewOrLaborHoursFact(text, history){
  if (!text && !history) return false;

  if (Array.isArray(history) && history.length) {
    const crewResolved = hasAnswerToQuestion(history, function(questionText, answerText){
      return (/\bworkers?\b|\bcrew\b|\bteam\b|\bpeople\b/.test(questionText) && /\d+(?:\.\d+)?/.test(answerText));
    });
    const laborHoursResolved = hasAnswerToQuestion(history, function(questionText, answerText){
      return (/\blabor\s*hours?\b|\bman-hours?\b|\bhours?\b/.test(questionText) && /\d+(?:\.\d+)?/.test(answerText));
    });
    if (crewResolved || laborHoursResolved) return true;
  }

  if (!text) return false;
  const crewPatterns = [
    /\b(?:crew|workforce|team|workers?|laborers?|electricians?|technicians?|people)\b[^\n]{0,80}\b(?:of\s+)?\d+(?:\.\d+)?\b/i,
    /\b\d+(?:\.\d+)?\s+(?:workers?|laborers?|electricians?|technicians?|people|crew)\b/i,
    /\b(?:crew\s*size|worker\s*count|workers?\s*[:=])\s*\d+(?:\.\d+)?\b/i
  ];
  const laborHoursPatterns = [
    /\b(?:total\s+)?labor\s*hours?\b[^\n]{0,80}\b\d+(?:\.\d+)?\b/i,
    /\b\d+(?:\.\d+)?\s+(?:labor\s*hours?|man-hours?)\b/i,
    /\b(?:total\s+)?labor\s*hours?\s*[:=]\s*\d+(?:\.\d+)?\b/i
  ];
  return crewPatterns.some(function(pattern){ return pattern.test(text); }) ||
    laborHoursPatterns.some(function(pattern){ return pattern.test(text); });
}

function validateCOIntakeReadiness(payload){
  const questionHistory = payload && payload.questionContext && payload.questionContext.history;
  const promptText = [
    payload && payload.title,
    payload && payload.description,
    payload && payload.prompt,
    payload && payload.questionContext && payload.questionContext.originalPrompt,
    collectHistoryText(questionHistory)
  ].filter(function(item){ return typeof item === 'string' && item.trim(); }).join(' ');

  if (!hasLaborDurationStatement(promptText)) {
    return null;
  }
  if (hasResolvedCrewOrLaborHoursFact(promptText, questionHistory)) {
    return null;
  }

  const durationMatch = promptText.match(/(\d+(?:\.\d+)?)\s+(?:additional\s+|more\s+)?(day|days|hour|hours|shift|shifts)\b/i);
  const durationText = durationMatch ? durationMatch[1] + ' ' + durationMatch[2] : 'that duration';
  return {
    action: 'questions',
    questions: [
      'How many workers will be working for those ' + durationText + '?'
    ]
  };
}

function parseCrewSizeFromText(text){
  if (!text) return null;
  const patterns = [
    /(\d+(?:\.\d+)?)\s*(?:workers?|people|crew|men|man|electricians?|carpenters?|laborers?|plumbers?|painters?|drywallers?)\b/i,
    /(?:crew|team|workforce)\s*(?:of)?\s*(\d+(?:\.\d+)?)\b/i,
    /(?:workers?|people|crew|men|man)\s*[:=]\s*(\d+(?:\.\d+)?)\b/i
  ];
  for (let i = 0; i < patterns.length; i++) {
    const match = text.match(patterns[i]);
    if (match && match[1]) return Number(match[1]);
  }
  return null;
}

function parseDurationFromText(text){
  if (!text) return null;

  const patterns = [
    /(\d+(?:\.\d+)?)\s*(?:additional\s+|more\s+)(?:\d+(?:\.\d+)?\s*(?:-|to\s+)?\s*(?:hours?|hrs?|hr)\s*)?(day|days|shift|shifts|week|weeks)\b/i,
    /(\d+(?:\.\d+)?)\s*(?:\d+(?:\.\d+)?\s*(?:-|to\s+)?\s*(?:hours?|hrs?|hr)\s*)(day|days|shift|shifts|week|weeks)\b/i,
    /(\d+(?:\.\d+)?)\s*(?:additional\s+|more\s+)?(day|days|shift|shifts|week|weeks)\b/i,
    /(\d+(?:\.\d+)?)\s*(day|days|shift|shifts|week|weeks)\b/i
  ];

  for (let i = 0; i < patterns.length; i++) {
    const match = text.match(patterns[i]);
    if (match && match[1]) {
      const value = Number(match[1]);
      const unit = (match[2] || match[1]).toLowerCase();
      if (Number.isFinite(value) && value > 0) {
        return { value: value, unit: unit };
      }
    }
  }

  return null;
}

function parseTotalLaborHoursFromText(text){
  if (!text) return null;
  const patterns = [
    /(\d+(?:\.\d+)?)\s*(?:total\s+)?labor\s*hours?\b/i,
    /(\d+(?:\.\d+)?)\s*(?:total\s+)?man-hours?\b/i,
    /(\d+(?:\.\d+)?)\s*(?:labor\s*hours?|man-hours?)\b/i,
    /(?:labor\s*hours?|man-hours?)\s*[:=]\s*(\d+(?:\.\d+)?)\b/i
  ];
  for (let i = 0; i < patterns.length; i++) {
    const match = text.match(patterns[i]);
    if (match && match[1]) return Number(match[1]);
  }
  return null;
}

function parseCrewSizeFromHistory(history){
  if (!Array.isArray(history)) return null;

  for (let i = 0; i < history.length; i++) {
    const entry = history[i];
    if (!entry || typeof entry !== 'object') continue;

    const questionParts = Array.isArray(entry.questions) ? entry.questions : [entry.question];
    const questionText = questionParts.filter(function(item){ return typeof item === 'string' && item.trim(); }).join(' ');
    const answerText = (entry.answer !== undefined && entry.answer !== null)
      ? String(entry.answer)
      : (Array.isArray(entry.answers) ? entry.answers.join(' ') : '');

    if (!questionText || !answerText) continue;
    if (!/\b(?:how\s+many|workers?|people|crew|team|personnel|electricians?|carpenters?|plumbers?|laborers?|technicians?|craftsmen?)\b/i.test(questionText)) continue;

    const match = answerText.match(/(\d+(?:\.\d+)?)/);
    if (match && match[1]) return Number(match[1]);
  }

  return null;
}

function buildAuthoritativeLaborFact(inputText, history){
  const historyText = collectHistoryText(history || []);
  const combinedText = [inputText, historyText].filter(function(item){ return typeof item === 'string' && item.trim(); }).join(' ');
  if (!combinedText) return { isResolved: false, totalHours: 0, crewSize: null, durationValue: null, durationUnit: null, source: 'contractor' };

  const crewSizeFromHistory = parseCrewSizeFromHistory(history || []);
  const totalLaborHours = parseTotalLaborHoursFromText(combinedText);
  const crewSize = crewSizeFromHistory !== null ? crewSizeFromHistory : parseCrewSizeFromText(combinedText);
  const duration = parseDurationFromText(combinedText);

  let finalHours = totalLaborHours;
  if (!finalHours && crewSize && duration && duration.value) {
    let multiplier = 8;
    if (/^(day|days)$/.test(duration.unit)) multiplier = 8;
    if (/^(hour|hours)$/.test(duration.unit)) multiplier = 1;
    if (/^(shift|shifts)$/.test(duration.unit)) multiplier = 8;
    if (/^(week|weeks)$/.test(duration.unit)) multiplier = 40;
    finalHours = crewSize * duration.value * multiplier;
  }

  const isResolved = !!(finalHours && Number.isFinite(finalHours) && finalHours > 0);
  return {
    isResolved: isResolved,
    totalHours: isResolved ? Number(finalHours.toFixed(2)) : 0,
    crewSize: crewSize ? Number(crewSize) : null,
    durationValue: duration ? Number(duration.value) : null,
    durationUnit: duration ? duration.unit : null,
    source: 'contractor'
  };
}

function applyAuthoritativeLaborInvariant(parsed, authoritativeLabor){
  if (!parsed || !parsed.lineItems || !Array.isArray(parsed.lineItems)) return parsed;
  if (!authoritativeLabor || !authoritativeLabor.isResolved || !authoritativeLabor.totalHours) return parsed;

  const targetHours = Number(authoritativeLabor.totalHours);
  const laborRows = parsed.lineItems.map(function(li, index){
    return { index, li };
  }).filter(function(entry){
    return entry.li && Number(entry.li.laborHours || 0) > 0;
  });

  if (!laborRows.length) return parsed;

  const affectedIndexes = laborRows.map(function(entry){ return entry.index; });
  const rowTotals = laborRows.map(function(entry){ return Number(entry.li.laborHours || 0); });
  const currentTotal = rowTotals.reduce(function(sum, value){ return sum + value; }, 0);

  if (currentTotal <= 0) return parsed;

  if (laborRows.length === 1) {
    const singleRow = laborRows[0].li;
    singleRow.laborHours = targetHours;
    if (singleRow.qty !== undefined && singleRow.qty !== null && Number(singleRow.qty) > 0) {
      singleRow.qty = targetHours;
    }
    return parsed;
  }

  let runningTotal = 0;
  laborRows.forEach(function(entry, rowIdx){
    const original = Number(entry.li.laborHours || 0);
    const share = currentTotal > 0 ? original / currentTotal : 0;
    const assigned = Number((targetHours * share).toFixed(2));
    entry.li.laborHours = rowIdx === laborRows.length - 1 ? Number((targetHours - runningTotal).toFixed(2)) : assigned;
    if (entry.li.qty !== undefined && entry.li.qty !== null && Number(entry.li.qty) > 0) {
      entry.li.qty = Number(entry.li.laborHours);
    }
    runningTotal += Number(entry.li.laborHours || 0);
  });

  for (let i = 0; i < parsed.lineItems.length; i++) {
    if (affectedIndexes.indexOf(i) === -1 && Number(parsed.lineItems[i].laborHours || 0) > 0) {
      parsed.lineItems[i].laborHours = 0;
    }
  }

  return parsed;
}

function applyCOAuthoritativeLabor(parsed, authoritativeLabor){
  return applyAuthoritativeLaborInvariant(parsed, authoritativeLabor);
}

function alignLineItemQuantityToPrimaryMaterial(lineItem){
  if (!lineItem || typeof lineItem !== 'object') return lineItem;

  const materials = Array.isArray(lineItem.aiBreakdown && lineItem.aiBreakdown.materials)
    ? lineItem.aiBreakdown.materials
    : (Array.isArray(lineItem.materials) ? lineItem.materials : []);

  if (!materials.length) return lineItem;

  const primaryCandidates = materials.filter(function(material){
    return material && typeof material === 'object' && material.primary === true;
  });

  const candidate = primaryCandidates.length === 1
    ? primaryCandidates[0]
    : (materials.length === 1 ? materials[0] : null);

  if (!candidate || typeof candidate !== 'object') return lineItem;

  const materialQty = Number(candidate.qty);
  const lineQty = Number(lineItem.qty);
  const materialUnit = normalizeMaterialUnit(candidate.unit);
  const lineUnit = normalizeMaterialUnit(lineItem.unit);

  if (!Number.isFinite(materialQty) || materialQty <= 0) return lineItem;
  if (!materialUnit || !lineUnit) return lineItem;
  if (materialUnit !== lineUnit) return lineItem;
  if (!Number.isFinite(lineQty) || lineQty <= 0) return lineItem;

  if (primaryCandidates.length > 1) return lineItem;

  lineItem.qty = materialQty;
  lineItem.unit = materialUnit;
  return lineItem;
}

function normalizeAIGenerated(parsed, laborRate, markup){
  if(!parsed || !Array.isArray(parsed.lineItems)) throw new Error('AI response must contain a lineItems array');
  return parsed.lineItems.map(function(li, idx){
    // materials must be present and an array
    if(!li.hasOwnProperty('materials') || !Array.isArray(li.materials)){
      throw new Error('lineItems['+idx+'] missing required "materials" array (use [] when no materials apply)');
    }
    // qty must be present and a finite number
    if(!li.hasOwnProperty('qty') || !Number.isFinite(Number(li.qty))){
      throw new Error('lineItems['+idx+'] missing or invalid numeric "qty"');
    }
    // laborHours must be present and a finite number
    if(!li.hasOwnProperty('laborHours') || !Number.isFinite(Number(li.laborHours))){
      throw new Error('lineItems['+idx+'] missing or invalid numeric "laborHours" (use 0 when none)');
    }
    // equipmentOrSubCost must be present and a finite number
    if(!li.hasOwnProperty('equipmentOrSubCost') || !Number.isFinite(Number(li.equipmentOrSubCost))){
      throw new Error('lineItems['+idx+'] missing or invalid numeric "equipmentOrSubCost" (use 0 when none)');
    }
    // Validate materials entries
    var materials = li.materials;
    for(var mi=0; mi<materials.length; mi++){
      var m = materials[mi];
      if(!m || typeof m !== 'object'){
        throw new Error('lineItems['+idx+'].materials['+mi+'] must be an object');
      }
      if(!m.hasOwnProperty('qty') || !Number.isFinite(Number(m.qty))){
        throw new Error('lineItems['+idx+'].materials['+mi+'] missing or invalid numeric "qty"');
      }
      if(!m.hasOwnProperty('unitCost') || !Number.isFinite(Number(m.unitCost))){
        throw new Error('lineItems['+idx+'].materials['+mi+'] missing or invalid numeric "unitCost"');
      }
    }
    // Compute material cost from materials array
    var materialCost = materials.reduce(function(s,m){
      return s + (Number(m.qty) * Number(m.unitCost));
    },0);
    var laborHours = Number(li.laborHours);
    var laborCost = _round2(laborHours * (Number(laborRate)||0));
    var equipmentOrSubCost = Number(li.equipmentOrSubCost);
    // Authoritative baseCost is computed by server
    var baseCost = _round2(materialCost + laborCost + equipmentOrSubCost);
    var qty = Number(li.qty);
    var unitCost = qty>0? _round2(baseCost/qty) : _round2(baseCost);
    // IMPORTANT: total must be the authoritative baseCost (do NOT recompute from rounded unitCost)
    var total = baseCost;
    return {
      category: li.category || '',
      desc: li.desc || '',
      qty: qty,
      unit: li.unit || '',
      unitCost: unitCost,
      total: total,
      markup: Number(markup)||0,
      aiBreakdown: {
        materials: materials,
        laborHours: laborHours,
        equipmentOrSubCost: equipmentOrSubCost,
        assumptions: (li.metadata && li.metadata.assumptions) || ''
      }
    };
  });
}

const corsOptions = {
  origin: [
    "https://spence-contracting--phillip95.replit.app",
    "https://app.getcontractordesk.com",
    "https://getcontractordesk.com",
    /\.replit\.app$/,
    /\.replit\.dev$/,
    "http://localhost:5000",
  ],
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type"],
  credentials: false,
};

app.options(/.*/, cors(corsOptions));
app.use(cors(corsOptions));
app.use(express.json({ limit: "10mb" }));
app.use(express.static(path.join(__dirname, "public")));

app.post("/api/estimate", async (req, res) => {
  console.log("STEP 1 - Request received", new Date().toISOString());
  try {
    const apiKey = process.env.ANTHROPIC_KEY;
    if (!apiKey) {
      console.error("STEP 1 ERROR - Missing Anthropic API key");
      return res.status(500).json({ error: "ANTHROPIC_KEY secret is not configured." });
    }

    try {
      console.log("STEP 2 - Request body parsed", { hasBody: !!req.body, bodyKeys: req.body ? Object.keys(req.body) : [] });
    } catch (err) {
      console.error("STEP 2 ERROR - Request body parse failed", err);
      if (err && err.stack) {
        console.error(err.stack);
      }
      throw err;
    }

    let body;
    try {
      body = req.body || {};
      const mode = body.mode || "passthrough";
      const isEstimateIntakeRequest = mode === "estimate-intake";
      const isCOIntakeRequest = mode === "change-order-intake";
      const isIntakeRequest = isEstimateIntakeRequest || isCOIntakeRequest;
      const isEstimateRequest = mode === "estimate" || mode === "estimate-generate";
      const isChangeOrderGenerateRequest = mode === "change-order-generate";
      console.log("STEP 3 - Internal mode determined", { mode, isIntakeRequest, isEstimateIntakeRequest, isCOIntakeRequest, isEstimateRequest, isChangeOrderGenerateRequest });

      const title = body.title || "";
      const description = body.description || "";

      let anthropicBody = {
        model: body.model || "claude-haiku-4-5-20251001",
        max_tokens: body.max_tokens || 2000,
        messages: body.messages || [{ role: "user", content: body.prompt || "" }],
      };

      try {
        if (isIntakeRequest || isEstimateRequest || isChangeOrderGenerateRequest) {
          const items = body.items || "[]";
          const existingExcls = body.excls || "[]";
          const markup = body.markup || 20;
          const laborRate = body.laborRate || 85;
          const location = body.location || "";
          const histCtx = body.histCtx || "";
          const prompt = body.prompt || "";
          const originalEstimateContext = body.originalEstimateContext || "";
          const model = body.model || "claude-haiku-4-5-20251001";
          const maxTok = body.max_tokens || 2000;
          const questionContext = body.questionContext || null;
          const followUpContext = questionContext
            ? " FOLLOW-UP CONTEXT: Original request: " +
              (questionContext.originalPrompt || "") +
              ". Question history: " +
              JSON.stringify(questionContext.history || [])
            : "";
          const isIntakePrompt =
            "IMPORTANT: You are only deciding whether a new estimate request has enough information to proceed." +
            " Return only one JSON object with exactly one of these forms:" +
            ' {"action":"questions","questions":["question 1","question 2"]}' +
            ' or {"action":"ready"}.' +
            " Do not add, edit, remove, or change any line items or exclusions." +
            " Before returning ready, evaluate whether the request contains enough information for every MAJOR ESTIMATING CATEGORY THAT APPLIES TO THIS PROJECT." +
            " Applicable categories may include: project dimensions / quantities, site conditions / demolition / access, foundation / concrete / structural requirements, framing / structural system, roofing / waterproofing, exterior finishes, doors / windows / openings, interior finishes, electrical, plumbing, HVAC / ventilation, specialty equipment / subcontractors, finish level / material grade, and unusual schedule, access, or installation conditions." +
            " Do NOT ask about categories that clearly do not apply to the project." +
            " Do NOT return ready until every applicable major category that could materially affect cost is either answered, already stated in the original request/history, explicitly stated as unknown/not applicable, or reasonably estimable without another field answer." +
            " Before asking questions, mentally evaluate the applicable categories and identify only the unresolved ones." +
            " Ask the minimum number of SPECIFIC questions needed to resolve those unresolved categories." +
            " Prefer grouping related unresolved details into one round rather than asking them piecemeal over many rounds." +
            " Do not ask administrative questions, budget questions, client/property-owner questions, contact information, or other project-profile details unless they directly affect pricing." +
            " Treat the original estimate request and prior questionContext as authoritative known information." +
            " Never ask the user to restate the project type, main scope, or other information already provided." +
            " Do not repeat resolved questions." +
            " Unknown, don't know, not sure, N/A, or unavailable are valid resolved answers." +
            " For substantially identical project information, apply the same completeness standard before deciding whether to return ready." +
            " Do NOT require perfect construction documents. Intake is complete when there is enough information to create a defensible estimate with reasonable assumptions." +
            " Do not explain anything.";
          let systemPrompt;
          if (isCOIntakeRequest) {
            systemPrompt =
              "IMPORTANT: You are only deciding whether a change order has enough information to proceed. Return only one JSON object with exactly one of these forms: {\"action\":\"questions\",\"questions\":[\"question 1\",\"question 2\"]} or {\"action\":\"ready\"}. Do not add, edit, remove, or change any line items or costs. " +
              "Use the original CO description and prior questionContext as authoritative known information. Never ask for information already stated in the original description or previous answers. " +
              "Unknown, don't know, N/A, unavailable, or not applicable are valid resolved answers. Treat them as complete. " +
              "Ask only unresolved questions that materially affect scope or price. Do not ask budget questions. Do not ask for contact details. Do not re-ask quantities already supplied such as lengths, counts, or material quantities present in the original request/history. " +
              "Preserve already-known facts such as 500 LF Romex, 10 round boxes, 8 single-gang boxes, and 1 double-gang box; do not ask those again. " +
              "A labor duration without crew size or total labor hours is unresolved. For example, '2 additional days of work' is NOT sufficient by itself if crew size or total labor hours are unknown. " +
              "If the scope includes a duration but not a crew size or total labor-hours fact, ask a question such as 'How many workers will be working for those 2 additional days?' or 'What is the total labor hours for the additional work?' " +
              "Only ask if something materially affects labor, materials, access, change scope, or crew assumptions. Return valid JSON only.";
          } else if (isIntakeRequest) {
            systemPrompt = isIntakePrompt;
          } else if (AI_BREAKDOWN_EXPERIMENT && (mode === 'estimate-generate' || mode === 'change-order-generate')) {
            if (mode === 'change-order-generate') {
              systemPrompt =
                "IMPORTANT: Your entire response must be a single raw JSON object. No markdown, no code fences, no backticks, no explanation. Start your response with { and end with }. You are a construction change order estimator." +
                " RETURN JSON with this top-level shape: {\"title\":\"...\",\"description\":\"...\",\"geometry\":{...},\"openings\":[{...}],\"noOpeningsEvidence\":string|null,\"lineItems\":[{...}]}." +
                " Keep the same line-item/material structure as the estimate workflow: {\"category\":\"...\",\"desc\":\"...\",\"qty\":number,\"unit\":\"...\",\"materials\":[{\"desc\":\"...\",\"qty\":number,\"unit\":\"...\",\"unitCost\":number,\"primary\":true|false,\"quantityBasis\":\"roof-area\"|\"siding-area\"|\"wall-area\"|\"ai-estimated\",\"basisPerUnit\":number|null}],\"laborHours\":number,\"equipmentOrSubCost\":number,\"metadata\":{\"assumptions\":\"...\"}}." +
                " Geometry and openings are optional but, when used, must include evidence objects consistent with the estimate workflow. Use the same Phase1 material metadata fields. " +
                " Material unitCost and completeness contract: " + buildMaterialPricingContractText() +
                " Do not bake markup into unit costs. The server will apply markup authoritatively. " +
                " Do not return authoritative totals, laborCost, materialCost, baseCost, or markup. The model should only determine quantities, material unit prices, labor hours, assumptions, and CO description fields. " +
                " EXACT RULES: materials must always be an array; laborHours and equipmentOrSubCost must always be numeric; include the complete direct-material package required to complete the stated scope, including obvious supporting and accessory materials; if an opening has one missing dimension, use null for that field; noOpeningsEvidence may be a string or null; geometry and openings may be omitted when not applicable, but when provided they must follow the same evidence pattern as estimate generation. " +
                " Current CO title: " + title + ". Description: " + description + ". Original estimate context: " + originalEstimateContext + "." +
                " Current items: " + items + " Current exclusions: " + existingExcls +
                (location ? " Location: " + location + "." : "") +
                (histCtx ? " HISTORICAL: " + histCtx + "." : "") +
                " Return valid JSON only.";
            } else {
              systemPrompt =
                "IMPORTANT: Your entire response must be a single raw JSON object. No markdown, no code fences, no backticks, no explanation. Start your response with { and end with }. You are a construction estimator." +
                " RETURN JSON with this top-level shape: {\"action\":\"add|update|ready\",\"geometry\":{...},\"openings\":[{...}],\"noOpeningsEvidence\":\"\"|null,\"lineItems\":[{...}],\"deleteIndexes\":[],\"updateItems\":[],\"exclusions\":[],\"message\":\"\"}." +
                " Keep the current line item shape exactly: {\"category\":\"...\",\"desc\":\"...\",\"qty\":number,\"unit\":\"...\",\"materials\":[{...}],\"laborHours\":number,\"equipmentOrSubCost\":number,\"metadata\":{\"assumptions\":\"...\"}}." +
                " In addition, include geometry and openings at the top level so the server can verify Phase1 determinism. " +
                " geometry.footprint.length_ft = {\"value\":number|null,\"evidence\":string|null}; geometry.footprint.width_ft = {\"value\":number|null,\"evidence\":string|null}; geometry.wallHeight_ft = {\"value\":number|null,\"evidence\":string|null}; geometry.roof.type = {\"value\":\"gable\"|string|null,\"evidence\":string|null}; geometry.roof.pitch = {\"value\":number|null,\"evidence\":string|null}; geometry.roof.overhang_in = {\"value\":number|null,\"evidence\":string|null}; " +
                " openings must be an array of objects with width_ft:number|null, height_ft:number|null, evidence:string. An opening may have one missing dimension when unresolved; represent it as null. " +
                " noOpeningsEvidence must be a string or null; server decides openingsStatus. " +
                " For each material object, include desc, qty, unit, unitCost, primary, quantityBasis, basisPerUnit. " +
                " Material unitCost and completeness contract: " + buildMaterialPricingContractText() +
                " quantityBasis must be one of: roof-area, siding-area, wall-area, ai-estimated. " +
                " basisPerUnit must be a number or null. If primary unit is sqft, basisPerUnit must be null. If primary unit is a package unit such as bundle/sheet/carton, basisPerUnit is the sqft covered per unit. " +
                " Include all major direct materials and obvious supporting/ancillary materials required to complete the stated scope; do not omit required fasteners, connectors, accessories, or installation-support materials. Exactly one primary:true material is allowed per applicable line item. Accessories must be primary:false and quantityBasis:\"ai-estimated\" with basisPerUnit:null. " +
                " Do not decide openingsStatus. The server decides that. " +
                " Do NOT return authoritative materialCost, laborCost, baseCost, unitCost, total, or markup. Do NOT return any lump-sum totals. The model should only determine quantities, material unit prices, labor hours, assumptions, geometry evidence, and material Phase1 metadata. ContractorDesk will perform all arithmetic and apply markup exactly once. " +
                " STRICT RULES:" +
                " - materials must always be an array (use [] when no materials apply)." +
                " - laborHours must always be numeric (use 0 when none)." +
                " - equipmentOrSubCost must always be numeric (use 0 when none)." +
                " - geometry, openings, and noOpeningsEvidence are required fields for this experiment." +
                " - all defined properties must be present; do not omit required fields, even when null." +
                " Current items: " + items + " Current exclusions: " + existingExcls +
                (location ? " Location: " + location + "." : "") +
                (histCtx ? " HISTORICAL: " + histCtx + "." : "") +
                " RETURN valid JSON only.";
            }
          } else {
            systemPrompt =
              "IMPORTANT: Your entire response must be a single raw JSON object." +
              " No markdown, no code fences, no backticks, no explanation." +
              " Start your response with { and end with }." +
              " You are a construction estimator." +
              ' Format: {"action":"add","lineItems":[{"category":"Labor","desc":"description","qty":1,"unit":"hrs","unitCost":85,"total":85,"markup":20}],"deleteIndexes":[],"updateItems":[],"exclusions":[],"message":"what was done"}' +
              " IMPORTANT: total = qty * unitCost. markup = percentage for client price. " + buildMaterialPricingContractText() +
              " Current items: " +
              items +
              " Current exclusions: " +
              existingExcls +
              " Markup: " +
              markup +
              "%. Labor: $" +
              laborRate +
              "/hr." +
              (location ? " Location: " + location + "." : "") +
              (histCtx ? " HISTORICAL: " + histCtx + "." : "") +
              " Rules: lineItems=ADD, deleteIndexes=DELETE, updateItems=UPDATE." +
              " When adding exclusions, return them as plain strings in the exclusions array." +
              " Do not repeat exclusions already in the current exclusions list.";
          }
          anthropicBody = {
            model: model,
            max_tokens: maxTok,
            system: systemPrompt,
            messages: [{ role: "user", content: prompt + followUpContext }],
          };
        }
        console.log("STEP 4 - Anthropic payload built", { mode, hasSystem: !!anthropicBody.system });
      } catch (err) {
        console.error("STEP 4 ERROR - Anthropic payload build failed", err);
        if (err && err.stack) {
          console.error(err.stack);
        }
        throw err;
      }

      try {
        console.log("STEP 5 - Sending request to model backend");

        let response;
        let responseText;
        let data;

        // If this is an intake request or estimate/CO generation and OPENAI_API_KEY is present, route to OpenAI
        if ((isIntakeRequest || mode === "estimate-generate" || mode === "change-order-generate") && process.env.OPENAI_API_KEY) {
          const openaiModel = "gpt-4.1";
          const openaiBody = {
            model: openaiModel,
            messages: [
              { role: "system", content: (anthropicBody && anthropicBody.system) || "" },
              { role: "user", content: (anthropicBody && anthropicBody.messages && anthropicBody.messages[0] && anthropicBody.messages[0].content) || "" }
            ],
            max_tokens: (anthropicBody && anthropicBody.max_tokens) || 2000,
            temperature: 0
          };
          if (AI_BREAKDOWN_EXPERIMENT && (mode === "estimate-generate" || mode === "change-order-generate")) {
            openaiBody.max_tokens = 8000;
            const isCO = mode === "change-order-generate";
            const schemaRequired = isCO
              ? [
                  "title",
                  "description",
                  "geometry",
                  "openings",
                  "noOpeningsEvidence",
                  "message",
                  "lineItems"
                ]
              : [
                  "action",
                  "lineItems",
                  "deleteIndexes",
                  "updateItems",
                  "exclusions",
                  "message"
                ];
            const schemaProperties = isCO
              ? {
                  title: { type: "string" },
                  description: { type: "string" },
                  geometry: {
                    type: ["object", "null"],
                    additionalProperties: false,
                    required: ["footprint", "wallHeight_ft", "roof"],
                    properties: {
                      footprint: {
                        type: ["object", "null"],
                        additionalProperties: false,
                        required: ["length_ft", "width_ft"],
                        properties: {
                          length_ft: {
                            type: ["object", "null"],
                            additionalProperties: false,
                            required: ["value", "evidence"],
                            properties: {
                              value: { type: ["number", "null"] },
                              evidence: { type: ["string", "null"] }
                            }
                          },
                          width_ft: {
                            type: ["object", "null"],
                            additionalProperties: false,
                            required: ["value", "evidence"],
                            properties: {
                              value: { type: ["number", "null"] },
                              evidence: { type: ["string", "null"] }
                            }
                          }
                        }
                      },
                      wallHeight_ft: {
                        type: ["object", "null"],
                        additionalProperties: false,
                        required: ["value", "evidence"],
                        properties: {
                          value: { type: ["number", "null"] },
                          evidence: { type: ["string", "null"] }
                        }
                      },
                      roof: {
                        type: ["object", "null"],
                        additionalProperties: false,
                        required: ["type", "pitch", "overhang_in"],
                        properties: {
                          type: {
                            type: ["object", "null"],
                            additionalProperties: false,
                            required: ["value", "evidence"],
                            properties: {
                              value: { type: ["string", "null"] },
                              evidence: { type: ["string", "null"] }
                            }
                          },
                          pitch: {
                            type: ["object", "null"],
                            additionalProperties: false,
                            required: ["value", "evidence"],
                            properties: {
                              value: { type: ["number", "null"] },
                              evidence: { type: ["string", "null"] }
                            }
                          },
                          overhang_in: {
                            type: ["object", "null"],
                            additionalProperties: false,
                            required: ["value", "evidence"],
                            properties: {
                              value: { type: ["number", "null"] },
                              evidence: { type: ["string", "null"] }
                            }
                          }
                        }
                      }
                    }
                  },
                  openings: {
                    type: ["array", "null"],
                    items: {
                      type: "object",
                      additionalProperties: false,
                      required: ["width_ft", "height_ft", "evidence"],
                      properties: {
                        width_ft: { type: ["number", "null"] },
                        height_ft: { type: ["number", "null"] },
                        evidence: { type: "string" }
                      }
                    }
                  },
                  noOpeningsEvidence: { type: ["string", "null"] },
                  message: { type: ["string", "null"] },
                  lineItems: {
                    type: "array",
                    items: {
                      type: "object",
                      additionalProperties: false,
                      required: [
                        "category",
                        "desc",
                        "qty",
                        "unit",
                        "materials",
                        "laborHours",
                        "equipmentOrSubCost",
                        "metadata"
                      ],
                      properties: {
                        category: { type: "string" },
                        desc: { type: "string" },
                        qty: { type: "number" },
                        unit: { type: "string" },
                        materials: {
                          type: "array",
                          items: {
                            type: "object",
                            additionalProperties: false,
                            required: [
                              "desc",
                              "qty",
                              "unit",
                              "unitCost",
                              "primary",
                              "quantityBasis",
                              "basisPerUnit"
                            ],
                            properties: {
                              desc: { type: "string" },
                              qty: { type: "number" },
                              unit: { type: "string" },
                              unitCost: {
                                type: "number",
                                description: "Direct material acquisition cost per unit only. Excludes labor, installation, equipment, subcontractor cost, overhead, profit, markup, tax, and delivery unless separately represented."
                              },
                              primary: { type: "boolean" },
                              quantityBasis: {
                                type: "string",
                                enum: ["roof-area", "siding-area", "wall-area", "ai-estimated"]
                              },
                              basisPerUnit: { type: ["number", "null"] }
                            }
                          }
                        },
                        laborHours: { type: "number" },
                        equipmentOrSubCost: { type: "number" },
                        metadata: {
                          type: "object",
                          additionalProperties: false,
                          required: ["assumptions"],
                          properties: {
                            assumptions: { type: "string" }
                          }
                        }
                      }
                    }
                  }
                }
              : {
                  action: { type: "string" },
                  lineItems: {
                    type: "array",
                    items: {
                      type: "object",
                      additionalProperties: false,
                      required: [
                        "category",
                        "desc",
                        "qty",
                        "unit",
                        "materials",
                        "laborHours",
                        "equipmentOrSubCost",
                        "metadata"
                      ],
                      properties: {
                        category: { type: "string" },
                        desc: { type: "string" },
                        qty: { type: "number" },
                        unit: { type: "string" },
                        materials: {
                          type: "array",
                          items: {
                            type: "object",
                            additionalProperties: false,
                            required: [
                              "desc",
                              "qty",
                              "unit",
                              "unitCost",
                              "primary",
                              "quantityBasis",
                              "basisPerUnit"
                            ],
                            properties: {
                              desc: { type: "string" },
                              qty: { type: "number" },
                              unit: { type: "string" },
                              unitCost: {
                                type: "number",
                                description: "Direct material acquisition cost per unit only. Excludes labor, installation, equipment, subcontractor cost, overhead, profit, markup, tax, and delivery unless separately represented."
                              },
                              primary: { type: "boolean" },
                              quantityBasis: {
                                type: "string",
                                enum: ["roof-area", "siding-area", "wall-area", "ai-estimated"]
                              },
                              basisPerUnit: { type: ["number", "null"] }
                            }
                          }
                        },
                        laborHours: { type: "number" },
                        equipmentOrSubCost: { type: "number" },
                        metadata: {
                          type: "object",
                          additionalProperties: false,
                          required: ["assumptions"],
                          properties: {
                            assumptions: { type: "string" }
                          }
                        }
                      }
                    }
                  },
                  deleteIndexes: {
                    type: "array",
                    items: { type: "number" }
                  },
                  updateItems: {
                    type: "array",
                    maxItems: 0,
                    items: {
                      type: "object",
                      additionalProperties: false,
                      properties: {},
                      required: []
                    }
                  },
                  exclusions: {
                    type: "array",
                    items: { type: "string" }
                  },
                  message: {
                    type: "string"
                  }
                };
            openaiBody.response_format = {
              type: "json_schema",
              json_schema: {
                name: isCO ? "change_order_generate_schema" : "estimate_generate_schema",
                strict: true,
                schema: {
                  type: "object",
                  additionalProperties: false,
                  required: schemaRequired,
                  properties: schemaProperties
                }
              }
            };
          }
          response = await fetch("https://api.openai.com/v1/chat/completions", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": "Bearer " + process.env.OPENAI_API_KEY
            },
            body: JSON.stringify(openaiBody),
          });
          if (mode === "change-order-generate") {
            console.log("CO_OPENAI_DIAGNOSTIC status", response && response.status, "ok", response && response.ok);
          }
          console.log("STEP 6 - OpenAI response received", { status: response.status, ok: response.ok });
          responseText = await response.text();
          try {
            const openaiJson = responseText ? JSON.parse(responseText) : {};
            if (mode === "change-order-generate") {
              const choice = openaiJson && openaiJson.choices && openaiJson.choices[0];
              const message = choice && choice.message ? choice.message : null;
              const refusal = message && message.refusal ? message.refusal : null;
              const content = message && message.content ? message.content : null;
              console.log("CO_OPENAI_DIAGNOSTIC finish_reason", choice && choice.finish_reason);
              console.log("CO_OPENAI_DIAGNOSTIC has_content", !!content);
              console.log("CO_OPENAI_DIAGNOSTIC content", content);
              console.log("CO_OPENAI_DIAGNOSTIC refusal", refusal);
              if (!response.ok) {
                console.log("CO_OPENAI_DIAGNOSTIC raw_error_response", responseText);
              }
            }
            const messageText = (openaiJson.choices && openaiJson.choices[0] && openaiJson.choices[0].message && openaiJson.choices[0].message.content) || "";
            data = { content: [{ text: messageText }], _raw: openaiJson };
          } catch (parseErr) {
            if (mode === "change-order-generate") {
              console.log("CO_OPENAI_DIAGNOSTIC parse_error", parseErr && parseErr.message ? parseErr.message : parseErr);
              console.log("CO_OPENAI_DIAGNOSTIC raw_response_text", responseText);
            }
            data = { rawText: responseText };
          }
          if (mode === "change-order-generate") {
            console.log("CO_OPENAI_DIAGNOSTIC parsed_data_keys", data && Object.keys(data));
            console.log("CO_OPENAI_DIAGNOSTIC parsed_content_text_exists", !!(data && data.content && data.content[0] && data.content[0].text));
          }
          console.log("STEP 7 - OpenAI response parsed", { status: response.status, mode, hasContent: !!(data && data.content) });
          if (!response.ok) {
            console.error("[/api/estimate] OpenAI non-OK response", { status: response.status, body: responseText, mode: mode });
          }
        } else {
          // Default: Anthropic
          response = await fetch("https://api.anthropic.com/v1/messages", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-api-key": apiKey,
              "anthropic-version": "2023-06-01",
            },
            body: JSON.stringify(anthropicBody),
          });
          console.log("STEP 6 - Anthropic response received", { status: response.status, ok: response.ok });
          responseText = await response.text();
          try {
            data = responseText ? JSON.parse(responseText) : {};
          } catch (parseErr) {
            data = { rawText: responseText };
          }
          console.log("STEP 7 - Anthropic response parsed", { status: response.status, mode, hasContent: !!(data && data.content) });
          if (!response.ok) {
            console.error("[/api/estimate] Anthropic non-OK response", {
              status: response.status,
              body: responseText,
              mode: mode,
            });
          }
        }
        if (isIntakeRequest && data && data.content && data.content[0] && typeof data.content[0].text === "string") {
          try {
            const rawText = data.content[0].text;
            const parsedText = JSON.parse(rawText.trim());
            const followUpRound = Boolean(body && body.questionContext && Array.isArray(body.questionContext.history) && body.questionContext.history.length);
            const readinessResult = isCOIntakeRequest ? validateCOIntakeReadiness({
              title: title || body.title || '',
              description: description || body.description || '',
              prompt: body.prompt || '',
              questionContext: body.questionContext || null
            }) : null;
            const finalObject = (() => {
              if (parsedText && (parsedText.action === "questions" || parsedText.action === "ready")) {
                let finalText = parsedText;
                if (isCOIntakeRequest && finalText.action === "ready" && readinessResult) {
                  finalText = readinessResult;
                }
                return finalText;
              }
              return null;
            })();

            console.log("CO_INTAKE_DIAGNOSTIC " + JSON.stringify({
              isCOIntakeRequest,
              round: followUpRound ? "follow-up" : "first",
              prompt: body && body.prompt,
              questionContext: body && body.questionContext,
              rawProviderText: rawText,
              extractedModelContent: data && data.content && data.content[0] && data.content[0].text,
              parsedIntakeObject: parsedText,
              validateCOIntakeReadiness: readinessResult,
              finalObject,
              status: response && response.status,
              httpStatus: response && response.status
            }, null, 0));

            if (finalObject) {
              console.log("STEP 8 - Returning response to client");
              return res.status(response.status).json(finalObject);
            }
          } catch (err) {
            console.log("CO_INTAKE_DIAGNOSTIC " + JSON.stringify({
              isCOIntakeRequest,
              round: Boolean(body && body.questionContext && Array.isArray(body.questionContext.history) && body.questionContext.history.length) ? "follow-up" : "first",
              prompt: body && body.prompt,
              questionContext: body && body.questionContext,
              rawProviderText: (data && data.content && data.content[0] && data.content[0].text) || null,
              extractedModelContent: (data && data.content && data.content[0] && data.content[0].text) || null,
              parsedIntakeObject: null,
              validateCOIntakeReadiness: null,
              finalObject: null,
              status: response && response.status,
              httpStatus: response && response.status,
              parseError: err && err.message ? err.message : err
            }, null, 0));
            // Fall back to the standard Anthropic response if the model does not follow the intake format.
          }
        }
        // If experiment flag is enabled and this is an estimate or CO generation run, normalize the AI breakdown server-side
        if (AI_BREAKDOWN_EXPERIMENT && (mode === 'estimate-generate' || mode === 'change-order-generate')){
          try{
            const rawText = (data && data.content && data.content[0] && data.content[0].text) || (data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || (data && data.rawText) || '';
            if (mode === "change-order-generate") {
              console.log("CO_OPENAI_DIAGNOSTIC rawText_before_parse", rawText);
            }
            console.log("AI BREAKDOWN RAW RESPONSE:", rawText);
            let parsed = null;
            try{ parsed = rawText ? JSON.parse(rawText.trim()) : null; }catch(pErr){
              if (mode === "change-order-generate") {
                console.log("CO_OPENAI_DIAGNOSTIC parse_failed", pErr && pErr.message ? pErr.message : pErr);
              }
              console.error("AI BREAKDOWN JSON PARSE FAILED:", rawText);
              parsed = null;
            }
            if (mode === "change-order-generate") {
              const parsedKeys = parsed && typeof parsed === 'object' ? Object.keys(parsed) : [];
              console.log("CO_OPENAI_DIAGNOSTIC parsed_keys", parsedKeys);
              console.log("CO_OPENAI_DIAGNOSTIC lineItems_is_array", !!(parsed && Array.isArray(parsed.lineItems)));
              console.log("CO_OPENAI_DIAGNOSTIC lineItems_length", parsed && Array.isArray(parsed.lineItems) ? parsed.lineItems.length : null);
            }
            if(!parsed || !Array.isArray(parsed.lineItems) || !parsed.lineItems.length){
              return res.status(200).json({action:'error',message:'AI must return JSON with a lineItems array containing materials and labor breakdown for each generated item.',rawText: rawText});
            }
            const inputTextForLabor = (body.title || '') + ' ' + (body.description || '') + ' ' + (body.prompt || '') + ' ' + (body.originalEstimateContext || '');
            const questionHistoryForLabor = body.questionContext && Array.isArray(body.questionContext.history) ? body.questionContext.history : [];
            const authoritativeLabor = buildAuthoritativeLaborFact(inputTextForLabor, questionHistoryForLabor);
            console.log('LABOR_AUTHORITY_DIAGNOSTIC ' + JSON.stringify({
              mode: mode,
              inputText: inputTextForLabor,
              questionHistory: questionHistoryForLabor,
              isResolved: !!(authoritativeLabor && authoritativeLabor.isResolved),
              crewSize: authoritativeLabor && authoritativeLabor.crewSize,
              durationValue: authoritativeLabor && authoritativeLabor.durationValue,
              durationUnit: authoritativeLabor && authoritativeLabor.durationUnit,
              totalHours: authoritativeLabor && authoritativeLabor.totalHours,
              source: authoritativeLabor && authoritativeLabor.source
            }, null, 0));
            if (mode === "change-order-generate") {
              const aiParsedBeforeNormalize = JSON.parse(JSON.stringify(parsed));
              console.log('CO_PRICING_DIAGNOSTIC ' + JSON.stringify({
                parsedAIOutputBeforeNormalize: aiParsedBeforeNormalize,
                authoritativeLabor: authoritativeLabor,
                note: 'Raw parsed model output before normalizeAIGenerated()'
              }, null, 0));
            }
            try {
              if (parsed.geometry) {
                const verified = verifyAndComputeCanonical(parsed, body.questionContext || {});
                applyPrimaryMaterialOverrides(parsed, verified);
              }
            } catch (phase1Err) {
              console.warn("AI BREAKDOWN PHASE1 GEOMETRY WARNING:", phase1Err && phase1Err.message ? phase1Err.message : phase1Err);
            }
            applyAuthoritativeMaterialPricing(parsed);
            if (mode === 'estimate-generate' || mode === 'change-order-generate') {
              const laborBefore = parsed.lineItems.map(function(li){
                return {
                  description: li && li.desc,
                  laborHours: Number(li && li.laborHours || 0)
                };
              });
              const summedBefore = laborBefore.reduce(function(total, row){ return total + Number(row.laborHours || 0); }, 0);
              console.log('LABOR_INVARIANT_BEFORE ' + JSON.stringify({
                mode: mode,
                authoritativeTotalHours: authoritativeLabor && authoritativeLabor.totalHours,
                rows: laborBefore,
                summedLaborHours: summedBefore
              }, null, 0));
              applyAuthoritativeLaborInvariant(parsed, authoritativeLabor);
              const laborAfter = parsed.lineItems.map(function(li){
                return {
                  description: li && li.desc,
                  laborHours: Number(li && li.laborHours || 0)
                };
              });
              const summedAfter = laborAfter.reduce(function(total, row){ return total + Number(row.laborHours || 0); }, 0);
              console.log('LABOR_INVARIANT_AFTER ' + JSON.stringify({
                mode: mode,
                authoritativeTotalHours: authoritativeLabor && authoritativeLabor.totalHours,
                rows: laborAfter,
                summedLaborHours: summedAfter
              }, null, 0));
              parsed.lineItems.forEach(function(li){
                alignLineItemQuantityToPrimaryMaterial(li);
              });
            }
            let normalized;
            if (mode === 'estimate-generate' || mode === 'change-order-generate') {
              const laborPreNormalize = parsed.lineItems.map(function(li){
                return {
                  description: li && li.desc,
                  laborHours: Number(li && li.laborHours || 0)
                };
              });
              const summedPreNormalize = laborPreNormalize.reduce(function(total, row){ return total + Number(row.laborHours || 0); }, 0);
              console.log('LABOR_PRE_NORMALIZE ' + JSON.stringify({
                mode: mode,
                rows: laborPreNormalize,
                summedLaborHours: summedPreNormalize
              }, null, 0));
            }
            try{
              normalized = normalizeAIGenerated(parsed, Number(body.laborRate ?? 85), Number(body.markup ?? 20));
            }catch(err){
              console.error("AI BREAKDOWN NORMALIZATION ERROR:", err.message || err);
              console.error("AI BREAKDOWN RAW RESPONSE:", rawText);
              throw err;
            }
            if(!normalized){
              return res.status(500).json({error:'Normalization failed.'});
            }
            const normalizedBudgetImpact = normalized.reduce(function(sum, li){
              return sum + (Number(li.total) || 0);
            }, 0);
            const markupPct = Number(body.markup ?? 20);
            const totalMaterialsCost = normalized.reduce(function(sum, li){
              return sum + (Number(li.aiBreakdown && li.aiBreakdown.materials ? li.aiBreakdown.materials.reduce(function(mSum, m){ return mSum + (Number(m.qty || 0) * Number(m.unitCost || 0)); }, 0) : 0) || 0);
            }, 0);
            const totalLaborHours = normalized.reduce(function(sum, li){
              return sum + (Number(li.aiBreakdown && li.aiBreakdown.laborHours) || 0);
            }, 0);
            const totalLaborCost = normalized.reduce(function(sum, li){
              return sum + (Number(li.total) || 0) - (Number(li.aiBreakdown && li.aiBreakdown.materials ? li.aiBreakdown.materials.reduce(function(mSum, m){ return mSum + (Number(m.qty || 0) * Number(m.unitCost || 0)); }, 0) : 0) || 0) - (Number(li.aiBreakdown && li.aiBreakdown.equipmentOrSubCost) || 0);
            }, 0);
            const totalEquipmentOrSubCost = normalized.reduce(function(sum, li){
              return sum + (Number(li.aiBreakdown && li.aiBreakdown.equipmentOrSubCost) || 0);
            }, 0);
            const subtotal = normalizedBudgetImpact;
            const markupAmount = Number((subtotal * (markupPct / 100)).toFixed(2));
            const finalTotal = Number((subtotal + markupAmount).toFixed(2));
            if (mode === "change-order-generate") {
              console.log('CO_PRICING_DIAGNOSTIC ' + JSON.stringify({
                lineItems: normalized.map(function(li){
                  const materialCost = Number(li.aiBreakdown && li.aiBreakdown.materials ? li.aiBreakdown.materials.reduce(function(s, m){ return s + (Number(m.qty || 0) * Number(m.unitCost || 0)); }, 0) : 0) || 0;
                  const laborHours = Number(li.aiBreakdown && li.aiBreakdown.laborHours) || 0;
                  const laborRate = Number(body.laborRate ?? 85);
                  const laborCost = Number((laborHours * laborRate).toFixed(2));
                  const equipmentOrSubCost = Number(li.aiBreakdown && li.aiBreakdown.equipmentOrSubCost) || 0;
                  const baseCost = Number((materialCost + laborCost + equipmentOrSubCost).toFixed(2));
                  const lineItemMarkupPct = Number(markupPct);
                  const lineItemMarkupAmount = Number((baseCost * (lineItemMarkupPct / 100)).toFixed(2));
                  return {
                    desc: li.desc,
                    materialCost: Number(materialCost.toFixed(2)),
                    laborHours: laborHours,
                    laborRate: laborRate,
                    laborCost: laborCost,
                    equipmentOrSubCost: Number(equipmentOrSubCost.toFixed(2)),
                    baseCost: Number(baseCost.toFixed(2)),
                    markupPct: lineItemMarkupPct,
                    markupAmount: Number(lineItemMarkupAmount.toFixed(2)),
                    finalLineItemTotal: Number((Number(li.total) || baseCost).toFixed(2))
                  };
                }),
                topLevelPricing: {
                  totalMaterialsCost: Number(totalMaterialsCost.toFixed(2)),
                  totalLaborHours: Number(totalLaborHours.toFixed(2)),
                  totalLaborCost: Number(totalLaborCost.toFixed(2)),
                  totalEquipmentOrSubCost: Number(totalEquipmentOrSubCost.toFixed(2)),
                  subtotal: Number(subtotal.toFixed(2)),
                  markupPct: markupPct,
                  markupAmount: Number(markupAmount.toFixed(2)),
                  budgetImpact: Number(normalizedBudgetImpact.toFixed(2)),
                  finalTotal: Number(finalTotal.toFixed(2))
                },
                note: 'Actual normalized line items and server totals after normalizeAIGenerated()'
              }, null, 0));
            }
            const out = mode === 'change-order-generate'
              ? {
                  title: parsed.title || title || '',
                  description: parsed.description || description || '',
                  lineItems: normalized,
                  baseCost: Number(normalizedBudgetImpact.toFixed(2)),
                  markupPct: markupPct,
                  markupAmount: Number(markupAmount.toFixed(2)),
                  budgetImpact: Number(finalTotal.toFixed(2)),
                  clientTotal: Number(finalTotal.toFixed(2)),
                  finalTotal: Number(finalTotal.toFixed(2)),
                  message: parsed.message || ''
                }
              : {
                  action: parsed.action || 'add',
                  lineItems: normalized,
                  deleteIndexes: parsed.deleteIndexes || [],
                  updateItems: parsed.updateItems || [],
                  exclusions: parsed.exclusions || [],
                  message: parsed.message || ''
                };
            console.log('STEP 8 - Returning normalized estimate to client');
            return res.status(response.status).json(out);
          }catch(err){
            console.error('STEP 8 ERROR - Normalization failed',err);
            if(err && err.stack) console.error(err.stack);
            return res.status(500).json({error:'Server normalization failure.'});
          }
        }
        console.log("STEP 8 - Returning response to client");
        return res.status(response.status).json(data);
      } catch (err) {
        console.error("STEP 5/6/7 ERROR - Anthropic request/response failed", err);
        if (err && err.stack) {
          console.error(err.stack);
        }
        throw err;
      }
    } catch (err) {
      console.error("STEP 3/4/5 ERROR - Processing failed", err);
      if (err && err.stack) {
        console.error(err.stack);
      }
      throw err;
    }
  } catch (err) {
    console.error("[/api/estimate] route error", err);
    if (err && err.stack) {
      console.error(err.stack);
    }
    return res.status(500).json({ error: "Failed to reach AI provider." });
  }
});

app.use((req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

if (require.main === module) {
  app.listen(PORT, "0.0.0.0", () => {
    console.log("Server running on port", PORT);
  });
}

module.exports = {
  app,
  validateCOIntakeReadiness,
  hasLaborDurationStatement,
  hasResolvedCrewOrLaborHoursFact,
  parseCrewSizeFromText,
  parseDurationFromText,
  parseTotalLaborHoursFromText,
  buildAuthoritativeLaborFact,
  applyAuthoritativeLaborInvariant,
  applyCOAuthoritativeLabor,
  alignLineItemQuantityToPrimaryMaterial,
  buildMaterialCompletenessContractText,
  buildMaterialPricingContractText,
  MATERIAL_PRICE_CATALOG,
  normalizeMaterialDescription,
  normalizeMaterialUnit,
  resolveCanonicalMaterialIdentity,
  resolveCatalogMaterialKey,
  applyAuthoritativeMaterialPricing,
};
