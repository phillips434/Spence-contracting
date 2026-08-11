const express = require("express");
const cors = require("cors");
const path = require("path");
const app = express();
const PORT = process.env.PORT || 5000;

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
          const systemPrompt = isIntakeRequest
            ? isIntakePrompt
            : "IMPORTANT: Your entire response must be a single raw JSON object." +
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

        // If this is an intake request and OPENAI_API_KEY is present, route intake to OpenAI
        if (isIntakeRequest && process.env.OPENAI_API_KEY) {
          const openaiModel = "gpt-4.1";
          const openaiBody = {
            model: openaiModel,
            messages: [
              { role: "system", content: systemPrompt || "" },
              { role: "user", content: prompt + followUpContext }
            ],
            max_tokens: maxTok,
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
    return res.status(500).json({ error: "Failed to reach Anthropic API." });
  }
});

app.use((req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, "0.0.0.0", () => {
  console.log("Server running on port", PORT);
});
