#!/usr/bin/env bash
set -e

echo ""
echo "================================================================"
echo "   ⚡ AI Claude KeyAPI - Trình cài đặt tự động (1-Click)       "
echo "================================================================"
echo ""

# 1. Kiểm tra Node.js & npm
if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
    echo "[1/3] Máy chưa có Node.js / npm. Đang tự động cài đặt..."
    OS="$(uname -s)"
    if [ "$OS" = "Darwin" ]; then
        if command -v brew >/dev/null 2>&1; then
            echo ">> Đang cài đặt Node.js qua Homebrew..."
            brew install node
        else
            echo ">> Đang cài đặt Node.js thông qua fnm (Fast Node Manager)..."
            curl -fsSL https://fnm.vercel.app/install | bash
            export PATH="$HOME/.local/share/fnm:$PATH"
            eval "$("$HOME/.local/share/fnm/fnm" env 2>/dev/null || fnm env 2>/dev/null)" || true
            fnm install --lts
            fnm use lts-latest
        fi
    elif [ -f /etc/debian_version ]; then
        echo ">> Đang cài đặt Node.js LTS trên Debian / Ubuntu..."
        curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash -
        sudo apt-get install -y nodejs
    else
        echo ">> Đang cài đặt Node.js thông qua fnm..."
        curl -fsSL https://fnm.vercel.app/install | bash
        export PATH="$HOME/.local/share/fnm:$PATH"
        eval "$("$HOME/.local/share/fnm/fnm" env 2>/dev/null || fnm env 2>/dev/null)" || true
        fnm install --lts
        fnm use lts-latest
    fi
else
    echo "[1/3] ✓ Đã phát hiện Node.js ($(node -v)) và npm ($(npm -v))."
fi

# 2. Cài đặt ai-claude-keyapi
echo ""
echo "[2/3] Đang cài đặt gói ai-claude-keyapi mới nhất..."
if npm install -g ai-claude-keyapi@latest; then
    echo "✓ Cài đặt thành công."
else
    echo ">> Cần quyền quản trị sudo để cài đặt toàn cục (Global npm)..."
    sudo npm install -g ai-claude-keyapi@latest
fi

# 3. Hoàn tất
echo ""
echo "[3/3] 🎉 Cài đặt hoàn tất 100%!"
echo "----------------------------------------------------------------"
echo "  Khởi động cổng Gateway bằng lệnh:                             "
echo "  $ aiclaude                                                    "
echo "  (Hoặc truy cập: http://localhost:3005 sau khi chạy)           "
echo "----------------------------------------------------------------"
echo ""

read -p "Bạn có muốn khởi động aiclaude ngay bây giờ? (Y/n): " ans
if [ -z "$ans" ] || [ "$ans" = "y" ] || [ "$ans" = "Y" ]; then
    aiclaude
fi
