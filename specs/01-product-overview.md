# Product Overview

## Overview
Tower Card Game is a fast, untimed, turn-based, two-player card strategy game for the browser. It follows the classic castle-vs-castle resource duel structure: three resources, one card or discard per turn, and a race to build or destroy towers.

The player and AI opponent manage three resource economies, draw cards, and play one card per turn to attack, defend, grow production, or disrupt the opponent. The match ends when one side reaches the tower goal or destroys the opponent's tower.

## Product goals
- Compact, replayable single-player web game with short matches
- Clear, readable state and fast decision loop
- Deterministic, data-driven core for easy balancing
- Clean Phaser-based implementation with no React dependency

## Design pillars
- Fast, untimed turns with low-friction decisions
- High readability
- Meaningful single-action decisions
- Low input friction for mouse, keyboard, and touch
- Simple rules, non-trivial outcomes

## Platform and tech target
- Web (desktop + mobile browsers)
- TypeScript
- Rendering: Phaser (Scene-based)
- UI built in Phaser with containers, text, and shape objects
- State: reducer-driven plain TypeScript game engine
- Persistence: localStorage for stats and settings

## One-sentence pitch
A fast, browser-based Phaser card duel where players build or destroy towers through tight, resource-driven decisions.
