const express = require("express");
const cors = require("cors");
const path = require("path");
const app = express();
const PORT = process.env.PORT || 5000;
const AI_BREAKDOWN_EXPERIMENT = (process.env.AI_BREAKDOWN_EXPERIMENT === 'true' || process.env.AI_BREAKDOWN_EXPERIMENT === '1');

function _round2(n){ return Math.round((parseFloat(n)||0)*100)/100; }

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
      const isIntakeRequest = mode === "estimate-intake";
      const isEstimateRequest = mode === "estimate" || mode === "estimate-generate";
      console.log("STEP 3 - Internal mode determined", { mode, isIntakeRequest, isEstimateRequest });

      let anthropicBody = {
        model: body.model || "claude-haiku-4-5-20251001",
        max_tokens: body.max_tokens || 2000,
        messages: body.messages || [{ role: "user", content: body.prompt || "" }],
      };

      try {
        if (isIntakeRequest || isEstimateRequest) {
          const items = body.items || "[]";
          const existingExcls = body.excls || "[]";
          const markup = body.markup || 20;
          const laborRate = body.laborRate || 85;
          const location = body.location || "";
          const histCtx = body.histCtx || "";
          const prompt = body.prompt || "";
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
            " Ask only follow-up questions whose answers could materially affect project scope, quantity, labor, materials, equipment, subcontractor cost, schedule-driven cost, or total price." +
            " Do not ask administrative questions such as client name, property owner name, contact information, or other project-profile details unless they directly affect pricing." +
            " Treat the original estimate request and prior questionContext as authoritative known information." +
            " Never ask the user to restate the project type, main scope, or other information already provided." +
            " Prefer specific construction questions over generic questions; for example, ask about roof type, siding, door size, electrical feed, slab conditions, finishes, access, or other scope-specific details when relevant rather than asking broad questions like “What are the main deliverables?”." +
            " Ask only the minimum number of questions necessary to produce a defensible estimate." +
            " Do not ask about project budget; ContractorDesk calculates cost and budget is not part of intake." +
            " Treat unknown or unavailable answers as valid responses." +
            " Do not repeat a question simply because the answer was “don't know”, “unknown”, “not sure”, “N/A”, or similar." +
            " Use the provided questionContext as authoritative history. If a question has already been asked and has a corresponding answer, consider it resolved and do not ask it again." +
            " Do not explain anything.";
          let systemPrompt;
          if (isIntakeRequest) {
            systemPrompt = isIntakePrompt;
          } else if (AI_BREAKDOWN_EXPERIMENT && mode === 'estimate-generate') {
            // Experimental prompt: require AI to return explicit breakdowns (materials, laborHours, equipmentOrSubCost)
            systemPrompt =
              "IMPORTANT: Your entire response must be a single raw JSON object. No markdown, no code fences, no backticks, no explanation. Start your response with { and end with }. You are a construction estimator." +
              " RETURN JSON with this top-level shape: {\"action\":\"add|update|ready\",\"lineItems\":[{...}],\"deleteIndexes\":[],\"updateItems\":[],\"exclusions\":[],\"message\":\"\"}." +
              " For this experiment each line item MUST follow this structure exactly (use the exact fields and types): " +
              "{\"category\":\"...\",\"desc\":\"...\",\"qty\":number,\"unit\":\"...\",\"materials\":[{\"desc\":\"...\",\"qty\":number,\"unit\":\"...\",\"unitCost\":number}],\"laborHours\":number,\"equipmentOrSubCost\":number,\"metadata\":{\"assumptions\":\"...\"}}" +
              " STRICT RULES:" +
              " - materials must always be an array (use [] when no materials apply)." +
              " - laborHours must always be numeric (use 0 when none)." +
              " - equipmentOrSubCost must always be numeric (use 0 when none)." +
              " IMPORTANT: Do NOT return authoritative materialCost, laborCost, baseCost, unitCost, total, or markup. Do NOT return any lump-sum totals. The model should only determine quantities, material unit prices, labor hours, and assumptions. ContractorDesk will perform all arithmetic and apply the authoritative markup exactly once." +
              " Current items: " + items + " Current exclusions: " + existingExcls +
              (location ? " Location: " + location + "." : "") +
              (histCtx ? " HISTORICAL: " + histCtx + "." : "") +
              " RETURN valid JSON only.";
          } else {
            systemPrompt =
              "IMPORTANT: Your entire response must be a single raw JSON object." +
              " No markdown, no code fences, no backticks, no explanation." +
              " Start your response with { and end with }." +
              " You are a construction estimator." +
              ' Format: {"action":"add","lineItems":[{"category":"Labor","desc":"description","qty":1,"unit":"hrs","unitCost":85,"total":85,"markup":20}],"deleteIndexes":[],"updateItems":[],"exclusions":[],"message":"what was done"}' +
              " IMPORTANT: total = qty * unitCost. markup = percentage for client price." +
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
          // If experiment flag is enabled and mode is estimate-generate, and the model is instructed
          // to return breakdown-only line items, we must enforce that via the system prompt.
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

        // If this is an intake request or final estimate generation and OPENAI_API_KEY is present, route to OpenAI
        if ((isIntakeRequest || mode === "estimate-generate") && process.env.OPENAI_API_KEY) {
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
          response = await fetch("https://api.openai.com/v1/chat/completions", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": "Bearer " + process.env.OPENAI_API_KEY
            },
            body: JSON.stringify(openaiBody),
          });
          console.log("STEP 6 - OpenAI response received", { status: response.status, ok: response.ok });
          responseText = await response.text();
          try {
            const openaiJson = responseText ? JSON.parse(responseText) : {};
            const messageText = (openaiJson.choices && openaiJson.choices[0] && openaiJson.choices[0].message && openaiJson.choices[0].message.content) || "";
            data = { content: [{ text: messageText }], _raw: openaiJson };
          } catch (parseErr) {
            data = { rawText: responseText };
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
            const parsedText = JSON.parse(data.content[0].text.trim());
            if (
              parsedText &&
              (parsedText.action === "questions" || parsedText.action === "ready")
            ) {
              console.log("STEP 8 - Returning response to client");
              return res.status(response.status).json(parsedText);
            }
          } catch (err) {
            // Fall back to the standard Anthropic response if the model does not follow the intake format.
          }
        }
        // If experiment flag is enabled and this is an estimate generation run, normalize the AI breakdown server-side
        if (AI_BREAKDOWN_EXPERIMENT && mode === 'estimate-generate'){
          try{
            const rawText = (data && data.content && data.content[0] && data.content[0].text) || (data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || (data && data.rawText) || '';
            // Diagnostic: log raw AI response for experiment runs
            console.log("AI BREAKDOWN RAW RESPONSE:", rawText);
            let parsed = null;
            try{ parsed = rawText ? JSON.parse(rawText.trim()) : null; }catch(pErr){
              console.error("AI BREAKDOWN JSON PARSE FAILED:", rawText);
              parsed = null;
            }
            if(!parsed || !Array.isArray(parsed.lineItems) || !parsed.lineItems.length){
              return res.status(200).json({action:'error',message:'AI must return JSON with a lineItems array containing materials and labor breakdown for each generated item.',rawText: rawText});
            }
            let normalized;
            try{
              normalized = normalizeAIGenerated(parsed, Number(laborRate)||85, Number(markup)||20);
            }catch(err){
              console.error("AI BREAKDOWN NORMALIZATION ERROR:", err.message || err);
              console.error("AI BREAKDOWN RAW RESPONSE:", rawText);
              throw err;
            }
            if(!normalized){
              return res.status(500).json({error:'Normalization failed.'});
            }
            const out = {
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

app.listen(PORT, "0.0.0.0", () => {
  console.log("Server running on port", PORT);
});
