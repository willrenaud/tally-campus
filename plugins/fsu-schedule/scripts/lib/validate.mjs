/**
 * A hand-written validator for student-schedule.schema.json and the
 * course-meeting.schema.json it embeds. Node builtins only.
 *
 * WHY THIS EXISTS RATHER THAN AJV. The shipped plugin must work with no install,
 * so it cannot carry a JSON Schema library. Ajv stays a repository dev dependency
 * and validates the campus data at build time; this file is what runs on a
 * student's machine.
 *
 * THE OBVIOUS RISK is that these two drift apart, at which point the plugin writes
 * documents the schema would reject. tests/validator-parity.test.mjs exists solely
 * to stop that: it runs BOTH validators over every fixture and every rejection case
 * and fails if they ever disagree about whether a document is valid. If you change
 * a schema, run the tests -- the parity test is what will tell you this file needs
 * the same change.
 */

const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

const RE = {
  slug: /^[a-z0-9]+(-[a-z0-9]+)*$/,
  buildingCode: /^[A-Z][A-Z0-9]{1,7}$/,
  termCode: /^20[0-9]{2}-(spring|summer|fall)$/,
  date: /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/,
  timeOfDay: /^([01][0-9]|2[0-3]):[0-5][0-9]$/,
  timestamp: /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]+)?(Z|[+-][0-9]{2}:[0-9]{2})$/,
  semver: /^[0-9]+\.[0-9]+\.[0-9]+$/,
  courseCode: /^[A-Z]{3}[0-9]{4}[A-Za-z]{0,2}$/,
  section: /^[A-Za-z0-9-]{1,8}$/,
  classNumber: /^[0-9]{4,6}$/,
  sha256: /^[a-f0-9]{64}$/,
  email: /^[^@\s]+@[^@\s.]+(\.[^@\s.]+)+$/
};

const ENUM = {
  meetingType: ['lecture', 'lab', 'recitation', 'discussion', 'studio', 'seminar', 'clinical', 'field', 'exam', 'other'],
  deliveryMode: ['in-person', 'online-synchronous', 'online-asynchronous', 'hybrid', 'hyflex'],
  instructorRole: ['primary', 'co-instructor', 'teaching-assistant', 'unknown'],
  platform: ['zoom', 'microsoft-teams', 'canvas', 'webex', 'google-meet', 'other', 'unknown'],
  frequency: ['weekly', 'biweekly', 'one-time', 'irregular'],
  partOfTerm: ['full-term', 'first-half', 'second-half', 'session-a', 'session-b', 'session-c', 'session-d', 'session-e', 'session-f', 'custom'],
  sourceFormat: ['ics', 'csv', 'html-paste', 'text-paste', 'pdf', 'screenshot-ocr', 'manual-entry', 'migrated'],
  warningCode: ['unknown-building-code', 'unparsed-row', 'ambiguous-time', 'missing-instructor', 'missing-room', 'assumed-delivery-mode', 'duplicate-meeting', 'unmapped-session', 'other'],
  transportMode: ['walk', 'bike', 'scooter', 'drive', 'bus', 'wheelchair'],
  permitClass: null // filled from parking-zone.schema.json at load; see loadPermitClasses
};

const PROPS = {
  meeting: ['id', 'termCode', 'courseCode', 'canonicalNumbering', 'section', 'classNumber', 'title',
    'instructors', 'credits', 'meetingType', 'deliveryMode', 'daysOfWeek', 'startTime', 'endTime',
    'location', 'locationTba', 'onlineMeeting', 'recurrence', 'partOfTerm', 'dateRange', 'notes'],
  location: ['buildingCode', 'room', 'floor', 'buildingCodeRaw', 'preferredEntranceId'],
  instructor: ['name', 'role', 'email'],
  onlineMeeting: ['platform', 'url', 'note'],
  recurrence: ['frequency', 'anchorDate', 'intervalWeeks', 'exceptDates', 'additionalDates'],
  dateRange: ['firstMeetingDate', 'lastMeetingDate'],
  schedule: ['schemaVersion', 'termCode', 'meetings', 'preferences', 'import', 'displayName'],
  import: ['sourceFormat', 'sourceLabel', 'importedAt', 'importerVersion', 'sourceChecksum', 'warnings'],
  warning: ['code', 'message', 'meetingId', 'rawValue'],
  preferences: ['walkingPaceMetersPerSecond', 'requiresAccessibleRoutes', 'defaultTransportMode',
    'parkingPermits', 'homeBuildingCode', 'minimumTransitBufferMinutes']
};

/** Permit classes live in the parking schema; read them rather than duplicating them. */
export function loadPermitClasses(parkingSchema) {
  ENUM.permitClass = parkingSchema?.$defs?.permitClass?.enum ?? null;
}

class Ctx {
  constructor() { this.errors = []; }
  err(path, message) { this.errors.push(`${path || '<root>'}: ${message}`); }

  obj(path, value, allowed) {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      this.err(path, 'must be an object');
      return false;
    }
    for (const k of Object.keys(value)) {
      if (!allowed.includes(k)) this.err(`${path}/${k}`, 'is not a recognised property');
    }
    return true;
  }
  req(path, value, keys) {
    for (const k of keys) {
      if (value[k] === undefined) this.err(path, `must have required property '${k}'`);
    }
  }
  str(path, value, re, label) {
    if (typeof value !== 'string') { this.err(path, 'must be a string'); return false; }
    if (re && !re.test(value)) { this.err(path, `must match ${label || re}`); return false; }
    return true;
  }
  oneOf(path, value, list, label) {
    if (!list) return true; // enum not loaded; skip rather than reject wrongly
    if (!list.includes(value)) { this.err(path, `must be one of ${label || list.join(', ')}`); return false; }
    return true;
  }
  arr(path, value, minItems) {
    if (!Array.isArray(value)) { this.err(path, 'must be an array'); return false; }
    if (minItems !== undefined && value.length < minItems) {
      this.err(path, `must have at least ${minItems} item(s)`);
      return false;
    }
    return true;
  }
  uniqueDates(path, value) {
    if (!this.arr(path, value)) return;
    const seen = new Set();
    value.forEach((d, i) => {
      this.str(`${path}/${i}`, d, RE.date, 'YYYY-MM-DD');
      if (seen.has(d)) this.err(`${path}/${i}`, 'is a duplicate date');
      seen.add(d);
    });
  }
}

/* ------------------------------------------------------------------ *
 * course-meeting
 * ------------------------------------------------------------------ */

function validateLocation(ctx, path, loc) {
  if (!ctx.obj(path, loc, PROPS.location)) return;
  ctx.req(path, loc, ['buildingCode']);
  if (loc.buildingCode !== undefined) {
    ctx.str(`${path}/buildingCode`, loc.buildingCode, RE.buildingCode, 'an FSU building code');
  }
  if (loc.room !== undefined) {
    if (!ctx.str(`${path}/room`, loc.room, null)) { /* reported */ }
    else if (loc.room.length < 1) ctx.err(`${path}/room`, 'must not be empty; omit it instead');
  }
  if (loc.floor !== undefined && !Number.isInteger(loc.floor)) {
    ctx.err(`${path}/floor`, 'must be an integer');
  }
  if (loc.buildingCodeRaw !== undefined) ctx.str(`${path}/buildingCodeRaw`, loc.buildingCodeRaw, null);
  if (loc.preferredEntranceId !== undefined) {
    ctx.str(`${path}/preferredEntranceId`, loc.preferredEntranceId, RE.slug, 'a slug');
  }
}

function validateRecurrence(ctx, path, r) {
  if (!ctx.obj(path, r, PROPS.recurrence)) return;
  if (r.frequency !== undefined) ctx.oneOf(`${path}/frequency`, r.frequency, ENUM.frequency);
  if (r.anchorDate !== undefined) ctx.str(`${path}/anchorDate`, r.anchorDate, RE.date, 'YYYY-MM-DD');
  if (r.intervalWeeks !== undefined && (!Number.isInteger(r.intervalWeeks) || r.intervalWeeks < 1)) {
    ctx.err(`${path}/intervalWeeks`, 'must be an integer of at least 1');
  }
  if (r.exceptDates !== undefined) ctx.uniqueDates(`${path}/exceptDates`, r.exceptDates);
  if (r.additionalDates !== undefined) ctx.uniqueDates(`${path}/additionalDates`, r.additionalDates);

  if (r.frequency === 'biweekly' || r.frequency === 'one-time') {
    if (r.anchorDate === undefined) {
      ctx.err(path, `frequency '${r.frequency}' requires anchorDate`);
    }
  }
  if (r.frequency === 'irregular') {
    if (!Array.isArray(r.additionalDates) || r.additionalDates.length < 1) {
      ctx.err(path, "frequency 'irregular' requires a non-empty additionalDates");
    }
  }
}

export function validateMeeting(meeting, path = '') {
  const ctx = new Ctx();
  validateMeetingInto(ctx, path, meeting);
  return ctx.errors;
}

function validateMeetingInto(ctx, path, m) {
  if (!ctx.obj(path, m, PROPS.meeting)) return;
  ctx.req(path, m, ['id', 'termCode', 'courseCode', 'section', 'title', 'deliveryMode']);

  if (m.id !== undefined) ctx.str(`${path}/id`, m.id, RE.slug, 'a slug');
  if (m.termCode !== undefined) ctx.str(`${path}/termCode`, m.termCode, RE.termCode, 'YYYY-season');
  if (m.courseCode !== undefined) ctx.str(`${path}/courseCode`, m.courseCode, RE.courseCode, 'a course code');
  if (m.canonicalNumbering !== undefined && typeof m.canonicalNumbering !== 'boolean') {
    ctx.err(`${path}/canonicalNumbering`, 'must be a boolean');
  }
  if (m.section !== undefined) ctx.str(`${path}/section`, m.section, RE.section, 'a section identifier');
  if (m.classNumber !== undefined) ctx.str(`${path}/classNumber`, m.classNumber, RE.classNumber, '4-6 digits');
  if (m.title !== undefined && (typeof m.title !== 'string' || m.title.length < 1)) {
    ctx.err(`${path}/title`, 'must be a non-empty string');
  }
  if (m.notes !== undefined) ctx.str(`${path}/notes`, m.notes, null);

  if (m.instructors !== undefined && ctx.arr(`${path}/instructors`, m.instructors)) {
    m.instructors.forEach((ins, i) => {
      const p = `${path}/instructors/${i}`;
      if (!ctx.obj(p, ins, PROPS.instructor)) return;
      ctx.req(p, ins, ['name']);
      if (ins.name !== undefined && (typeof ins.name !== 'string' || !ins.name.length)) {
        ctx.err(`${p}/name`, 'must be a non-empty string');
      }
      if (ins.role !== undefined) ctx.oneOf(`${p}/role`, ins.role, ENUM.instructorRole);
      if (ins.email !== undefined) ctx.str(`${p}/email`, ins.email, RE.email, 'an email address');
    });
  }

  if (m.credits !== undefined) {
    if (typeof m.credits !== 'number' || Number.isNaN(m.credits)) ctx.err(`${path}/credits`, 'must be a number');
    else if (m.credits < 0) ctx.err(`${path}/credits`, 'must not be negative');
    else if (Math.round(m.credits * 2) !== m.credits * 2) ctx.err(`${path}/credits`, 'must be a multiple of 0.5');
  }
  if (m.meetingType !== undefined) ctx.oneOf(`${path}/meetingType`, m.meetingType, ENUM.meetingType);
  if (m.deliveryMode !== undefined) ctx.oneOf(`${path}/deliveryMode`, m.deliveryMode, ENUM.deliveryMode);
  if (m.partOfTerm !== undefined) ctx.oneOf(`${path}/partOfTerm`, m.partOfTerm, ENUM.partOfTerm);

  if (m.daysOfWeek !== undefined && ctx.arr(`${path}/daysOfWeek`, m.daysOfWeek, 1)) {
    const seen = new Set();
    m.daysOfWeek.forEach((d, i) => {
      ctx.oneOf(`${path}/daysOfWeek/${i}`, d, DAYS, 'a lowercase weekday name');
      if (seen.has(d)) ctx.err(`${path}/daysOfWeek/${i}`, 'is a duplicate day');
      seen.add(d);
    });
  }
  if (m.startTime !== undefined) ctx.str(`${path}/startTime`, m.startTime, RE.timeOfDay, 'HH:MM');
  if (m.endTime !== undefined) ctx.str(`${path}/endTime`, m.endTime, RE.timeOfDay, 'HH:MM');

  if (m.location !== undefined && m.location !== null) validateLocation(ctx, `${path}/location`, m.location);
  if (m.locationTba !== undefined && typeof m.locationTba !== 'boolean') {
    ctx.err(`${path}/locationTba`, 'must be a boolean');
  }
  if (m.onlineMeeting !== undefined) {
    const p = `${path}/onlineMeeting`;
    if (ctx.obj(p, m.onlineMeeting, PROPS.onlineMeeting)) {
      if (m.onlineMeeting.platform !== undefined) ctx.oneOf(`${p}/platform`, m.onlineMeeting.platform, ENUM.platform);
      if (m.onlineMeeting.url !== undefined) ctx.str(`${p}/url`, m.onlineMeeting.url, /^[a-z][a-z0-9+.-]*:/i, 'a URI');
      if (m.onlineMeeting.note !== undefined) ctx.str(`${p}/note`, m.onlineMeeting.note, null);
    }
  }
  if (m.recurrence !== undefined) validateRecurrence(ctx, `${path}/recurrence`, m.recurrence);
  if (m.dateRange !== undefined) {
    const p = `${path}/dateRange`;
    if (ctx.obj(p, m.dateRange, PROPS.dateRange)) {
      ctx.req(p, m.dateRange, ['firstMeetingDate', 'lastMeetingDate']);
      if (m.dateRange.firstMeetingDate !== undefined) ctx.str(`${p}/firstMeetingDate`, m.dateRange.firstMeetingDate, RE.date, 'YYYY-MM-DD');
      if (m.dateRange.lastMeetingDate !== undefined) ctx.str(`${p}/lastMeetingDate`, m.dateRange.lastMeetingDate, RE.date, 'YYYY-MM-DD');
    }
  }

  /* --- the conditionals, which are the whole point of the schema --- */
  const mode = m.deliveryMode;
  const scheduled = ['in-person', 'online-synchronous', 'hybrid', 'hyflex'];
  const physical = ['in-person', 'hybrid', 'hyflex'];
  const online = ['online-synchronous', 'online-asynchronous'];

  if (scheduled.includes(mode)) {
    for (const k of ['daysOfWeek', 'startTime', 'endTime']) {
      if (m[k] === undefined) ctx.err(path, `deliveryMode '${mode}' requires ${k}`);
    }
  }
  if (physical.includes(mode)) {
    const hasLocation = m.location !== undefined && m.location !== null;
    if (!hasLocation && m.locationTba !== true) {
      ctx.err(path, `deliveryMode '${mode}' requires either a location or locationTba: true`);
    }
  }
  if (online.includes(mode)) {
    if (m.location !== undefined && m.location !== null) {
      ctx.err(`${path}/location`, `must be null for deliveryMode '${mode}'`);
    }
    if (m.locationTba !== undefined) {
      ctx.err(`${path}/locationTba`, `is not allowed for deliveryMode '${mode}'`);
    }
  }
  if (mode === 'online-asynchronous') {
    for (const k of ['daysOfWeek', 'startTime', 'endTime']) {
      if (m[k] !== undefined) ctx.err(`${path}/${k}`, "is not allowed for deliveryMode 'online-asynchronous'");
    }
  }
  if (m.locationTba === true && m.location !== undefined && m.location !== null) {
    ctx.err(`${path}/location`, 'must be null or absent when locationTba is true');
  }
  if (m.partOfTerm === 'custom' && m.dateRange === undefined) {
    ctx.err(path, "partOfTerm 'custom' requires dateRange");
  }
}

/* ------------------------------------------------------------------ *
 * student-schedule
 * ------------------------------------------------------------------ */

export function validateSchedule(doc) {
  const ctx = new Ctx();
  if (!ctx.obj('', doc, PROPS.schedule)) return ctx.errors;
  ctx.req('', doc, ['schemaVersion', 'termCode', 'meetings', 'import']);

  if (doc.schemaVersion !== undefined) ctx.str('/schemaVersion', doc.schemaVersion, RE.semver, 'MAJOR.MINOR.PATCH');
  if (doc.termCode !== undefined) ctx.str('/termCode', doc.termCode, RE.termCode, 'YYYY-season');
  if (doc.displayName !== undefined) ctx.str('/displayName', doc.displayName, null);

  if (doc.meetings !== undefined && ctx.arr('/meetings', doc.meetings)) {
    doc.meetings.forEach((m, i) => validateMeetingInto(ctx, `/meetings/${i}`, m));
  }

  if (doc.import !== undefined && ctx.obj('/import', doc.import, PROPS.import)) {
    ctx.req('/import', doc.import, ['sourceFormat', 'importedAt']);
    if (doc.import.sourceFormat !== undefined) ctx.oneOf('/import/sourceFormat', doc.import.sourceFormat, ENUM.sourceFormat);
    if (doc.import.importedAt !== undefined) ctx.str('/import/importedAt', doc.import.importedAt, RE.timestamp, 'an RFC 3339 timestamp with an offset');
    if (doc.import.sourceLabel !== undefined) ctx.str('/import/sourceLabel', doc.import.sourceLabel, null);
    if (doc.import.importerVersion !== undefined) ctx.str('/import/importerVersion', doc.import.importerVersion, null);
    if (doc.import.sourceChecksum !== undefined) ctx.str('/import/sourceChecksum', doc.import.sourceChecksum, RE.sha256, 'a lowercase hex SHA-256');
    if (doc.import.warnings !== undefined && ctx.arr('/import/warnings', doc.import.warnings)) {
      doc.import.warnings.forEach((w, i) => {
        const p = `/import/warnings/${i}`;
        if (!ctx.obj(p, w, PROPS.warning)) return;
        ctx.req(p, w, ['code', 'message']);
        if (w.code !== undefined) ctx.oneOf(`${p}/code`, w.code, ENUM.warningCode);
        if (w.message !== undefined && (typeof w.message !== 'string' || !w.message.length)) {
          ctx.err(`${p}/message`, 'must be a non-empty string');
        }
        if (w.meetingId !== undefined) ctx.str(`${p}/meetingId`, w.meetingId, RE.slug, 'a slug');
        if (w.rawValue !== undefined) ctx.str(`${p}/rawValue`, w.rawValue, null);
      });
    }
  }

  if (doc.preferences !== undefined && ctx.obj('/preferences', doc.preferences, PROPS.preferences)) {
    const p = doc.preferences;
    if (p.walkingPaceMetersPerSecond !== undefined) {
      if (typeof p.walkingPaceMetersPerSecond !== 'number') ctx.err('/preferences/walkingPaceMetersPerSecond', 'must be a number');
      else if (!(p.walkingPaceMetersPerSecond > 0 && p.walkingPaceMetersPerSecond <= 4)) {
        ctx.err('/preferences/walkingPaceMetersPerSecond', 'must be greater than 0 and at most 4');
      }
    }
    if (p.requiresAccessibleRoutes !== undefined && typeof p.requiresAccessibleRoutes !== 'boolean') {
      ctx.err('/preferences/requiresAccessibleRoutes', 'must be a boolean');
    }
    if (p.defaultTransportMode !== undefined) ctx.oneOf('/preferences/defaultTransportMode', p.defaultTransportMode, ENUM.transportMode);
    if (p.parkingPermits !== undefined && ctx.arr('/preferences/parkingPermits', p.parkingPermits)) {
      const seen = new Set();
      p.parkingPermits.forEach((v, i) => {
        ctx.oneOf(`/preferences/parkingPermits/${i}`, v, ENUM.permitClass);
        if (seen.has(v)) ctx.err(`/preferences/parkingPermits/${i}`, 'is a duplicate permit class');
        seen.add(v);
      });
    }
    if (p.homeBuildingCode !== undefined) ctx.str('/preferences/homeBuildingCode', p.homeBuildingCode, RE.buildingCode, 'an FSU building code');
    if (p.minimumTransitBufferMinutes !== undefined) {
      if (!Number.isInteger(p.minimumTransitBufferMinutes) || p.minimumTransitBufferMinutes < 0) {
        ctx.err('/preferences/minimumTransitBufferMinutes', 'must be an integer of at least 0');
      }
    }
  }

  /* --- cross-record checks JSON Schema cannot express --- */
  if (Array.isArray(doc.meetings)) {
    const ids = new Set();
    doc.meetings.forEach((m, i) => {
      if (!m || typeof m !== 'object') return;
      if (m.id !== undefined) {
        if (ids.has(m.id)) ctx.err(`/meetings/${i}/id`, `duplicates the id '${m.id}'`);
        ids.add(m.id);
      }
      if (m.termCode !== undefined && doc.termCode !== undefined && m.termCode !== doc.termCode) {
        ctx.err(`/meetings/${i}/termCode`, `is '${m.termCode}' but the schedule's termCode is '${doc.termCode}'`);
      }
      if (typeof m.startTime === 'string' && typeof m.endTime === 'string' && m.endTime <= m.startTime) {
        ctx.err(`/meetings/${i}`, `endTime ${m.endTime} must be later than startTime ${m.startTime}`);
      }
      if (m.dateRange && typeof m.dateRange.firstMeetingDate === 'string'
          && typeof m.dateRange.lastMeetingDate === 'string'
          && m.dateRange.lastMeetingDate < m.dateRange.firstMeetingDate) {
        ctx.err(`/meetings/${i}/dateRange`, 'lastMeetingDate must be on or after firstMeetingDate');
      }
    });
    if (Array.isArray(doc.import?.warnings)) {
      doc.import.warnings.forEach((w, i) => {
        if (w && typeof w.meetingId === 'string' && !ids.has(w.meetingId)) {
          ctx.err(`/import/warnings/${i}/meetingId`, `refers to '${w.meetingId}', which is not a meeting in this schedule`);
        }
      });
    }
  }

  return ctx.errors;
}
