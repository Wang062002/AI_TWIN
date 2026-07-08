# API Provider 配置示例

当前代码默认调用 OpenAI-compatible 接口：

```text
POST {AI_TWIN_BASE_URL}/chat/completions
Authorization: Bearer {AI_TWIN_API_KEY}
```

所以不需要现在就把厂商写死。等你决定用哪家 API 时，只要把下面三项填进 `.env`：

```text
AI_TWIN_BASE_URL=厂商提供的 v1 地址
AI_TWIN_API_KEY=你的 key
AI_TWIN_MODEL=模型名
```

## 常见情况

### 1. 完全兼容 OpenAI 格式

不需要改代码，只填 `.env`。

### 2. URL 兼容，但字段名有细微差异

修改 `src/provider.js` 里的请求 body 或响应解析。

### 3. 完全不兼容

新增一个 provider adapter，例如：

```text
src/providers/deepseek.js
src/providers/qwen.js
src/providers/kimi.js
src/providers/glm.js
```

然后在配置里选择 provider。

## 我最终需要你提供的信息

- 厂商名
- base url
- 模型名
- 是否支持 OpenAI-compatible chat/completions
- 是否支持 stream
- 是否有上下文长度和限流说明

API Key 不需要发给我，填在你本地 `.env` 就行。
