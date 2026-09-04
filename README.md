# AI Claude KeyAPI

> Ultra-lightweight Local AI Gateway CLI for Claude Code & LLMs.

---

## Cài đặt & Khởi động

### Cách 1: Cài đặt toàn cục (Khuyên dùng - Nhanh nhất)
```bash
npm install -g ai-claude-keyapi
aiclaude
```

### Cách 2: Chạy trực tiếp qua NPX
```bash
npx ai-claude-keyapi
```
*(Từ các lần chạy tiếp theo bạn chỉ cần gõ `aiclaude`)*

---

## Tùy chọn dòng lệnh (CLI Options)

| Tùy chọn | Mô tả | Mặc định |
|---|---|---|
| `-p, --port <cổng>` | Chỉ định cổng lắng nghe | `3005` (tự động tăng nếu bị chiếm) |
| `--host <host>` | Địa chỉ IP lắng nghe | `0.0.0.0` |
| `-l, --license <key>` | Tự động kích hoạt License Key khi khởi động | - |
| `-h, --help` | Xem trợ giúp cú pháp lệnh | - |
| `-v, --version` | Xem phiên bản hiện tại | - |

---

## Thiết lập nhanh Claude Code (1-Click)

Khi gateway đang chạy trên máy của bạn, mở một cửa sổ terminal mới và chạy lệnh tương ứng:

- **macOS / Linux (Bash):**
  ```bash
  curl -fsSL http://localhost:3005/claude.sh | bash
  ```

- **Windows (PowerShell):**
  ```powershell
  irm http://localhost:3005/claude.ps1 | iex
  ```

- **Windows (Command Prompt):**
  ```cmd
  curl -fsSL http://localhost:3005/claude.cmd -o setup.cmd && setup.cmd
  ```

Sau đó khởi động `claude` trong terminal để bắt đầu làm việc.

---

## Bản quyền
Phát hành theo giấy phép MIT.
