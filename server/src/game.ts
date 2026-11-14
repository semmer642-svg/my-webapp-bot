export type Stats = { attack:number; defense:number; health:number };
export type Tactic = "aggressive" | "guard" | "recover" | "balanced";
export function combatPower(s: Stats) {
  return s.attack * 2 + s.defense * 1.5 + s.health * 0.25;
}
export function botStats(player: Stats): Stats {
  // Slightly stronger opponent; values are server-side and visible rules are disclosed.
  const target = combatPower(player) * 1.07;
  const attack = Math.max(1, Math.round(player.attack * 1.07));
  const defense = Math.max(1, Math.round(player.defense * 1.07));
  const health = Math.max(1, Math.round(player.health * 1.07));
  const current = combatPower({attack, defense, health});
  if (current < target) return {attack:attack+1, defense, health};
  return {attack, defense, health};
}
export function chooseBotTactic(botHp:number, playerHp:number, round:number): Tactic {
  if (botHp < 35 && round % 3 === 0) return "recover";
  if (playerHp < botHp * 0.55) return "guard";
  if (round % 3 === 0) return "aggressive";
  return "balanced";
}
export function resolveTurn(attacker:Stats, defender:Stats, tactic:Tactic) {
  const raw = attacker.attack * (tactic === "aggressive" ? 1.35 : 1);
  const guard = tactic === "guard" ? 1.5 : 1;
  return Math.max(1, Math.round(raw - defender.defense / guard * 0.45));
}
