export async function callChatCompletions(provider, messages) {
  if (!provider.apiKey) {
    throw new Error("Missing AI_TWIN_API_KEY. 请复制 .env.example 为 .env 并填写 API Key。");
  }
  if (!provider.baseUrl || !provider.model) {
    throw new Error("Missing AI_TWIN_BASE_URL or AI_TWIN_MODEL. 请在 .env 中填写接口地址和模型名。");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), provider.timeoutMs || 60000);
  const url = `${provider.baseUrl.replace(/\/$/, "")}/chat/completions`;

  try {
    const response = await fetch(url, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${provider.apiKey}`
      },
      body: JSON.stringify({
        model: provider.model,
        messages,
        temperature: provider.temperature ?? 0.75,
        top_p: provider.topP ?? 0.9,
        max_tokens: provider.maxTokens ?? 500
      })
    });

    const text = await response.text();
    if (!response.ok) {
      throw new Error(`API request failed: ${response.status} ${response.statusText}\n${text}`);
    }
    const data = JSON.parse(text);
    const content = data.choices?.[0]?.message?.content;
    if (!content) throw new Error(`API response has no message content: ${text}`);
    return content.trim();
  } finally {
    clearTimeout(timeout);
  }
}
