// Pure merge logic for cloud sync. No DOM or network here, so it can be tested in Node
// (see tests/sync-merge.test.js).
//
// Rule: every record carries an `updatedAt` stamp and the newest change wins.
// Data written by older versions has no stamp and counts as 0. On a tie the cloud copy
// wins, because a device holding an old copy must never overwrite what is already there.
// The legacy fields (types, hidden, deletedTypes, goals, deletedGoals) are still written
// so a tab running the previous version keeps working until it is reloaded.
(function (root) {
  const stamp = (x) => Number(x && x.updatedAt) || 0;

  // Builds the per-type change map, filling gaps from the legacy fields.
  function typeChangesOf(state) {
    const changes = {};
    for (const [name, change] of Object.entries(state.typeChanges || {})) changes[name] = { ...change };
    for (const name of state.deletedTypes || []) {
      if (!changes[name]) changes[name] = { updatedAt: 0, deleted: true };
    }
    for (const [name, color] of state.types || []) {
      if (!changes[name]) changes[name] = { updatedAt: 0, deleted: false, color, hidden: (state.hidden || []).includes(name) };
    }
    return changes;
  }

  function mergeTypeChanges(local, remote) {
    const merged = { ...local };
    for (const [name, r] of Object.entries(remote)) {
      const l = merged[name];
      if (!l || stamp(r) > stamp(l)) { merged[name] = r; continue; }
      if (stamp(l) > stamp(r)) continue;
      // Tie. Old data had no stamps: there, a recorded deletion or hide always stood.
      if (l.deleted || r.deleted) merged[name] = { ...(r.deleted ? r : l), deleted: true };
      else merged[name] = stamp(r) === 0 ? { ...r, hidden: Boolean(l.hidden || r.hidden) } : r;
    }
    return merged;
  }

  // Follows renames: "чтение" renamed to "книги" resolves to "книги". Stops on a live type.
  function resolveType(name, changes) {
    const seen = new Set();
    let current = name;
    while (changes[current] && changes[current].deleted && changes[current].renamedTo && !seen.has(current)) {
      seen.add(current);
      current = changes[current].renamedTo;
    }
    return changes[current] && changes[current].deleted ? name : current;
  }

  function mergeActivities(local, remote, changes) {
    const deleted = new Set([...(remote.deletedIds || []), ...(local.deletedIds || [])]);
    const byId = new Map();
    for (const item of remote.activities || []) byId.set(item.id, item);
    for (const item of local.activities || []) {
      const existing = byId.get(item.id);
      if (!existing || stamp(item) > stamp(existing)) byId.set(item.id, item);
    }
    const activities = [];
    for (const [id, item] of byId) {
      if (deleted.has(id)) continue;
      const type = resolveType(item.type, changes);
      activities.push(type === item.type ? item : { ...item, type });
    }
    return { activities, deletedIds: [...deleted] };
  }

  function goalChangesOf(state) {
    const changes = {};
    for (const [name, change] of Object.entries(state.goalChanges || {})) changes[name] = { ...change };
    for (const name of state.deletedGoals || []) {
      if (!changes[name]) changes[name] = { updatedAt: 0, deleted: true };
    }
    for (const [name, target] of Object.entries(state.goals || {})) {
      if (!changes[name]) changes[name] = { updatedAt: 0, target, deleted: false };
    }
    return changes;
  }

  function mergeGoals(local, remote, typeChanges) {
    const merged = goalChangesOf(remote);
    for (const [name, change] of Object.entries(goalChangesOf(local))) {
      const existing = merged[name];
      if (!existing || stamp(change) > stamp(existing)) merged[name] = change;
      else if (stamp(change) === stamp(existing) && change.deleted) merged[name] = change;
    }
    // A deleted activity takes its goal with it, unless the goal was set again afterwards.
    for (const [name, type] of Object.entries(typeChanges)) {
      if (!type.deleted) continue;
      const goal = merged[name];
      if (goal && !goal.deleted && stamp(goal) <= stamp(type)) merged[name] = { updatedAt: stamp(type), deleted: true };
    }
    const goals = {};
    const deletedGoals = [];
    for (const [name, change] of Object.entries(merged)) {
      if (change.deleted) deletedGoals.push(name);
      else if (change.target !== undefined) goals[name] = change.target;
    }
    return { goals, deletedGoals, goalChanges: merged };
  }

  function orderOf(state) {
    return state.typeOrder || { updatedAt: 0, names: (state.types || []).map(([name]) => name) };
  }

  // The list keeps the most recently saved order; types it does not mention go at the end.
  function mergeTypeOrder(local, remote, changes) {
    const l = orderOf(local);
    const r = orderOf(remote);
    const winner = stamp(l) > stamp(r) ? l : r;
    const names = [];
    for (const raw of [...winner.names, ...r.names, ...l.names, ...Object.keys(changes)]) {
      const name = resolveType(raw, changes);
      if (changes[name] && !changes[name].deleted && !names.includes(name)) names.push(name);
    }
    return { updatedAt: stamp(winner), names };
  }

  function mergeStates(local, remote) {
    local = local || {};
    remote = remote || {};
    const typeChanges = mergeTypeChanges(typeChangesOf(local), typeChangesOf(remote));
    const typeOrder = mergeTypeOrder(local, remote, typeChanges);
    return {
      v: 2,
      ...mergeActivities(local, remote, typeChanges),
      ...mergeGoals(local, remote, typeChanges),
      types: typeOrder.names.map((name) => [name, typeChanges[name].color]),
      hidden: typeOrder.names.filter((name) => typeChanges[name].hidden),
      deletedTypes: Object.keys(typeChanges).filter((name) => typeChanges[name].deleted),
      typeChanges,
      typeOrder,
    };
  }

  // Stable text form of a state: says whether two states differ, whatever order sets came in.
  function canonical(state) {
    if (!state) return '';
    const sorted = (value) => {
      if (Array.isArray(value)) return value.map(sorted);
      if (value && typeof value === 'object') {
        return Object.keys(value).sort().reduce((out, key) => { out[key] = sorted(value[key]); return out; }, {});
      }
      return value;
    };
    const names = (list) => [...(list || [])].sort();
    return JSON.stringify(sorted({
      ...state,
      activities: [...(state.activities || [])].sort((a, b) => String(a.id).localeCompare(String(b.id))),
      deletedIds: names(state.deletedIds),
      deletedTypes: names(state.deletedTypes),
      deletedGoals: names(state.deletedGoals),
      hidden: names(state.hidden),
    }));
  }

  const api = { mergeStates, canonical };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.DaymarkMerge = api;
})(typeof window !== 'undefined' ? window : globalThis);
