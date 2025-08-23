#!/bin/bash

echo "🚀 Setting up TenSnap Tauri development environment..."

# Check if Rust is installed
if ! command -v rustc &> /dev/null; then
    echo "❌ Rust is not installed. Please install Rust first:"
    echo "   curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh"
    exit 1
fi

# Check if Tauri CLI is installed
if ! command -v tauri &> /dev/null; then
    echo "📦 Installing Tauri CLI..."
    cargo install tauri-cli
fi

# Install dependencies
echo "📦 Installing Node.js dependencies..."
pnpm install

# Build web dependencies first
echo "🔨 Building web dependencies..."
pnpm --filter tensnap-web build

echo "✅ Setup complete! You can now run:"
echo "   pnpm dev:tauri    # Start development mode"
echo "   pnpm build:tauri  # Build for production"
