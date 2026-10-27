import { expect, test } from "bun:test";
import { comRetentativaSqlite } from "../src/busca/sqlite-retry";

function sqliteBusy(): Error & { code: string } { return Object.assign(new Error("database is locked"), { code: "SQLITE_BUSY" }); }

test("Dado uma abertura temporariamente bloqueada, Quando repete, Então devolve o resultado na tentativa seguinte", () => {
  let chamadas = 0;
  expect(comRetentativaSqlite(() => { if (chamadas++ === 0) throw sqliteBusy(); return "aberto"; })).toBe("aberto");
  expect(chamadas).toBe(2);
});

test("Dado erro diferente de BUSY, Quando tenta abrir, Então propaga sem repetir", () => {
  let chamadas = 0;
  expect(() => comRetentativaSqlite(() => { chamadas++; throw new Error("quebrado"); }, () => {})).toThrow("quebrado");
  expect(chamadas).toBe(1);
});

test("Dado bloqueio persistente, Quando esgota as novas tentativas, Então propaga BUSY", () => {
  let chamadas = 0;
  expect(() => comRetentativaSqlite(() => { chamadas++; throw sqliteBusy(); }, () => {})).toThrow("database is locked");
  expect(chamadas).toBe(6);
});
