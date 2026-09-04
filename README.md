# Grok Router Mini (`grok-router-mini`)

> Ultra-lightweight, zero-database local AI gateway for Grok 4.6 with 1-Click Claude Code Setup for 3 OSes and role-based Web UI. Inspired by the simplicity and developer experience of `9router`.

---

## ✨ Features

- **Zero Database Required**: Pure atomic JSON file storage in `~/.grok-router/` (or `$DATA_DIR`). No PostgreSQL, SQLite, or Redis dependencies.
- **Smart AutoStrategy Failover**: Rotates across Grok accounts by load score (`requestCount * 1000 + totalTokens`) and lifespan. Automatically recovers on HTTP 429 without dropping active Claude CLI connections.
- **1-Click 3-OS Claude Code Auto-Setup**: Instant configuration scripts for macOS/Linux (Bash), Windows PowerShell, and Windows CMD.
- **Local Dashboard & Credential Protection**:
  - Pre-configured single local account (`admin` / `admin123`) running directly on your machine.
  - Manage accounts (add/toggle/delete), view live terminal logs, copy 1-click setup commands, and test AI playground.
  - Sensitive tokens are masked in the UI.
- **Protocol Translation & Brand Masking**: Verbatim Anthropic Messages API translation (SSE streaming, tool calls deltas, multimodal inputs) with Grok brand masking (`sanitizeClaudeText`).
- **Featherweight Footprint**: Built purely with native Node.js ESM (`node:crypto`, `node:fs`), Express, CORS, and Compression. Unbundled and code-signing ready.

---

## 🚀 Quick Start

### Run with NPX (Zero Install)

```bash
npx grok-router-mini
```

Or specify a custom port:

```bash
npx grok-router-mini --port 8080
```

### Run from Source

```bash
git clone https://github.com/chinhan/grok-router-mini.git
cd grok-router-mini
npm install
npm start
```

Default Web UI: [http://localhost:3005](http://localhost:3005)

---

## 💻 CLI Usage

```text
Usage:
  grok-router-mini [options]
  npx grok-router-mini [options]

Options:
  -p, --port <number>    Port to listen on (default: 3005 or $PORT)
  --host <host>          Host to bind to (default: 0.0.0.0 or $HOST)
  -h, --help             Display this help message

Examples:
  grok-router-mini --port 3005
  grok-router-mini -p 8080 --host 127.0.0.1
```

---

## 🔐 Local Authentication

`grok-router-mini` runs locally on your machine with a pre-configured local account:

| Username / Email | Password | Permissions |
|---|---|---|
| `admin` (or `admin@local.com`) | `admin123` (or `admin`) | Full local control: Account management, live logs, 1-click setup, playground |

---

## ⚡ 1-Click Claude Code Setup

Once `grok-router-mini` is running, configure and launch Claude Code in one command:

### macOS & Linux (Bash / Zsh)
```bash
curl -fsSL http://localhost:3005/claude.sh | bash
```

### Windows (PowerShell)
```powershell
irm http://localhost:3005/claude.ps1 | iex
```

### Windows (Command Prompt)
```cmd
curl -fsSL http://localhost:3005/claude.cmd -o setup.cmd && setup.cmd
```

These scripts configure `ANTHROPIC_BASE_URL`, `ANTHROPIC_AUTH_TOKEN`, and `~/.claude/settings.json` automatically, then launch `claude`.

---

## 🤖 Các mô hình hỗ trợ & Tính năng

| Model | Mã Model ID | Tính năng & Mục đích sử dụng |
|---|---|---|
| **Truyện ngụ ngôn Claude 5.1** | `claude-fable-5-1` | Dành cho những người đòi hỏi khả năng suy luận cao và thực hiện công việc mang tính chủ động trong thời gian dài. |
| **Claude Opus 5** | `claude-opus-5` | Dành cho lập trình tác nhân phức tạp và công việc cấp doanh nghiệp. |
| **Claude Sonnet 5** | `claude-sonnet-5` | Sự kết hợp tốt nhất giữa tốc độ và trí thông minh. *(Mặc định)* |
| **Claude Haiku 4.5** | `claude-haiku-4-5` | Mẫu xe nhanh nhất với trí thông minh gần như vượt trội. |

## 🛡️ Code Signing & File Verification

`grok-router-mini` is intentionally designed without bundlers, transpilers, or minification. Every file is modular, self-contained, and kept under 200 lines.

### Verifying SHA-256 Checksums
Generate and verify file hashes for deployment integrity:

```bash
# Generate checksum manifest
find src bin -type f -name "*.js" -exec sha256sum {} + > checksums.sha256

# Verify integrity
sha256sum -c checksums.sha256
```

### GPG Signing Individual Files
To digitally sign any source file:

```bash
gpg --armor --detach-sign bin/cli.js
gpg --verify bin/cli.js.asc bin/cli.js
```

---

## 🧪 Testing

Run the full automated test suite (Unit, Integration & E2E):

```bash
npm test
```

Or run via Node.js test runner directly:

```bash
node --test test/*.test.js
```

---

## 📁 Project Structure

```text
grok-router-mini/
├── bin/
│   └── cli.js                  # CLI runner, argument parser, banner
├── public/
│   └── index.html              # Responsive single-page UI with role separation
├── src/
│   ├── app.js                  # Express app, security middleware, activity logs
│   ├── config.js               # AppConfig and environment loader
│   ├── server.js               # Service orchestration and HTTP listener
│   ├── core/
│   │   ├── Account.js          # Grok account entity & status lifecycle
│   │   ├── AutoStrategy.js     # Load scoring and tie-breaking strategy
│   │   └── User.js             # User entity, scrypt hashing, timing-safe verify
│   ├── middlewares/
│   │   └── AuthMiddleware.js   # JWT authentication & requireAdmin guard
│   ├── routes/
│   │   ├── accountRoutes.js    # Account CRUD (Admin only)
│   │   ├── authRoutes.js       # Login, token check, user management
│   │   ├── proxyRoutes.js      # Anthropic Messages & OpenAI Chat proxy
│   │   └── setupRoutes.js      # Dynamic 1-click OS setup scripts
│   ├── services/
│   │   ├── AccountPool.js      # Account rotation, cooldown recovery, persistence
│   │   ├── ProxyService.js     # Protocol injection, streaming translation, failover
│   │   └── UserService.js      # User management, scrypt passwords, JWT issuance
│   └── storage/
│       └── JsonStorage.js      # Atomic, thread-safe JSON file storage
└── test/                       # Comprehensive node:test suite (100% PASS)
```

---

## 📄 License

MIT
