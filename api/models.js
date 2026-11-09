export const access = "public";
export const methods = ["GET"];

export const SUPPORTED_MODELS = [
  {
    id: "gemini-2.5-flash",
    name: "Google Gemini 2.5 Flash",
    tag: "Recommended / Default",
    isDefault: true,
    description: "Next-gen multimodal reasoning model with fast tool-calling and low latency.",
    contextWindow: "1M tokens",
    mode: "live-llm"
  },
  {
    id: "gemini-2.0-flash",
    name: "Google Gemini 2.0 Flash",
    tag: "Stable Flash",
    isDefault: false,
    description: "High-speed conversational agent with native tool execution.",
    contextWindow: "1M tokens",
    mode: "live-llm"
  },
  {
    id: "gemini-1.5-flash",
    name: "Google Gemini 1.5 Flash",
    tag: "High Efficiency",
    isDefault: false,
    description: "Lightweight flash model optimized for quick chat responses.",
    contextWindow: "1M tokens",
    mode: "live-llm"
  },
  {
    id: "gemini-1.5-pro",
    name: "Google Gemini 1.5 Pro",
    tag: "Deep Reasoning",
    isDefault: false,
    description: "Advanced reasoning model for complex multi-turn constraint analysis.",
    contextWindow: "2M tokens",
    mode: "live-llm"
  },
  {
    id: "offline-rule-engine",
    name: "Offline Deterministic Agent (Rule Engine)",
    tag: "Local Fallback",
    isDefault: false,
    description: "100% offline, privacy-first multi-agent coordinator using mathematical ranking.",
    contextWindow: "Infinite (Zero Cloud)",
    mode: "offline"
  }
];

export default async function handler(req, res) {
  const envModel = process.env.GEMINI_MODEL || "gemini-2.5-flash";
  const hasKey = Boolean(process.env.GEMINI_API_KEY);

  return res.json({
    ok: true,
    activeDefaultModel: envModel,
    geminiConfigured: hasKey,
    activeEngine: hasKey ? "Hybrid (Gemini Live LLM + Deterministic Validator)" : "Offline Deterministic Agent Mode",
    models: SUPPORTED_MODELS
  });
}

