export const CARD_ASSUMPTIONS: Record<string, string> = {
  mirror:
    'Repeats the most recent successfully resolved card effect list exactly once. If no prior card exists, this effect does nothing.',
  chaos:
    'Randomly chooses between: deal 6-12 attack damage to opponent (wall applies) OR gain +10 tower for self.',
  transmute:
    'Converts up to 6 resources from the currently highest self resource into the currently lowest self resource.',
  convert:
    'Gains +5 to the most strategically needed resource (largest deficit vs expensive playable cards in hand).',
  pillage:
    'Steals up to 5 resources total from opponent, one point at a time, each point from a random positive enemy resource.',
  theft:
    'Steals up to 3 resources total from opponent using random positive resource picks.',
  drain:
    'Removes up to 4 resources total from opponent, one point at a time, using random positive resource picks.',
  control:
    'Enemy discards up to 2 random cards from hand, drawing replacement cards during normal end-turn refill only.',
  insight:
    'Draws 2 cards, then discards 1 random card from current hand to keep interaction deterministic without extra UI prompts.',
  sabotage:
    'Reduces enemy quarry or barracks by 1, preferring the higher current value and breaking ties randomly.',
  simultaneousVictory:
    'If both towers reach <=0 during active card resolution, active player is declared winner.',
};
