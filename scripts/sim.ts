// Bot-vs-bot simulation. Usage: npm run sim -- [games] [samples]
import { simulate } from "../src/bots/simulate";
import type { Difficulty } from "../src/bots/bots";

const games = Number(process.argv[2] ?? 40);
const samples = Number(process.argv[3] ?? 48);
const matchups: Difficulty[][] = [
  ["hard", "easy", "easy", "easy"],
  ["hard", "hard", "easy", "easy"],
  ["normal", "easy", "easy", "easy"],
  ["hard", "normal", "normal", "normal"]
];

for (const lineup of matchups) {
  const started = Date.now();
  const r = simulate(lineup, games, { seed: 2026, samples });
  const secs = ((Date.now() - started) / 1000).toFixed(1);
  console.log(`\n${lineup.join(" / ")}  —  ${games} games, ${r.hands} hands, ${secs}s`);
  for (const [d, e] of Object.entries(r.byDifficulty)) {
    const perSeatWin = (e.wins / e.seats) * 100;
    console.log(
      `  ${d.padEnd(7)} ${(e.points / e.hands).toFixed(2).padStart(6)} pts/hand   win rate per seat ${perSeatWin.toFixed(1)}% (fair share 25%)   moons ${e.moons}`
    );
  }
}
