# Development Workflow

这个项目按长期维护方式开发：代码进 GitHub，隐私数据留在本地。

## 分支建议

- `main`: 稳定主分支，只合入已经跑通过的功能。
- `feature/*`: 新功能分支，例如 `feature/api-chat-demo`。
- `fix/*`: 修复分支，例如 `fix/retrieval-ranking`。

## 提交前检查

```powershell
npm run check
npm run build:kb:mom
npm run chat:mom:mock
```

## 隐私规则

不要提交以下内容：

- `.env`
- `data/raw/`
- `data/knowledge_bases/`
- API key
- 用户真实聊天记录
- 可还原用户身份的导出文件

如果后续需要示例数据，应该单独制作脱敏样例，例如：

```text
data/samples/mom_sample.json
```

## Issue 管理建议

建议用 GitHub issues 拆任务：

- `product`: 产品和业务场景
- `frontend`: 移动端 UI 原型
- `kb`: 知识库构建
- `retrieval`: 检索和排序
- `prompt`: 人物风格 prompt
- `api`: 模型 API 接入
- `safety`: 情绪安全和边界策略
- `privacy`: 本地数据和加密

## 当前技术路线

```text
本地聊天记录
-> 知识库构建
-> 本地检索
-> few-shot / 人物画像 / 安全边界 prompt
-> API 模型生成
-> 待确认记忆
```
