const SHEET_ID = '1CTh3Fd3zvC0XDLTruuNz7RSLdgpVxy0TtCL9fZ2_9JU';
const UNSCHEDULED_SHEET_GID = 0;
const ADMIN_USER_NAME = 'Jake Banks';

const INSTALL_CAL_ID = 'summitwestsigns.com_5ehu6it6pfpcg2g9ifpcuv6gd8@group.calendar.google.com';
const SERVICE_CAL_ID = 'summitwestsigns.com_plamgq5u79k125mvl50ie49fu0@group.calendar.google.com';
const EXCAV_CAL_ID   = 'c_86ccbe589549562e734ff696a2cebbefc071fe607283d4a7cac31c0c36d1155c@group.calendar.google.com';

const SKIP_KEYWORDS = ['no install','hunter out','johnny out','randy off','jake out','eli out','crane service','2018 crane','mother\'s day','memorial day'];

const CREW_NAMES = ['Johnny', 'Eli', 'Jerry', 'Jonathan', 'Randy', 'Jake'];
const TRUCK_ASSIGNMENTS_TAG = 'sws_truck_assignments_v1';
function normalizeCrew(names) {
  return names.map(n => {
    const match = CREW_NAMES.find(k => k.toLowerCase() === n.toLowerCase());
    return match || n;
  });
}

function vehicleRoster_() {
  return typeof VEHICLE_ROSTER === 'undefined' ? [] : VEHICLE_ROSTER;
}

function getVehicleCatalog_() {
  return vehicleRoster_().map(vehicle => ({
    id: String(vehicle.id),
    name: String(vehicle.displayName),
    active: vehicle.active !== false,
  }));
}

function truckAssignmentObject_(value) {
  if (!value) return { value: {} };
  let parsed = value;
  if (typeof value === 'string') {
    try { parsed = JSON.parse(value); }
    catch (e) { return { error: 'Truck assignments are not valid JSON' }; }
  }
  if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') {
    return { error: 'Truck assignments must be an object' };
  }
  return { value: parsed };
}

function normalizeStoredTruckAssignments_(value) {
  const parsed = truckAssignmentObject_(value);
  if (parsed.error) return {};
  const knownIds = new Set(vehicleRoster_().map(vehicle => String(vehicle.id)));
  const assignments = {};
  CREW_NAMES.forEach(name => {
    const vehicleId = String(parsed.value[name] == null ? '' : parsed.value[name]).trim();
    if (vehicleId && knownIds.has(vehicleId)) assignments[name] = vehicleId;
  });
  return assignments;
}

function validateTruckAssignments_(value, crew) {
  const parsed = truckAssignmentObject_(value);
  if (parsed.error) return { error: parsed.error };
  const selectedCrew = normalizeUnscheduledCrew_(crew);
  const roster = vehicleRoster_();
  const activeIds = new Set(roster
    .filter(vehicle => vehicle.active !== false)
    .map(vehicle => String(vehicle.id)));
  for (const name of Object.keys(parsed.value)) {
    if (!CREW_NAMES.includes(name)) return { error: `Unknown crew member: ${name}` };
    if (!selectedCrew.includes(name)) return { error: `${name} is not assigned to this job` };
    const vehicleId = String(parsed.value[name] == null ? '' : parsed.value[name]).trim();
    if (!vehicleId) continue;
    const knownVehicle = roster.find(vehicle => String(vehicle.id) === vehicleId);
    if (!knownVehicle) return { error: `Unknown truck: ${vehicleId}` };
    if (!activeIds.has(vehicleId)) return { error: `Truck is not active: ${knownVehicle.displayName}` };
  }
  const assignments = {};
  CREW_NAMES.forEach(name => {
    if (!selectedCrew.includes(name)) return;
    const vehicleId = String(parsed.value[name] == null ? '' : parsed.value[name]).trim();
    if (vehicleId) assignments[name] = vehicleId;
  });
  return { assignments };
}

function serializeTruckAssignments_(assignments) {
  return Object.keys(assignments || {}).length ? JSON.stringify(assignments) : '';
}

function applyTruckAssignmentsTag_(event, assignments) {
  const encoded = serializeTruckAssignments_(assignments);
  if (encoded && typeof event.setTag === 'function') event.setTag(TRUCK_ASSIGNMENTS_TAG, encoded);
  else if (!encoded && typeof event.deleteTag === 'function') event.deleteTag(TRUCK_ASSIGNMENTS_TAG);
}
