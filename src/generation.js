import { callChatCompletions } from "./provider.js";
import { assessResponse } from "./response_guard.js";

export async function generateGuardedReply(provider, messages, options = {}) {
  const input = String(options.input || "");
  const retrieved = options.retrieved || {};
  const maxRetries = Number.isFinite(options.maxRetries) ? options.maxRetries : 1;
  const callModel = options.callModel || callChatCompletions;
  const attempts = [];

  let reply = await callModel(provider, messages);
  let assessment = assessResponse({ input, reply, retrieved });
  attempts.push({ reply, assessment, retry: false });

  for (let retry = 0; retry < maxRetries && assessment.has_risk; retry += 1) {
    const retryMessages = [
      ...messages,
      {
        role: "assistant",
        content: reply
      },
      {
        role: "user",
        content: buildRetryInstruction(assessment)
      }
    ];
    reply = await callModel(provider, retryMessages);
    assessment = assessResponse({ input, reply, retrieved });
    attempts.push({ reply, assessment, retry: true });
  }

  return {
    reply,
    assessment,
    attempts,
    retried: attempts.length > 1,
    retry_count: Math.max(0, attempts.length - 1)
  };
}

function buildRetryInstruction(assessment) {
  const riskLines = [];
  if (assessment.boundary_risks.length) {
    riskLines.push(`Boundary risks: ${assessment.boundary_risks.join(", ")}`);
  }
  if (assessment.copy_risks.length) {
    const copySources = assessment.copy_risks.map((risk) => `${risk.type}:${risk.source}`).join(", ");
    riskLines.push(`Copy risks: ${copySources}`);
  }

  return [
    "Rewrite the previous draft as the final chat reply.",
    "Keep the target person's short natural chat style.",
    "Do not explain that you are rewriting.",
    "Fix these risks:",
    ...riskLines.map((line) => `- ${line}`),
    "If the issue is current real-world status, location, availability, or offline meetup, do not claim where the real person is or what they are doing now. If needed, briefly say you can only chat here.",
    "If the issue is copying retrieved history, keep only the useful fact or tone and paraphrase it. Do not reuse the same long wording.",
    "Return only the rewritten reply."
  ].join("\n");
}
