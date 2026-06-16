# InkOS Git 工作流与推送标准

> 最后更新：2026-06-15

---

## 一、远程仓库

| 名称 | URL | 用途 |
|------|-----|------|
| `origin` | `https://github.com/13311314513z-byte/Nofusion.git` | 主仓库（GitHub） |
| `gitee` | `https://gitee.com/BroWhite/nofusion` | 国内镜像（Gitee） |

> ⚠️ GitHub 使用 HTTPS 协议，推送需 Personal Access Token。

---

## 二、分支策略

| 分支 | 用途 | 保护 |
|------|------|:----:|
| `master` | 主开发分支，所有功能合入此处 | 需 typecheck + test 通过 |
| `gitee/main` | Gitee 侧独立分支（历史不相关） | 合并到 master 时需 `--allow-unrelated-histories` |

当前默认推送目标：`master`。

---

## 三、推送前检查清单

每次推送前必须通过以下检查：

```bash
# 1. 类型检查
pnpm -r typecheck

# 2. 构建（可选但建议）
pnpm -r build

# 3. 测试
pnpm -r test

# 4. 查看工作区状态
git status
```

### 快速验证单命令

```bash
node node_modules\typescript\bin\tsc -p packages\core\tsconfig.json --noEmit && ^
node node_modules\typescript\bin\tsc -p packages\cli\tsconfig.json --noEmit && ^
node node_modules\typescript\bin\tsc -p packages\studio\tsconfig.server.json --noEmit && ^
node node_modules\typescript\bin\tsc -p packages\studio\tsconfig.json --noEmit && ^
echo "ALL TYPECHECKS PASSED"
```

---

## 四、提交规范

### 提交信息格式

```
<type>: <description>

[optional body]
```

| type | 用途 |
|------|------|
| `feat` | 新功能 |
| `fix` | 错误修复 |
| `refactor` | 重构 |
| `test` | 测试 |
| `docs` | 文档 |
| `chore` | 工程维护 |
| `perf` | 性能优化 |

### 示例

```
feat: Writer prompt injects voice profiles from story/voice_profiles/
fix: Event chain deep import now uses root @actalk/inkos-core entry
chore: track reports directory with assessment documents
```

### 不允许的提交

```
❌ 提交包含 node_modules/ 或 dist/ 中的文件
❌ 提交包含未解决的冲突标记（<<<<<<<, =======, >>>>>>>）
❌ 提交时 typecheck 失败
❌ 提交的测试文件未通过
```

---

## 五、推送流程

### 首次推送或新分支

```bash
# 推送到 GitHub
git push origin master

# 推送到 Gitee
git push gitee master
```

### 同时推送到两个远端

```bash
# 方式 1：分别推送
git push origin master
git push gitee master

# 方式 2：设置多个 push URL（仅当前仓库）
git remote set-url --add --push origin https://github.com/13311314513z-byte/Nofusion.git
git remote set-url --add --push origin https://gitee.com/BroWhite/nofusion.git
git push  # 一次 push 到两个远端
```

---

## 六、忽略规则

当前 `.gitignore` 内容（2026-06-15 修订）：

```gitignore
.env
node_modules/
.DS_Store
.inkos/
tmp-test-logs/
.tmp-test-logs/
books/
dist/
coverage/
*.tsbuildinfo
*.log
**/test-results.txt
```

### 关键说明

| 路径 | 处理方式 | 原因 |
|------|----------|------|
| `reports/` | **已从忽略名单移除** | 评估文档和校准数据需要版本控制 |
| `books/` | 忽略 | 真实书籍数据含版权内容，仅保留脱敏夹具 |
| `dist/` | 忽略 | 构建产物，由 `tsc` 在 CI 中生成 |
| `node_modules/` | 忽略 | 由 `pnpm install` 安装 |

---

## 七、仓库治理

### 应提交的文件

```text
src/              ← 源代码（全部）
reports/          ← 评估报告、校准数据
scripts/          ← 工具脚本
docs/             ← 技术文档
packages/*/src/   ← 各包子源
```

### 不应提交的文件

```text
books/<真实书稿>/     ← 真实书稿数据
.env                  ← 环境变量（含 API Key）
*.log                 ← 运行日志
dist/                 ← 编译产物
node_modules/         ← 依赖包
*.tsbuildinfo         ← TypeScript 构建缓存
```

### 提交前 diff 检查

建议在 add 前检查变更内容：

```bash
git diff --stat          # 查看变更文件统计
git diff --name-only     # 只看文件名
git diff                 # 查看具体变更
```

---

## 八、推送后验证

推送后可在浏览器验证：

```
GitHub: https://github.com/13311314513z-byte/Nofusion/tree/master
Gitee:  https://gitee.com/BroWhite/nofusion
```

检查：
1. 最新提交是否出现在远端日志
2. `reports/` 目录是否包含最新文档
3. 文件内容是否正确渲染（GitHub 支持 Markdown 预览）
