# 部署到 Cloudflare Workers + S3 OSS

本指南说明如何将 PvZ2 Gardendless 部署到 Cloudflare Workers，使用第三方 S3 兼容对象存储作为静态资源后端。

## 架构

```
用户请求 → Cloudflare Worker → S3 OSS (s3.hi168.com)
                                  ↓
                             静态资源 (docs/)
```

- **Cloudflare Worker**：接收用户请求，代理到 S3 存储桶，添加正确的 MIME 类型和缓存头
- **S3 OSS**：存储游戏的所有静态文件（HTML、JS、CSS、图片、音频等）

## 前提条件

1. [Cloudflare 账号](https://dash.cloudflare.com/sign-up)
2. [Node.js](https://nodejs.org/) >= 18
3. [AWS CLI v2](https://docs.aws.amazon.com/cli/latest/userguide/install-cliv2.html)（用于上传文件到 S3）
4. S3 OSS 的 Access Key 和 Secret Key

## 部署步骤

### 第一步：上传静态资源到 S3

1. 设置 S3 凭证：

```bash
export AWS_ACCESS_KEY_ID="your-access-key"
export AWS_SECRET_ACCESS_KEY="your-secret-key"
```

2. 运行上传脚本：

```bash
cd worker
chmod +x upload-to-s3.sh
./upload-to-s3.sh
```

或手动使用 AWS CLI：

```bash
aws s3 sync docs/ s3://hi168-32227-8062svww/ \
  --endpoint-url https://s3.hi168.com
```

> **提示**：首次上传约 1.2 GB 数据，可能需要较长时间。后续更新只会上传变更的文件。

### 第二步：部署 Cloudflare Worker

1. 安装依赖：

```bash
cd worker
npm install
```

2. 登录 Cloudflare（首次需要）：

```bash
npx wrangler login
```

3. （可选）如果 S3 桶需要认证，设置密钥：

```bash
npx wrangler secret put S3_ACCESS_KEY_ID
npx wrangler secret put S3_SECRET_ACCESS_KEY
```

4. 部署 Worker：

```bash
npm run deploy
```

部署成功后，你将获得一个 `*.workers.dev` 的 URL。

### 第三步（可选）：绑定自定义域名

编辑 `worker/wrangler.toml`，取消注释并修改 `routes` 配置：

```toml
routes = [
  { pattern = "play.yourdomain.com/*", zone_name = "yourdomain.com" }
]
```

确保域名已添加到 Cloudflare 并正确解析。然后重新部署：

```bash
npm run deploy
```

## 本地开发 / 调试

```bash
cd worker
npm run dev
```

这会在本地启动一个模拟 Worker 环境，可以用浏览器访问 `http://localhost:8787` 测试。

## 配置说明

### wrangler.toml 环境变量

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `S3_ENDPOINT` | S3 服务地址 | `https://s3.hi168.com` |
| `S3_BUCKET` | 存储桶名称 | `hi168-32227-8062svww` |
| `S3_REGION` | S3 区域（用于签名） | `us-east-1` |
| `CACHE_TTL` | 浏览器缓存时间（秒） | `86400`（1 天） |

### Secrets（通过 `wrangler secret put` 设置）

| 变量 | 说明 |
|------|------|
| `S3_ACCESS_KEY_ID` | S3 访问密钥 ID（桶需要认证时设置） |
| `S3_SECRET_ACCESS_KEY` | S3 访问密钥（桶需要认证时设置） |

## 自动部署（GitHub Actions CI/CD）

项目已配置 GitHub Actions 自动部署流程（`.github/workflows/main.yml`）：

1. **定时同步上游**：每天 UTC 04:00 自动同步上游仓库 `Gzh0821/pvzge_web` 的 `master` 分支
2. **自动部署**：同步到新提交后，自动上传资源到 S3 并部署 Cloudflare Worker
3. **手动触发**：也可在 GitHub Actions 页面手动运行 `workflow_dispatch`

### 需要配置的 Repository Secrets

在仓库的 `Settings → Secrets and variables → Actions` 中设置：

| Secret 名称 | 说明 |
|-------------|------|
| `CLOUDFLARE_APP_URL` | 发布的目标域名（不含 `http://` 前缀，如 `play.example.com`） |
| `CLOUDFLARE_WORKER_API` | Cloudflare API Token（使用「编辑 Cloudflare Workers」模板创建） |
| `S3_ENDPOINT` | S3 服务地址（如 `https://s3.hi168.com`） |
| `S3_BUCKET` | S3 存储桶名称（如 `hi168-32227-8062svww`） |
| `S3_REGION` | S3 区域（如 `us-east-1`） |
| `S3_ACCESS_KEY_ID` | S3 访问密钥 ID |
| `S3_SECRET_ACCESS_KEY` | S3 访问密钥 |

### 工作流程

```
定时/手动触发
    │
    ▼
同步上游 master 分支
    │
    ▼ (有新提交 或 手动触发)
    │
    ├─► aws s3 sync docs/ → S3 存储桶
    │
    └─► wrangler deploy → Cloudflare Worker
        ├─ 设置 S3 环境变量
        ├─ 设置 S3 认证密钥
        └─ 配置自定义域名路由
```

## 更新游戏版本

当游戏有新版本时，有两种方式：

### 自动更新（推荐）

上游仓库更新后，GitHub Actions 会自动同步并部署。无需手动操作。

也可以到 GitHub Actions 页面手动点击 `Run workflow` 触发。

### 手动更新

1. 更新 `docs/` 目录中的文件
2. 重新上传到 S3：

```bash
cd worker
./upload-to-s3.sh
```

Worker 代码通常不需要更改，无需重新部署。

## 注意事项

- Cloudflare Workers 免费版每天有 **100,000 次请求**限制，付费版为 **1000 万次/月**（$5/月）
- S3 存储和流量费用取决于你的 OSS 服务商
- Worker 会为所有响应添加 CORS 头（`Access-Control-Allow-Origin: *`）
- 默认缓存时间为 1 天，可通过 `CACHE_TTL` 调整
