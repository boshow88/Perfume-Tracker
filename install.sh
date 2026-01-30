#!/bin/bash
# install.sh - Clone/Update Perfume Tracker with environment check
# 
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/boshow88/Perfume-Tracker/main/install.sh | bash
#   ./install.sh              # Check only, show install instructions
#   ./install.sh --install    # Try to auto-install missing dependencies

REPO_URL="https://github.com/boshow88/Perfume-Tracker.git"
TARGET_DIR="Perfume-Tracker"
MIN_PYTHON_VERSION="3.7"
AUTO_INSTALL=false

# Parse arguments
if [[ "$1" == "--install" ]] || [[ "$1" == "-i" ]]; then
    AUTO_INSTALL=true
fi

echo "=== Perfume Tracker Installer ==="
echo ""

# Detect package manager
detect_pkg_manager() {
    if command -v apt-get &> /dev/null; then
        echo "apt"
    elif command -v dnf &> /dev/null; then
        echo "dnf"
    elif command -v yum &> /dev/null; then
        echo "yum"
    elif command -v pacman &> /dev/null; then
        echo "pacman"
    elif command -v brew &> /dev/null; then
        echo "brew"
    else
        echo "unknown"
    fi
}

PKG_MANAGER=$(detect_pkg_manager)

# --- Check Git ---
echo "[1/4] Checking Git..."

if command -v git &> /dev/null; then
    GIT_VERSION=$(git --version | awk '{print $3}')
    echo "✅ Git $GIT_VERSION found"
else
    echo "❌ Git not found!"
    if $AUTO_INSTALL; then
        echo "   Attempting to install git..."
        case $PKG_MANAGER in
            apt)    sudo apt-get update && sudo apt-get install -y git ;;
            dnf)    sudo dnf install -y git ;;
            yum)    sudo yum install -y git ;;
            pacman) sudo pacman -S --noconfirm git ;;
            brew)   brew install git ;;
            *)      echo "   Unknown package manager. Please install git manually."; exit 1 ;;
        esac
        if ! command -v git &> /dev/null; then
            echo "   ❌ Failed to install git"; exit 1
        fi
        echo "   ✅ Git installed"
    else
        echo "   To install: ./install.sh --install"
        echo "   Or manually: https://git-scm.com/downloads"
        exit 1
    fi
fi

# --- Check Python ---
echo ""
echo "[2/4] Checking Python..."

if command -v python3 &> /dev/null; then
    PYTHON_CMD="python3"
elif command -v python &> /dev/null; then
    PYTHON_CMD="python"
else
    echo "❌ Python not found!"
    if $AUTO_INSTALL; then
        echo "   Attempting to install python3..."
        case $PKG_MANAGER in
            apt)    sudo apt-get update && sudo apt-get install -y python3 ;;
            dnf)    sudo dnf install -y python3 ;;
            yum)    sudo yum install -y python3 ;;
            pacman) sudo pacman -S --noconfirm python ;;
            brew)   brew install python ;;
            *)      echo "   Unknown package manager. Please install Python manually."; exit 1 ;;
        esac
        if command -v python3 &> /dev/null; then
            PYTHON_CMD="python3"
        elif command -v python &> /dev/null; then
            PYTHON_CMD="python"
        else
            echo "   ❌ Failed to install Python"; exit 1
        fi
        echo "   ✅ Python installed"
    else
        echo "   To install: ./install.sh --install"
        echo "   Or manually: https://www.python.org/downloads/"
        exit 1
    fi
fi

# Check Python version
PYTHON_VERSION=$($PYTHON_CMD -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')")
PYTHON_MAJOR=$($PYTHON_CMD -c "import sys; print(sys.version_info.major)")
PYTHON_MINOR=$($PYTHON_CMD -c "import sys; print(sys.version_info.minor)")

if [ "$PYTHON_MAJOR" -lt 3 ] || ([ "$PYTHON_MAJOR" -eq 3 ] && [ "$PYTHON_MINOR" -lt 7 ]); then
    echo "❌ Python $PYTHON_VERSION found, but $MIN_PYTHON_VERSION+ is required."
    echo "   Please upgrade Python manually."
    exit 1
fi

echo "✅ Python $PYTHON_VERSION found ($PYTHON_CMD)"

# --- Check tkinter ---
echo ""
echo "[3/4] Checking tkinter..."

if $PYTHON_CMD -c "import tkinter" 2>/dev/null; then
    TK_VERSION=$($PYTHON_CMD -c "import tkinter; print(tkinter.TkVersion)")
    echo "✅ tkinter $TK_VERSION found"
else
    echo "❌ tkinter not found!"
    if $AUTO_INSTALL; then
        echo "   Attempting to install tkinter..."
        case $PKG_MANAGER in
            apt)    sudo apt-get update && sudo apt-get install -y python3-tk ;;
            dnf)    sudo dnf install -y python3-tkinter ;;
            yum)    sudo yum install -y python3-tkinter ;;
            pacman) sudo pacman -S --noconfirm tk ;;
            brew)   brew install python-tk ;;
            *)      echo "   Unknown package manager. Please install tkinter manually."; exit 1 ;;
        esac
        if ! $PYTHON_CMD -c "import tkinter" 2>/dev/null; then
            echo "   ❌ Failed to install tkinter"; exit 1
        fi
        echo "   ✅ tkinter installed"
    else
        echo ""
        echo "   To auto-install: ./install.sh --install"
        echo "   Or install manually:"
        echo "   - Ubuntu/Debian: sudo apt-get install python3-tk"
        echo "   - Fedora: sudo dnf install python3-tkinter"
        echo "   - Arch: sudo pacman -S tk"
        echo "   - macOS: brew install python-tk"
        exit 1
    fi
fi

# --- Clone/Update repo ---
echo ""
echo "[4/4] Setting up Perfume Tracker..."

if [ -d "$TARGET_DIR" ]; then
    echo "Directory '$TARGET_DIR' already exists."
    echo "Pulling latest changes..."
    cd "$TARGET_DIR" && git pull
    cd ..
else
    echo "Cloning $REPO_URL..."
    git clone "$REPO_URL" "$TARGET_DIR"
fi

# --- Done ---
echo ""
echo "=========================================="
echo "✅ Installation complete!"
echo "=========================================="
echo ""
echo "To run Perfume Tracker:"
echo "  cd $TARGET_DIR"
echo "  $PYTHON_CMD perfume_tracker.py"
echo ""
