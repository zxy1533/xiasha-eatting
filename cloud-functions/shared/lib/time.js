'use strict';

// SPEC §4.1: "daily/monthly" boundaries use Asia/Shanghai, computed on the
// server.  Shifting epoch ms by +8h and reading the UTC ISO date gives the
// Shanghai calendar date without depending on the host's TZ setting.
const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

function dateKeyOf(nowMs) {
  return new Date(nowMs + SHANGHAI_OFFSET_MS).toISOString().slice(0, 10);
}

function nextDateKeyOf(nowMs) {
  return dateKeyOf(nowMs + DAY_MS);
}

function monthKeyOf(nowMs) {
  return dateKeyOf(nowMs).slice(0, 7);
}

function shanghaiKeys(nowMs) {
  const dateKey = dateKeyOf(nowMs);
  return {
    dateKey,
    monthKey: dateKey.slice(0, 7),
    nextDateKey: dateKeyOf(nowMs + DAY_MS),
  };
}

module.exports = { dateKeyOf, monthKeyOf, nextDateKeyOf, shanghaiKeys, DAY_MS };
