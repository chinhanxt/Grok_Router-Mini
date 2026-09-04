# ⚡ AI Router Mini (`grok-router-mini`)

> **Cổng kết nối AI Router siêu nhẹ (Zero-Database) dành cho Claude Code, Cursor, Codex...**  
> Tự động cân bằng tải và luân chuyển giữa các node Grok, tự động né lỗi HTTP 429 và hồi sinh token ngầm.

---

<p align="center">
  <img src="./assets/demo.png" alt="Claude Code running with AI Router Mini" width="100%" />
</p>

---

## 🎯 Tổng quan dự án

* **🚀 Zero-Database**: Lưu trữ tệp JSON nguyên tử (`~/.grok-router/`), khởi động tức thì, không cần cài PostgreSQL/Redis.
* **🔄 Smart 429 Failover**: Tự động chuyển đổi tài khoản khác ngay khi bị rate limit (429) mà không làm ngắt kết nối Claude Code.
* **⚡ Tự động hồi sinh Token**: Worker chạy ngầm tự động phát hiện và gia hạn token sắp hết hạn qua OAuth x.ai.
* **💻 1-Click OS Setup**: Thiết lập môi trường và cấu hình tự động chỉ bằng 1 dòng lệnh trên macOS, Linux và Windows.
* **📊 Giao diện Web tinh gọn**: Bảng điều khiển quản lý node, nạp hàng loạt, xóa node lỗi và theo dõi tải trực quan.

---

## 🚀 Hướng dẫn cài đặt & Khởi động

### Cách 1: Chạy ngay không cần cài đặt (Khuyên dùng)
```bash
npx grok-router-mini
```
*Tùy chỉnh cổng nếu muốn:*
```bash
npx grok-router-mini --port 3006
```

### Cách 2: Cài đặt toàn cục (Global CLI)
```bash
npm install -g grok-router-mini
grok-router-mini
```

### Cách 3: Chạy từ mã nguồn
```bash
git clone https://github.com/chinhanxt/Grok_Router-Mini.git
cd Grok_Router-Mini
npm install
npm start
```

📍 **Web Dashboard**: [http://localhost:3005](http://localhost:3005)  
🔑 **Tài khoản Admin mặc định**: `admin` / `admin123`

---

## ⚡ Kết nối với Claude Code (1-Click)

Khi router đang chạy, mở terminal mới và dán dòng lệnh tương ứng với hệ điều hành của bạn:

### 🍎 macOS & 🐧 Linux (Bash / Zsh)
```bash
curl -fsSL http://localhost:3005/claude.sh | bash
```

### 🪟 Windows (PowerShell)
```powershell
irm http://localhost:3005/claude.ps1 | iex
```

### 🪟 Windows (CMD)
```cmd
curl -fsSL http://localhost:3005/claude.cmd -o setup.cmd && setup.cmd
```

> Lệnh trên sẽ tự động đặt biến môi trường và ghi cấu hình vào `~/.claude/settings.json`, sau đó khởi chạy Claude Code kết nối trực tiếp đến router.

---

## 🤖 Các mô hình hỗ trợ

| Model ID | Mô hình | Mục đích sử dụng |
|---|---|---|
| `claude-sonnet-5` | **Claude Sonnet 5** | Tối ưu tốt nhất giữa tốc độ và độ thông minh *(Mặc định)* |
| `claude-fable-5-1` | **Claude Fable 5.1** | Suy luận cao cấp, lập trình tác nhân tự động lâu dài |
| `claude-opus-5` | **Claude Opus 5** | Giải quyết bài toán lớn, kiến trúc hệ thống doanh nghiệp |
| `claude-haiku-4-5` | **Claude Haiku 4.5** | Phản hồi siêu tốc, tác vụ phụ trợ |

---

## 📄 Giấy phép

Phát hành theo giấy phép [MIT](LICENSE).
