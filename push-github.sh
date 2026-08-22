#!/bin/zsh
set -e

REPO="jdpal/LocalSSH"

echo "=== LocalSSH -> GitHub ==="

# Install GitHub CLI if needed
if ! command -v gh >/dev/null 2>&1; then
    if command -v brew >/dev/null 2>&1; then
        echo "Installing GitHub CLI..."
        brew install gh
    else
        echo "GitHub CLI (gh) is not installed."
        echo "Install Homebrew first, or install gh from https://cli.github.com/"
        exit 1
    fi
fi

# Authenticate via browser using HTTPS, NOT SSH
if ! gh auth status >/dev/null 2>&1; then
    echo "Opening GitHub browser login..."
    gh auth login \
        --hostname github.com \
        --git-protocol https \
        --web \
        --skip-ssh-key
fi

# Configure git to use GitHub CLI credentials
gh auth setup-git

echo
echo "Authenticated GitHub account:"
gh api user --jq '.login'

# Make sure files are committed
git add .

if ! git diff --cached --quiet; then
    git commit -m "Initial LocalSSH source"
fi

git branch -M main

# Remove the broken/old origin
if git remote get-url origin >/dev/null 2>&1; then
    git remote remove origin
fi

# Check if repository already exists
if gh repo view "$REPO" >/dev/null 2>&1; then

    echo "Repository already exists."

    git remote add origin "https://github.com/${REPO}.git"
    git push -u origin main

else

    echo "Creating GitHub repository ${REPO}..."

    gh repo create "$REPO" \
        --private \
        --source=. \
        --remote=origin \
        --push
fi

echo
echo "======================================"
echo "SUCCESS"
echo "https://github.com/${REPO}"
echo "======================================"
