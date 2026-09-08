const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const port = Number(process.env.PVA_PORT || 5173);
const projectRoot = path.resolve(__dirname, "..");
const demoRoot = path.join(projectRoot, "demo");
const envPath = path.join(projectRoot, ".env");

if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/u)) {
    const match = line.match(/^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*?)\s*$/u);
    if (!match || match[1] in process.env) continue;
    process.env[match[1]] = match[2].replace(/^(['"])(.*)\1$/u, "$2");
  }
}

const aiProvider = process.env.AI_PROVIDER || (process.env.OPENROUTER_API_KEY ? "openrouter" : "huggingface");
const providerConfig = aiProvider === "openrouter"
  ? {
      name: "openrouter",
      endpoint: "https://openrouter.ai/api/v1/chat/completions",
      apiKey: process.env.OPENROUTER_API_KEY,
      model: process.env.OPENROUTER_MODEL || "qwen/qwen3-vl-30b-a3b-instruct"
    }
  : {
      name: "huggingface",
      endpoint: "https://router.huggingface.co/v1/chat/completions",
      apiKey: process.env.HF_TOKEN,
      model: process.env.HF_MODEL || "Qwen/Qwen3-VL-30B-A3B-Instruct"
    };
const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml"
};

const sendJson = (response, statusCode, body) => {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Cache-Control": "no-store"
  });
  response.end(JSON.stringify(body));
};

const readJsonBody = (request) => new Promise((resolve, reject) => {
  let body = "";

  request.on("data", (chunk) => {
    body += chunk;
    if (body.length > 5_000_000) {
      reject(new Error("Request is too large"));
      request.destroy();
    }
  });

  request.on("end", () => {
    try {
      resolve(JSON.parse(body));
    } catch {
      reject(new Error("Request body must be valid JSON"));
    }
  });
  request.on("error", reject);
});

const containsStructuredPii = (text) => {
  const email = /[\w.%+-]+@[\w.-]+\.[a-z]{2,}/iu;
  const longNumber = /(?:\+?\d[\d\s().-]{6,}\d)/u;
  return email.test(text) || longNumber.test(text);
};

const getFallbackDecision = (elements, reason) => {
  const continueButton = elements.find((element) =>
    element.role === "button" && element.label.toLowerCase() === "continue" && element.enabled !== false
  );

  return {
    message: continueButton
      ? "The next step is the Continue button."
      : "I could not find a safe action for this page.",
    action: continueButton
      ? {
          type: "click",
          targetId: continueButton.id,
          reason: "Safe deterministic fallback: this enabled button advances the application."
        }
      : null,
    mode: "fallback",
    modelError: reason
  };
};

const parseModelDecision = (content) => {
  const text = Array.isArray(content)
    ? content.map((part) => part.text || "").join("\n")
    : String(content || "");
  const unfenced = text.replace(/```(?:json)?/giu, "").replace(/```/gu, "").trim();
  const match = unfenced.match(/\{[\s\S]*\}/u);
  if (!match) throw new Error("Model did not return JSON");
  return JSON.parse(match[0]);
};

const validateModelDecision = (decision, elements) => {
  const message = typeof decision.message === "string" ? decision.message.slice(0, 400) : "Model response received.";
  if (!decision.action || decision.action.type === "none") return { message, action: null };

  const target = elements.find((element) => element.id === decision.action.targetId);
  if (!target) throw new Error("Model referenced an unknown element ID");
  if (target.sensitive) throw new Error("Model attempted to act on a sensitive element");
  if (decision.action.type !== "click") throw new Error("Model proposed a disallowed action type");
  if (target.role !== "button" || target.enabled === false) throw new Error("Model target is not an enabled button");

  return {
    message,
    action: {
      type: "click",
      targetId: target.id,
      reason: typeof decision.action.reason === "string"
        ? decision.action.reason.slice(0, 300)
        : "The model selected this safe, enabled button."
    }
  };
};

const requestModelDecision = async (payload, elements) => {
  if (!providerConfig.apiKey) {
    throw new Error(`${providerConfig.name === "openrouter" ? "OPENROUTER_API_KEY" : "HF_TOKEN"} is not configured`);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  const safeElementMap = elements.map(({ id, role, label, bounds, visible, enabled, sensitive }) => ({
    id, role, label, bounds, visible, enabled, sensitive
  }));
  const prompt = [
    "You are a privacy-preserving browser assistant.",
    `User task: ${payload.task}`,
    `Page title: ${payload.page.title}`,
    "The attached screenshot was redacted locally. Black regions contain private data and must not be inferred.",
    "Choose at most one safe action from the element map. Only click a non-sensitive enabled button.",
    "Return JSON only with this schema:",
    '{"message":"short explanation","action":{"type":"click","targetId":"e_N","reason":"why"}}',
    'If no safe action applies, use {"type":"none","targetId":"","reason":"why"}.',
    `Element map: ${JSON.stringify(safeElementMap)}`
  ].join("\n");
  const actionDecisionSchema = {
    type: "object",
    properties: {
      message: {
        type: "string",
        description: "A short explanation for the user."
      },
      action: {
        type: "object",
        properties: {
          type: { type: "string", enum: ["click", "none"] },
          targetId: { type: "string" },
          reason: { type: "string" }
        },
        required: ["type", "targetId", "reason"],
        additionalProperties: false
      }
    },
    required: ["message", "action"],
    additionalProperties: false
  };

  try {
    const apiResponse = await fetch(providerConfig.endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${providerConfig.apiKey}`,
        "Content-Type": "application/json",
        ...(providerConfig.name === "openrouter"
          ? { "HTTP-Referer": "http://localhost:5173", "X-Title": "VeilDOM" }
          : {})
      },
      body: JSON.stringify({
        model: providerConfig.model,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: prompt },
              { type: "image_url", image_url: { url: payload.sanitizedScreenshot.dataUrl } }
            ]
          }
        ],
        temperature: 0.1,
        max_tokens: 250,
        ...(providerConfig.name === "openrouter"
          ? {
              response_format: {
                type: "json_schema",
                json_schema: {
                  name: "browser_action_decision",
                  strict: true,
                  schema: actionDecisionSchema
                }
              },
              provider: { require_parameters: true }
            }
          : {})
      }),
      signal: controller.signal
    });

    const responseText = await apiResponse.text();
    if (!apiResponse.ok) {
      let providerMessage = `${providerConfig.name} returned ${apiResponse.status}`;
      try {
        const providerError = JSON.parse(responseText);
        providerMessage = providerError.error?.message || providerError.error || providerMessage;
      } catch {
        // Never echo arbitrary provider bodies or credentials to the client.
      }
      throw new Error(String(providerMessage).slice(0, 250));
    }

    const completion = JSON.parse(responseText);
    const message = completion.choices?.[0]?.message;
    const rawDecision = parseModelDecision(message?.content);
    return { ...validateModelDecision(rawDecision, elements), mode: "model", modelError: null };
  } finally {
    clearTimeout(timeout);
  }
};

const handleAssist = async (request, response) => {
  try {
    const payload = await readJsonBody(request);
    const elements = Array.isArray(payload.elements) ? payload.elements : [];
    const elementValueFieldCount = elements.filter((element) => Object.hasOwn(element, "value")).length;
    const screenshot = payload.sanitizedScreenshot;
    const rawScreenshotFieldCount = [
      Object.hasOwn(payload, "rawCapture"),
      Object.hasOwn(payload, "rawScreenshot"),
      Object.hasOwn(payload, "screenshot"),
      screenshot && Object.hasOwn(screenshot, "rawDataUrl")
    ].filter(Boolean).length;
    const validScreenshot =
      screenshot?.redactionApplied === true &&
      /^data:image\/(?:png|jpeg);base64,/u.test(screenshot.dataUrl || "") &&
      screenshot.dataUrl.length < 4_500_000;

    if (!payload.task || !payload.page?.title || elements.length === 0) {
      sendJson(response, 400, { error: "Task, page title, and element map are required." });
      return;
    }

    if (
      payload.sanitization?.rawValuesIncluded !== false ||
      payload.sanitization?.redactionApplied !== true ||
      elementValueFieldCount > 0 ||
      rawScreenshotFieldCount > 0 ||
      !validScreenshot ||
      containsStructuredPii(payload.task)
    ) {
      sendJson(response, 422, {
        error: "Privacy check failed: a redacted screenshot, safe task, and value-free element map are required."
      });
      return;
    }

    const startedAt = Date.now();
    const sanitizedImageBase64 = screenshot.dataUrl.split(",", 2)[1];
    const sanitizedImageSha256 = crypto
      .createHash("sha256")
      .update(Buffer.from(sanitizedImageBase64, "base64"))
      .digest("hex");
    let decision;
    try {
      decision = await requestModelDecision(payload, elements);
    } catch (error) {
      decision = getFallbackDecision(elements, error.name === "AbortError" ? "Model request timed out" : error.message);
    }

    sendJson(response, 200, {
      message: decision.message,
      action: decision.action,
      debug: {
        mode: decision.mode,
        provider: decision.mode === "model" ? providerConfig.name : null,
        model: decision.mode === "model" ? providerConfig.model : null,
        modelError: decision.modelError,
        serverLatencyMs: Date.now() - startedAt,
        sanitizedImageBytes: Math.round(screenshot.dataUrl.length * 0.75),
        receivedElementCount: elements.length,
        receivedRawValues: false,
        privacyProof: {
          elementValueFieldCount,
          rawScreenshotFieldCount,
          taskStructuredPiiDetected: false,
          redactionApplied: true,
          redactionRegionCount: Array.isArray(screenshot.regions) ? screenshot.regions.length : 0,
          sanitizedImageSha256
        }
      }
    });
  } catch (error) {
    sendJson(response, error.message === "Request is too large" ? 413 : 400, { error: error.message });
  }
};

const server = http.createServer((request, response) => {
  if (request.method === "OPTIONS" && request.url === "/api/assist") {
    response.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type"
    });
    response.end();
    return;
  }

  if (request.method === "POST" && request.url === "/api/assist") {
    handleAssist(request, response);
    return;
  }

  const requestPath = request.url === "/" ? "/index.html" : request.url;
  const safePath = path.normalize(requestPath).replace(/^(\.\.[/\\])+/, "");
  const filePath = path.join(demoRoot, safePath);

  if (!filePath.startsWith(demoRoot)) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }

  fs.readFile(filePath, (error, data) => {
    if (error) {
      response.writeHead(error.code === "ENOENT" ? 404 : 500);
      response.end(error.code === "ENOENT" ? "Not found" : "Server error");
      return;
    }

    response.writeHead(200, {
      "Content-Type": contentTypes[path.extname(filePath)] || "application/octet-stream",
      "Cache-Control": "no-store"
    });
    response.end(data);
  });
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Secure demo page: http://localhost:${port}`);
});
