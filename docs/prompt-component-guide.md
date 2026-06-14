# 新 Prompt 组件接入规范

> 所有新增 prompt 内容必须通过 Manifest Fragment 接入，禁止直接拼接大段字符串。

## 规范

### 1. 使用 `PromptFragment` 描述每段 prompt

每个独立的 prompt 段落（规则、意图、角色声音、示例等）必须定义为 `PromptFragment`：

```typescript
import type { PromptFragment } from "@actalk/inkos-core";

const myFragment: PromptFragment = {
  id: "my-feature-rules",
  source: "my-feature",
  role: "system",
  slot: "rules",
  priority: 80,
  content: "...",
  optional: true,
  estimatedTokens: estimateTokens(content),
};
```

### 2. 通过 Manifest 装配，不直接拼接

```typescript
// ❌ 禁止
const fullPrompt = systemPrompt + "\n" + myRules + "\n" + intentBlock;

// ✅ 正确
const fragments = [
  { id: "system", source: "base", role: "system", slot: "base", priority: 100, content: systemPrompt, optional: false, estimatedTokens: estimateTokens(systemPrompt) },
  { id: "my-rules", source: "my-feature", role: "system", slot: "rules", priority: 80, content: myRules, optional: true, estimatedTokens: estimateTokens(myRules) },
];
const manifest = buildPromptManifest({ stage: "my-agent", fragments, maxAllowedInputTokens });
```

### 3. 接入 Manifest 日志

在 Agent 的 `chat()` 调用前插入：

```typescript
logPromptManifest(this.name, messages, this.ctx.model, this.log);
```

### 4. 遵守 Token 预算

- 使用 `getAvailableInputTokens(modelId)` 获取可用输入 Token
- `optional: true` 的 fragment 当超预算时被自动丢弃
- 核心规则（如禁写项、hard rule）必须标记 `priority: 100` + `optional: false`

### 5. 新增组件必须

- 有 feature flag 或配置项可关闭
- 关闭后管线行为 100% 不变
- 失败时降级为记录日志（advisory），不阻塞主流程
