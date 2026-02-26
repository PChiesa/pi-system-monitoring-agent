#!/usr/bin/env bash

echo "========================================"
echo "  BOP Monitoring Agent - Dev Container"
echo "========================================"
echo ""

echo "[1/4] Installing root workspace dependencies..."
cd /workspace
bun install

echo "[2/4] Installing simulator UI dependencies..."
cd /workspace/simulator/ui
bun install

echo "[3/4] Building simulator UI..."
cd /workspace/simulator/ui
bun run build

echo "[4/4] Verifying tools..."
echo "  Bun:         $(bun --version)"
echo "  Node.js:     $(node --version)"
echo "  TypeScript:  $(cd /workspace && npx tsc --version)"
echo "  OpenSSL:     $(openssl version)"
echo "  Git:         $(git --version)"
echo "  Claude Code: $(claude --version 2>/dev/null || echo 'not found')"

echo ""
echo "========================================"
echo "  Setup complete!"
echo "========================================"
echo ""
echo "Commands:"
echo "  bun run dev          Start the BOP monitoring agent"
echo "  bun run simulator    Start the PI Web API simulator"
echo "  bun test             Run all tests"
echo "  bun run build        TypeScript compilation"
echo "  claude               Start Claude Code CLI"
echo ""
echo "Simulator UI dev server:"
echo "  cd simulator/ui && bun run dev"
echo ""
