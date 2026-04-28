import type { CardDefinition, EffectSpec } from '../../game/types';
import { RESOURCE_META } from './visuals';

export function generatorUiName(generator: 'quarry' | 'barracks' | 'magic'): string {
  if (generator === 'quarry') {
    return 'Builders';
  }
  if (generator === 'barracks') {
    return 'Army';
  }
  return 'Magic';
}

export function describeEffectImpact(effect: EffectSpec): string {
  const targetLabel = 'target' in effect && effect.target === 'opponent' ? 'Enemy' : 'You';
  const signed = (amount: number): string => `${amount > 0 ? '+' : ''}${amount}`;

  switch (effect.type) {
    case 'adjustWall':
      return `${targetLabel} wall ${signed(effect.amount)}`;
    case 'adjustTower':
      return `${targetLabel} tower ${signed(effect.amount)}`;
    case 'adjustResource':
      return `${targetLabel} ${RESOURCE_META[effect.resource].resourceName} ${signed(effect.amount)}`;
    case 'adjustRandomResource':
      return `${targetLabel} random resource ${signed(effect.amount)}`;
    case 'adjustAllResources':
      return `${targetLabel} all resources ${signed(effect.amount)}`;
    case 'adjustGenerator':
      return `${targetLabel} ${effect.generator} ${signed(effect.amount)}`;
    case 'adjustAllGenerators':
      return `${targetLabel} all income ${signed(effect.amount)}`;
    case 'attack': {
      const total = effect.amount * (effect.hits ?? 1);
      if (effect.bypassWall) {
        return `Enemy Castle -${total}`;
      }
      if (effect.wallOnly) {
        return `Enemy Wall -${total}`;
      }
      return `Enemy -${total}`;
    }
    case 'setNextAttackBonus':
      return `Next attack +${effect.amount}`;
    case 'setOutgoingDamagePenalty':
      return `${effect.target === 'opponent' ? 'Enemy' : 'Your'} damage -${effect.amount}`;
    case 'setIncomingDamageReduction':
      return `Next hit reduced by ${effect.amount}`;
    case 'setBarrier':
      return `Barrier ${effect.amount}`;
    case 'setShield':
      return 'Block next attack';
    case 'setSkipGain':
      return `${effect.target === 'opponent' ? 'Enemy' : 'You'} skip income`;
    case 'setCurse':
      return `${effect.target === 'opponent' ? 'Enemy' : 'You'} curse -${effect.towerLoss}/turn`;
    case 'drawCards':
      return `${effect.target === 'opponent' ? 'Enemy' : 'You'} draw ${effect.amount}`;
    case 'discardCards':
      return `${effect.target === 'opponent' ? 'Enemy' : 'You'} discard ${effect.amount}`;
    case 'doubleWall':
      return `Double wall up to ${effect.cap}`;
    case 'towerPerGenerator':
      return `Tower +${effect.amountPer} per ${effect.generator}`;
    case 'wallToTower':
      return `Convert ${effect.amount} wall to tower`;
    case 'stealResources':
      return `Steal ${effect.amount} resources`;
    case 'convertResources':
      return `Convert ${effect.amount} resources`;
    case 'gainChosenResource':
      return `Gain ${effect.amount} best resource`;
    case 'swapResources':
      return 'Swap resources';
    case 'chaos':
      return 'Chaotic resource swing';
    case 'repeatLastResolved':
      return 'Repeat last card effect';
    case 'drainEnemyResources':
      return `Enemy resources -${effect.amount}`;
    case 'sabotageGenerators':
      return 'Enemy all income -1';
    case 'enemyDiscard':
      return `Enemy discards ${effect.amount}`;
  }
}

export function describeCardImpact(card: CardDefinition): string {
  const parts = card.effects.map((effect) => describeEffectImpact(effect)).filter(Boolean);
  return parts.slice(0, 3).join(' | ') || card.text;
}

export function formatCardEffectLine(card: CardDefinition): string {
  const formatAmount = (amount: number): string => `${amount > 0 ? '+' : ''}${amount}`;
  const formatAttackLine = (effect: Extract<EffectSpec, { type: 'attack' }>): string => {
    const amount = effect.amount * (effect.hits ?? 1);
    if (effect.bypassWall) {
      return `Enemy Castle -${amount}`;
    }
    if (effect.wallOnly) {
      return `Enemy Wall -${amount}`;
    }
    return `Enemy -${amount}`;
  };
  const parts = card.effects.map((effect) => {
    switch (effect.type) {
      case 'adjustWall':
        return `${effect.target === 'opponent' ? 'Enemy Wall' : 'Wall'} ${formatAmount(effect.amount)}`;
      case 'adjustTower':
        return `${effect.target === 'opponent' ? 'Enemy Castle' : 'Castle'} ${formatAmount(effect.amount)}`;
      case 'adjustResource':
        return `${effect.target === 'opponent' ? 'Enemy ' : ''}${RESOURCE_META[effect.resource].resourceName} ${formatAmount(effect.amount)}`;
      case 'adjustGenerator':
        return `${effect.target === 'opponent' ? 'Enemy ' : ''}${generatorUiName(effect.generator)} ${formatAmount(effect.amount)}`;
      case 'attack':
        return formatAttackLine(effect);
      case 'towerPerGenerator':
        return `Castle +${effect.amountPer} / Builder`;
      case 'setShield':
        return 'Block next attack';
      default:
        return describeEffectImpact(effect);
    }
  });

  return parts.slice(0, 2).join('\n');
}
