'use strict';

/** Minimal in-memory WeChat cloud DB mock for the recommend/usage tests. */
const command = {
  lt: (v) => ({ __op: 'lt', v }),
  lte: (v) => ({ __op: 'lte', v }),
  inc: (v) => ({ __op: 'inc', v }),
};

function matches(doc, cond) {
  return Object.entries(cond).every(([key, expected]) => {
    if (expected && expected.__op) {
      if (expected.__op === 'lt') return doc[key] < expected.v;
      if (expected.__op === 'lte') return doc[key] <= expected.v;
    }
    return doc[key] === expected;
  });
}

function applyUpdate(doc, data) {
  for (const [key, value] of Object.entries(data)) {
    if (value && value.__op === 'inc') doc[key] = (Number(doc[key]) || 0) + value.v;
    else doc[key] = value;
  }
}

function clone(obj) { return JSON.parse(JSON.stringify(obj)); }

class MockDB {
  constructor(collections) {
    this.store = clone(collections || {});
    this.command = command;
    for (const name of ['usage_daily', 'usage_month', 'reason_cache']) {
      if (!this.store[name]) this.store[name] = {};
    }
  }

  collection(name) {
    const store = this.store;
    if (!store[name]) store[name] = {};
    return {
      where(cond) {
        return {
          limit() {
            return { get: async () => ({ data: Object.values(store[name]).filter((d) => matches(d, cond)) }) };
          },
          get: async () => ({ data: Object.values(store[name]).filter((d) => matches(d, cond)) }),
          update: async (payload) => {
            let updated = 0;
            for (const doc of Object.values(store[name])) {
              if (matches(doc, cond)) { applyUpdate(doc, payload.data); updated += 1; }
            }
            return { stats: { updated } };
          },
        };
      },
      add: async ({ data }) => { store[name][data._id] = clone(data); return { _id: data._id }; },
      doc(id) {
        return {
          // Real cloud DB assigns _id from doc(id); mirror that here.
          set: async ({ data }) => { store[name][id] = { _id: id, ...clone(data) }; },
        };
      },
    };
  }

  async startTransaction() {
    const snapshot = clone(this.store);
    const txDb = new MockDB(snapshot);
    txDb.store = snapshot; // operate on the exact object that commit persists
    let done = false;
    return {
      collection: (name) => txDb.collection(name),
      commit: async () => { this.store = clone(snapshot); done = true; },
      rollback: async () => { done = true; },
      get isDone() { return done; },
    };
  }
}

module.exports = { MockDB };
