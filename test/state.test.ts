import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as state from "../src/state";

// state.ts reads state.json from the current folder, so each test gets an empty folder
const home = process.cwd();
beforeEach(() => process.chdir(fs.mkdtempSync(path.join(os.tmpdir(), "state-test-"))));
afterEach(() => process.chdir(home));

describe("state", () => {
  it("starts empty when there is no state.json", () => {
    expect(state.load()).toEqual({
      today: null, winner: null, hintsGiven: 0, revealed: false, lateSolvers: [], hints: [], onTrack: [], used: [],
      history: [], review: null, reviewed: [], emojiGame: null, storiesUsed: [], scores: {},
    });
  });

  it("saves and loads back the same data, without leaving a temp file", () => {
    const s = state.load();
    s.used.push("John 3:16");
    s.scores["111@c.us"] = {
      name: "Ama", points: 11, wins: 1, fastestMin: 2, season: 2026, week: "2026-03-02", weekPoints: 11,
      streak: 2, bestStreak: 4, lastSolvedDay: "2026-03-04", emojiWins: 0,
    };
    state.save(s);
    expect(state.load()).toEqual(s);
    expect(fs.existsSync("state.json.tmp")).toBe(false);
  });

  it("loads a state.json saved before streaks existed", () => {
    fs.writeFileSync("state.json", JSON.stringify({
      today: null, winner: null, hintsGiven: 0, used: [],
      scores: { "111@c.us": { name: "Ama", points: 6, wins: 1, fastestMin: 2, season: 2026, week: "2026-03-02", weekPoints: 6 } },
    }));
    const s = state.load();
    expect(s).toMatchObject({ revealed: false, lateSolvers: [], hints: [], history: [], review: null, reviewed: [] });
    expect(s.scores["111@c.us"]).toMatchObject({ points: 6, streak: 0, bestStreak: 0, lastSolvedDay: null });
  });

  it("refuses to load broken JSON instead of wiping scores", () => {
    fs.writeFileSync("state.json", "{ not json");
    expect(() => state.load()).toThrow(/not valid JSON/);
  });

  it("refuses to load a file with the wrong shape", () => {
    fs.writeFileSync("state.json", JSON.stringify({ today: null, scores: "oops" }));
    expect(() => state.load()).toThrow(/looks damaged/);
  });
});

describe("backup", () => {
  it("does nothing before there is a state.json", () => {
    expect(state.backup()).toBeNull();
  });

  it("copies state.json into backups/ with the date", () => {
    state.save(state.load());
    expect(state.backup(new Date(2026, 2, 4))).toBe(path.join("backups", "state-2026-03-04.json"));
    expect(fs.readFileSync("backups/state-2026-03-04.json", "utf8")).toBe(fs.readFileSync("state.json", "utf8"));
  });

  it("keeps only the newest 30 backups", () => {
    state.save(state.load());
    for (let day = 1; day <= 35; day++) state.backup(new Date(2026, 0, day));
    const files = fs.readdirSync("backups").sort();
    expect(files).toHaveLength(30);
    expect(files[0]).toBe("state-2026-01-06.json");
  });
});
