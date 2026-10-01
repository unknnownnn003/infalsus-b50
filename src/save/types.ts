export interface ScoreRecord {
  songId: number;
  difficultyIndex: number;
  score: bigint;
  clearStatus?: "failed" | "cleared";
}
