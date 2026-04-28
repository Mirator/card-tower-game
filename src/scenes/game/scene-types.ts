import type Phaser from 'phaser';
import type { Resource } from '../../game/types';

export type PanelSide = 'left' | 'right';

export interface ResourceBlockRefs {
  root: Phaser.GameObjects.Container;
  generatorValue: Phaser.GameObjects.Text;
  resourceValue: Phaser.GameObjects.Text;
}

export interface PlayerPanelRefs {
  side: PanelSide;
  width: number;
  height: number;
  container: Phaser.GameObjects.Container;
  activeGlow: Phaser.GameObjects.Rectangle;
  headerText: Phaser.GameObjects.Text;
  resourceBlocks: Record<Resource, ResourceBlockRefs>;
  towerValue: Phaser.GameObjects.Text;
  wallValue: Phaser.GameObjects.Text;
}

export interface TowerVisualRefs {
  container: Phaser.GameObjects.Container;
  body: Phaser.GameObjects.Rectangle;
  roof: Phaser.GameObjects.Triangle;
  wallLine: Phaser.GameObjects.Rectangle;
  baseBodyHeight: number;
  bodyTargetHeight: number;
  wallTargetHeight: number;
}

export interface CardVisual {
  cardId: string;
  handIndex: number;
  container: Phaser.GameObjects.Container;
  frame: Phaser.GameObjects.Graphics;
  resourceIcon: Phaser.GameObjects.Graphics;
  titleText: Phaser.GameObjects.Text;
  costText: Phaser.GameObjects.Text;
  illustration: Phaser.GameObjects.Graphics;
  effectText: Phaser.GameObjects.Text;
  hitArea: Phaser.GameObjects.Rectangle;
  width: number;
  height: number;
  domain: Resource;
  affordable: boolean;
  baseX: number;
  baseY: number;
  targetAlpha: number;
  iconSize: number;
  illustrationSize: number;
}

export interface TopPileRefs {
  width: number;
  height: number;
  container: Phaser.GameObjects.Container;
  frame: Phaser.GameObjects.Graphics;
  stackBackA: Phaser.GameObjects.Rectangle;
  stackBackB: Phaser.GameObjects.Rectangle;
  labelText: Phaser.GameObjects.Text;
  titleText: Phaser.GameObjects.Text;
  metaText: Phaser.GameObjects.Text;
  countBg: Phaser.GameObjects.Arc;
  countText: Phaser.GameObjects.Text;
}

export interface EnemyHandVisual {
  handIndex: number;
  container: Phaser.GameObjects.Container;
  baseY: number;
}

export interface EnemyHandRefs {
  width: number;
  height: number;
  container: Phaser.GameObjects.Container;
  rail: Phaser.GameObjects.Rectangle;
  labelText: Phaser.GameObjects.Text;
  countBg: Phaser.GameObjects.Arc;
  countText: Phaser.GameObjects.Text;
  cardsContainer: Phaser.GameObjects.Container;
  overflowBg: Phaser.GameObjects.Arc;
  overflowText: Phaser.GameObjects.Text;
}

export interface GestureState {
  cardId: string;
  handIndex: number;
  x: number;
  y: number;
  isTouch: boolean;
  dragging: boolean;
  offsetX: number;
  offsetY: number;
}

export interface Point {
  x: number;
  y: number;
}

export const SWIPE_THRESHOLD = 44;
export const DRAG_START_THRESHOLD = 12;
export const NARROW_LAYOUT_WIDTH = 720;
export const RESOURCE_FLOATING_TEXT_DURATION_MULTIPLIER = 2;
export const ENEMY_CARD_SELECTION_MS = 540;
export const ENEMY_CARD_REVEAL_MS = 2200;
export const WALL_VISUAL_CAP = 30;
export const WALL_MAX_HEIGHT = 140;
export const WALL_LINE_WIDTH = 8;
export const CASTLE_MIN_HEIGHT = 132;
export const CASTLE_MAX_HEIGHT = 276;
