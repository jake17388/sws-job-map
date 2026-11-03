// ── Routing ───────────────────────────────────────────────────────────────────
function vehicleResponse_() {
  const snapshot = getVehicleSnapshot_();
  const ageMs = snapshot.snapshotAt ? Date.now() - new Date(snapshot.snapshotAt).getTime() : null;
  return {
    vehicles: snapshot.vehicles,
    vehicleCatalog: getVehicleCatalog_(),
    snapshotAt: snapshot.snapshotAt,
    stale: ageMs === null || ageMs > 30 * 60 * 1000,
  };
}

function doGet(e) {
  const params = (e && e.parameter) || {};
  const action = params.action;
  const actor = resolveActor_(params.token);
  if (action === 'getWorkloadEstimates') {
    if (!actor) return json(UNAUTHORIZED);
    const nums = Array.from(new Set(String(params.nums || '').split(',').filter(num => /^\d{5,6}$/.test(num)))).slice(0, 60);
    try {
      const totals = squarecoilInstallHoursByJob_(nums, false);
      return json({ estimates: Object.fromEntries(totals) });
    } catch (error) {
      console.warn('Could not load workload estimates:', error.message);
      return json({ estimates: {}, warning: 'Job estimates are unavailable. Hours remain unknown.' });
    }
  }

  if (action === 'getUsers') return actor && isAdmin_(actor) ? json({users:listUsers_()}) : json(UNAUTHORIZED);
  if (action === 'getSquarecoilEstimateStatus') {
    return actor && isAdmin_(actor) ? json(squarecoilEstimateConnectionStatus_()) : json(UNAUTHORIZED);
  }

  if (action === 'getJobs' || action === 'getUnsched') {
    if (!actor) return json(UNAUTHORIZED);
    return json(action === 'getJobs' ? getJobs(e) : getUnsched());
  }

  if (action === 'getVehicles') {
    if (!actor) return json(UNAUTHORIZED);
    return json(vehicleResponse_());
  }

  if (action === 'refreshVehicles') {
    if (!actor) return json(UNAUTHORIZED);
    cacheSurecamVehicles();
    return json(vehicleResponse_());
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
  if (data.action === 'addUser' && isAdmin_(actor)) return json(adminAddUser_(data.name,data.pin));
  if (data.action === 'updateUser' && isAdmin_(actor)) return json(adminUpdateUser_(data.oldPin,data.name,data.pin));
  if (data.action === 'removeUser' && isAdmin_(actor)) return json(adminRemoveUser_(data.pin));

  if (data.action === 'updateMyInfo') return json(updateMyInfo(actor, data.pin, data.name));

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
  if (data.action === 'scheduleUnsched') {
    if (!isAdmin_(actor)) return json({ error: 'forbidden' });
    return json(scheduleUnsched(data));
  }
  if (data.action === 'updateScheduledCrew') {
    if (!isAdmin_(actor)) return json({ error: 'forbidden' });
    return json(updateScheduledCrew(data));
  }
  if (data.action === 'updateScheduledAssignments') {
    if (!isAdmin_(actor)) return json({ error: 'forbidden' });
    return json(updateScheduledAssignments(data));
  }
  if (data.action === 'syncInstallKpi') {
    if (!isAdmin_(actor)) return json({ error: 'forbidden' });
    return json(syncInstallCalendarToKpi(data));
  }
  if (data.action === 'refreshKpiJobTotals') {
    if (!isAdmin_(actor)) return json({ error: 'forbidden' });
    return json(refreshKpiJobTotals());
  }
  if (data.action === 'saveSquarecoilEstimateCredentials') {
    if (!isAdmin_(actor)) return json({ error: 'forbidden' });
    return json(saveSquarecoilEstimateCredentials_(data.username, data.password));
  }
  return json({ error: 'unknown action' });
}
