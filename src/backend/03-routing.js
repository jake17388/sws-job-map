// ── Routing ───────────────────────────────────────────────────────────────────
function doGet(e) {
  const params = (e && e.parameter) || {};
  const action = params.action;
  const actor = resolveActor_(params.token);

  if (action === 'getJobs' || action === 'getUnsched') {
    if (!actor) return json(UNAUTHORIZED);
    return json(action === 'getJobs' ? getJobs(e) : getUnsched());
  }

  if (action === 'getVehicles') {
    if (!actor) return json(UNAUTHORIZED);
    const snapshot = getVehicleSnapshot_();
    const ageMs = snapshot.snapshotAt ? Date.now() - new Date(snapshot.snapshotAt).getTime() : null;
    return json({
      vehicles: snapshot.vehicles,
      snapshotAt: snapshot.snapshotAt,
      stale: ageMs === null || ageMs > 30 * 60 * 1000,
    });
  }

  if (action === 'refreshVehicles') {
    if (!actor) return json(UNAUTHORIZED);
    cacheSurecamVehicles();
    const snapshot = getVehicleSnapshot_();
    const ageMs = snapshot.snapshotAt ? Date.now() - new Date(snapshot.snapshotAt).getTime() : null;
    return json({
      vehicles: snapshot.vehicles,
      snapshotAt: snapshot.snapshotAt,
      stale: ageMs === null || ageMs > 30 * 60 * 1000,
    });
  }

  // The app itself is hosted on GitHub Pages, not here
  return ContentService.createTextOutput(
    'SWS Job Map: https://jake17388.github.io/sws-job-map/');
}

function doPost(e) {
  const data = JSON.parse(e.postData.contents);

  if (data.action === 'login') {
    return json(checkPin(data.pin));
  }
  // The Chrome extension has no PIN session — it authenticates with its own
  // shared secret, so this must run before the token gate below.
  if (data.action === 'updateScSession') {
    return json(updateScSessionFromSyncJob(data));
  }

  const actor = resolveActor_(data.token);
  if (!actor) return json(UNAUTHORIZED);

  if (data.action === 'addUnsched') {
    if (!isAdmin_(actor)) return json({ error: 'forbidden' });
    data.added_by = actor.name; // trust the token, not the client-supplied name
    return json(addUnsched(data));
  }
  if (data.action === 'removeUnsched') {
    if (!isAdmin_(actor)) return json({ error: 'forbidden' });
    return json(removeUnsched(data.id));
  }
  if (data.action === 'updateUnsched') {
    if (!isAdmin_(actor)) return json({ error: 'forbidden' });
    return json(updateUnsched(data));
  }
  return json({ error: 'unknown action' });
}
