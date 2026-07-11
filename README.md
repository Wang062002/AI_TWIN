# AI Twin API RAG

这个版本是项目重启后的新路线：不再本地训练或部署基座模型，而是用本地知识库 + few-shot/RAG + 公司 API 模型来生成数字分身回复。

## 目录

```text
data/raw/mom/raw.json              原始聊天数据
data/knowledge_bases/mom/          构建后的 mom 知识库
scripts/build_kb.js                从聊天记录构建知识库
scripts/chat_demo.js               本地命令行聊天测试
src/config.js                      读取 .env 和配置
src/kb.js                          加载知识库
src/retriever.js                   本地轻量检索
src/prompt.js                      组装人格/记忆/few-shot prompt
src/provider.js                    调用 OpenAI-compatible API
src/text.js                        文本清洗与分类
prototype/                         移动端前端原型
```

## API 厂商是否需要提前确定？

不需要。当前框架按 OpenAI-compatible 接口设计，大多数模型厂商都能通过三项配置接入：

```text
AI_TWIN_BASE_URL
AI_TWIN_API_KEY
AI_TWIN_MODEL
```

后面你告诉我具体厂商时，只需要补对应的 base url 和模型名。如果某家接口不兼容，再单独加一个 adapter。

更多说明见 [config/providers.example.md](config/providers.example.md)。

## 使用

1. 构建 mom 知识库：

```powershell
npm run build:kb:mom
```

2. 先不用 API，跑 mock 检查检索和 prompt：

```powershell
npm run chat:mom:mock
```

3. 填写 `.env` 后调用真实 API：

```powershell
Copy-Item .env.siliconflow.example .env
# 编辑 .env 后执行
npm run chat:mom
```

也可以单次测试一条消息：

```powershell
node scripts/chat_demo.js --person mom --message "我今天去面试了，有点紧张"
```

如果想先看检索结果和 prompt，不调用真实 API：

```powershell
node scripts/chat_demo.js --person mom --mock --preview --message "我今天去面试了，有点紧张"
```

## 当前技术闭环

```text
用户输入
-> 本地知识库检索
-> 读取人物画像
-> 选择风格样本
-> 拼接安全边界和生成规则
-> 调用 API 模型
-> 输出分身回复
-> 标记可能需要确认的新记忆
```
