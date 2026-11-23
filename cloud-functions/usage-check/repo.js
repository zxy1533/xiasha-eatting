'use strict';

// Reads never throw on a missing document: where().get() returns {data: []}.
// This avoids mistaking "not found" for a database failure (which would look
// like zero usage and could silently disable the quota guard).
async function getOne(db, collection, id) {
  const res = await db.collection(collection).where({ _id: id }).limit(1).get();
  return res && res.data && res.data[0] ? res.data[0] : null;
}

module.exports = { getOne };
