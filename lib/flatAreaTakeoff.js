'use strict';

// Parse only explicit rectangular dimensions. Scope selection remains an estimator decision.
function dimensionCatalog(source) {
  const text=String(source||'').replace(/[′’]/g,"'").replace(/[″“”]/g,'"');
  const unit="(?:feet|foot|ft|inches|inch|in|['\"])";
  const pattern=new RegExp('(\\d+(?:\\.\\d+)?)\\s*('+unit+')?\\s*(?:long\\s*)?[x×]\\s*(\\d+(?:\\.\\d+)?)\\s*('+unit+')?', 'gi');
  const rows=[];
  for(const match of text.matchAll(pattern)) {
    const aUnit=match[2]||match[4],bUnit=match[4]||match[2];
    if(!aUnit||!bUnit)continue; // Never silently interpret unlabelled dimensions.
    const feet=(value,u)=>Number(value)/(/^(in|inch|inches|\")$/i.test(u)?12:1);
    const width=feet(match[1],aUnit),height=feet(match[3],bUnit);
    if(width<=0||height<=0||!Number.isFinite(width*height))continue;
    rows.push({index:rows.length,evidence:match[0],areaSF:width*height});
  }
  return rows;
}

function applyAreaTakeoffs(parsed,catalog) {
  const items=Array.isArray(parsed.lineItems)?parsed.lineItems:[];
  const takeoffs=parsed.quantityTakeoffs||[];
  if(!Array.isArray(takeoffs))throw Error('Invalid quantity takeoff list');
  const usedRows=new Set(),notes=[];
  const round=n=>Math.round((n+Number.EPSILON)*100)/100;
  for(const takeoff of takeoffs) {
    const item=items[takeoff.lineItemIndex];
    if(!Number.isInteger(takeoff.lineItemIndex)||!item||usedRows.has(takeoff.lineItemIndex)||item.category!=='Materials'||!/^(sf|sq\.?\s*ft\.?|square feet)$/i.test(item.unit))throw Error('Area takeoff must reference one new square-foot material row');
    usedRows.add(takeoff.lineItemIndex);
    const includes=takeoff.dimensionIndexes,subtracts=takeoff.subtractDimensionIndexes;
    if(!Array.isArray(includes)||!includes.length||!Array.isArray(subtracts))throw Error('Area takeoff needs measured surfaces');
    const all=[...includes,...subtracts];
    if(new Set(all).size!==all.length||all.some(i=>!Number.isInteger(i)||!catalog[i]))throw Error('Area takeoff has duplicate or unknown measurement references');
    if(!Number.isFinite(takeoff.wastePercent)||takeoff.wastePercent<0||takeoff.wastePercent>100)throw Error('Invalid area takeoff waste');
    const gross=includes.reduce((sum,i)=>sum+catalog[i].areaSF,0);
    const deduction=subtracts.reduce((sum,i)=>sum+catalog[i].areaSF,0);
    const net=gross-deduction;
    if(net<=0)throw Error('Opening deductions exceed measured surface area');
    item.qty=round(net*(1+takeoff.wastePercent/100));
    if(!Number.isFinite(item.qty)||item.qty<=0)throw Error('Invalid computed area quantity');
    notes.push('Quantity basis for '+item.desc+': '+includes.map(i=>catalog[i].evidence).join(' + ')+' = '+round(gross)+' SF gross; less '+round(deduction)+' SF openings; '+takeoff.wastePercent+'% waste = '+item.qty+' SF. Verify surface selection, measurements and waste before sending.');
  }
  // A measured flat-panel request must not silently fall back to model arithmetic.
  items.forEach((item,index)=>{
    if(catalog.length&&item.category==='Materials'&&/^(sf|sq\.?\s*ft\.?|square feet)$/i.test(item.unit)&&/master\s*rib|metal.*panels?/i.test(item.desc)&&!usedRows.has(index))throw Error('Measured metal panel quantities require a rectangular area takeoff. No estimate changes were applied.');
  });
  if(notes.length)parsed.conditionsAssumptions=[...(parsed.conditionsAssumptions||[]),...notes];
  return parsed;
}

function takeoffPrompt(catalog) {
  return ' RECTANGULAR AREA TAKEOFF: Return quantityTakeoffs as an array (empty when not applicable). For new square-foot Materials rows based on measured rectangular surfaces, return {lineItemIndex,dimensionIndexes,subtractDimensionIndexes,wastePercent}. Indexes refer only to this measurement catalog: '+JSON.stringify(catalog)+'. Select every explicitly included face exactly once; exclude drywall-only faces from metal panel takeoffs and do not double-count an already counted partition face. Use subtractDimensionIndexes only for applicable openings. The server computes area, deductions, waste and qty; do not trust mental arithmetic. Measured metal panel SF rows MUST have a takeoff. Do not use this rectangle calculator for roof slope, perimeter-derived walls, lengths, counts, labor or existing updateItems. Describe uncomputed quantities and waste assumptions in conditionsAssumptions for contractor review. Missing or ambiguous measurements require clarification, not invented dimensions.';
}

module.exports={dimensionCatalog,applyAreaTakeoffs,takeoffPrompt};
