import { MODULE_ID, SOCKET, activeGM, num, onFuEvent, res } from './util.mjs';

/**
 * Battle statistics. Project FU runs damage, healing, checks and statuses on the client that triggered them,
 * so every client listens to those events and reports them to the active GM, who keeps the tally
 * (in memory, saved to the combat's flags every few seconds so a reload doesn't lose it).
 */

const STATS = new Map(); // combat id -> stats
const STATUS_BUFFS = new Set(['accelerated', 'aura', 'barrier', 'cover', 'flying', 'reflect', 'regen', 'focus', 'dex-up', 'ins-up', 'mig-up', 'wlp-up']);
const STATUS_DEBUFFS = new Set(['dazed', 'shaken', 'slow', 'weak', 'enraged', 'poisoned', 'provoked', 'sleep', 'stagger', 'dex-down', 'ins-down', 'mig-down', 'wlp-down']);
const AFFINITY = { '-1': 'vulnerable', 1: 'resistant', 2: 'immune', 3: 'absorbs' };

export const blankActor = () => ({
	dealt: 0,
	taken: 0,
	healed: 0,
	healedReceived: 0,
	mpRestored: 0,
	crits: 0,
	fumbles: 0,
	kos: 0,
	falls: 0,
	buffs: 0,
	debuffs: 0,
	cleanses: 0,
	prevented: 0,
	revives: 0,
	biggest: 0,
	hits: 0,
	mpSpent: 0,
	ipSpent: 0,
});

function sideOf(combatant) {
	// a Pilot's vehicle (Advanced Class Mechanics) is part of its pilot, not a hero of its own
	if (combatant.actor?.getFlag?.('fu-class-mechanics', 'vehicleOf')) return 'others';
	const d = combatant.token?.disposition ?? combatant.actor?.prototypeToken?.disposition ?? 0;
	if (combatant.actor?.type === 'character') return 'heroes';
	return d === 1 ? 'heroes' : d === -1 ? 'foes' : 'others';
}

function snapshot(actor) {
	return { hp: res(actor, 'hp'), mp: res(actor, 'mp'), ip: res(actor, 'ip'), fp: res(actor, 'fp') };
}

/** Make sure the stats for this combat exist and know every combatant */
export function ensure(combat) {
	if (!combat) return null;
	let s = STATS.get(combat.id);
	if (!s) {
		s = loadStats(combat) ?? { id: combat.id, started: Date.now(), scene: combat.scene?.name ?? '', actors: {}, affinities: {}, lastHit: {}, biggest: null, hp: {} };
		s.down ??= {};
		STATS.set(combat.id, s);
	}
	for (const c of combat.combatants) {
		const a = c.actor;
		if (!a || s.actors[a.uuid]) continue;
		s.actors[a.uuid] = { name: c.name ?? a.name, img: c.token?.texture?.src ?? a.img, side: sideOf(c), pc: a.type === 'character', level: num(a.system?.level?.value), rank: a.system?.rank?.value ?? '', replaced: num(a.system?.rank?.replacedSoldiers, 1), villain: a.system?.villain?.value ?? '', start: snapshot(a), ...blankActor() };
		s.hp[a.uuid] = res(a, 'hp').value;
		s.down[a.uuid] = s.hp[a.uuid] <= 0;
	}
	return s;
}

/**
 * The saved tally. It is stored as a JSON string: its keys are actor uuids ("Actor.abc",
 * "Scene.x.Token.y.Actor.z"), and Foundry would read the dots in an object's keys as nested paths.
 */
export function loadStats(combat) {
	const raw = combat?.getFlag?.(MODULE_ID, 'stats');
	if (typeof raw !== 'string') return null;
	try {
		return JSON.parse(raw);
	} catch {
		return null;
	}
}

export const statsFor = (combat) => (combat ? STATS.get(combat.id) ?? null : null);
export const forget = (combat) => STATS.delete(combat.id);

let saveTimer = null;
function save(combat) {
	clearTimeout(saveTimer);
	saveTimer = setTimeout(() => {
		const s = STATS.get(combat.id);
		if (s && game.combats.get(combat.id)) combat.setFlag(MODULE_ID, 'stats', JSON.stringify(s)).catch(() => {});
	}, 3000);
}

/* ---------- applying records (active GM only) ---------- */

function apply(rec) {
	const combat = game.combat;
	if (!combat?.started) return;
	const s = ensure(combat);
	const A = (uuid) => (uuid ? s.actors[uuid] ?? null : null);
	const src = A(rec.src);
	const tgt = A(rec.tgt);
	switch (rec.k) {
		case 'dmg': {
			if (!tgt) break;
			const dealt = Math.max(0, Math.min(rec.result, rec.hpBefore));
			tgt.taken += dealt;
			// resistances, immunities, absorption, Guard and other reductions
			tgt.prevented += Math.max(0, rec.amount - Math.max(0, rec.result));
			if (src && src !== tgt) {
				src.dealt += dealt;
				src.hits += 1;
				src.biggest = Math.max(src.biggest, dealt);
				if (!s.biggest || dealt > s.biggest.amount) s.biggest = { amount: dealt, src: rec.src, tgt: rec.tgt, type: rec.dtype };
				s.lastHit[rec.tgt] = rec.src;
			}
			// this hit took them to 0: a fall, and a finishing blow for the attacker
			if (rec.hpBefore > 0 && dealt >= rec.hpBefore) {
				if (src && src !== tgt && src.side !== tgt.side) src.kos += 1;
				if (!s.down[rec.tgt]) {
					s.down[rec.tgt] = true;
					tgt.falls += 1;
				}
			}
			if (rec.dtype && AFFINITY[rec.affinity] && tgt.side !== 'heroes') {
				(s.affinities[rec.tgt] ??= {})[rec.dtype] = AFFINITY[rec.affinity];
			}
			break;
		}
		case 'gain': {
			if (!tgt) break;
			if (rec.res === 'hp') {
				tgt.healedReceived += rec.amount;
				if (src) src.healed += rec.amount;
				if (rec.revive && src && src !== tgt) src.revives += 1;
				if (rec.amount > 0) s.down[rec.tgt] = false;
			} else if (rec.res === 'mp' && src && src !== tgt) src.mpRestored += rec.amount;
			break;
		}
		case 'check': {
			if (!src) break;
			if (rec.critical) src.crits += 1;
			if (rec.fumble) src.fumbles += 1;
			break;
		}
		case 'status': {
			if (!tgt || !src || src === tgt) break;
			if (rec.enabled) {
				if (STATUS_BUFFS.has(rec.status) && src.side === tgt.side) src.buffs += 1;
				else if (STATUS_DEBUFFS.has(rec.status) && src.side !== tgt.side) src.debuffs += 1;
			} else if (STATUS_DEBUFFS.has(rec.status) && src.side === tgt.side) src.cleanses += 1;
			break;
		}
		case 'spend': {
			if (!src) break;
			if (rec.res === 'mp') src.mpSpent += rec.amount;
			if (rec.res === 'ip') src.ipSpent += rec.amount;
			break;
		}
	}
	save(combat);
}

/** The actor whose turn it is (who most likely caused an effect the system reports without a source) */
function turnActor() {
	return game.combat?.combatant?.actor?.uuid ?? null;
}

/** Where a status effect came from: the source Project FU stores on the effect, else whoever's turn it is */
function statusSource(actor, status) {
	try {
		const fx = actor.effects.filter((e) => e.statuses?.has(status));
		const latest = fx[fx.length - 1];
		const info = latest?.getFlag?.('projectfu', 'Source') ?? latest?.flags?.projectfu?.Source;
		if (info?.actorUuid) return info.actorUuid;
	} catch {
		/* no flag */
	}
	return turnActor();
}

/** Every client: send a record to the active GM */
export function record(rec) {
	if (!game.combat?.started) return;
	if (activeGM()) apply(rec);
	else game.socket.emit(SOCKET, { type: 'rec', rec });
}

/** Records from players only count for actors that player owns (what their own client legitimately reports) */
export function onSocketRecord(msg, userId) {
	if (msg?.type !== 'rec' || !activeGM()) return;
	const user = game.users.get(userId);
	if (user && !user.isGM) {
		const owns = (uuid) => {
			try {
				return !!uuid && !!fromUuidSync(uuid)?.testUserPermission?.(user, 'OWNER');
			} catch {
				return false;
			}
		};
		if (!owns(msg.rec?.src) && !owns(msg.rec?.tgt)) return;
	}
	apply(msg.rec);
}

/* ---------- hooks ---------- */

export function installTracker() {
	Hooks.on('projectfu.pipelines.damage.postCalculate', (ctx) => {
		try {
			const tgt = ctx.actor;
			if (!tgt) return;
			record({ k: 'dmg', src: ctx.sourceActor?.uuid ?? null, tgt: tgt.uuid, amount: num(ctx.amount), result: num(ctx.result), hpBefore: res(tgt, 'hp').value, affinity: num(ctx.affinity), dtype: ctx.damageType ?? '' });
		} catch (err) {
			console.warn(`${MODULE_ID} | damage`, err);
		}
	});
	/*
	 * Healing: the system's gain event has the amount actually recovered but no source; the resource event
	 * that follows it right away has the source. Hold each gain briefly and attribute it when the resource
	 * event arrives (or to whoever's turn it is, if it never does).
	 */
	const pending = new Map(); // `${uuid}|${res}` -> { rec, timer }
	const flush = (key, src) => {
		const p = pending.get(key);
		if (!p) return;
		clearTimeout(p.timer);
		pending.delete(key);
		record({ ...p.rec, src: src ?? p.rec.src });
	};
	Hooks.on('projectfu.events.gain', (ev) => {
		try {
			if (!ev?.actor || !['hp', 'mp'].includes(ev.resource)) return;
			const amount = num(ev.amount);
			if (amount <= 0) return;
			const now = res(ev.actor, ev.resource).value;
			const key = `${ev.actor.uuid}|${ev.resource}`;
			flush(key);
			const rec = { k: 'gain', res: ev.resource, amount, src: turnActor(), tgt: ev.actor.uuid, revive: ev.resource === 'hp' && now - amount <= 0 };
			pending.set(key, { rec, timer: setTimeout(() => flush(key), 400) });
		} catch (err) {
			console.warn(`${MODULE_ID} | gain`, err);
		}
	});
	onFuEvent('projectfu.events.resource', (ev) => {
		try {
			if (!['hp', 'mp'].includes(ev?.resource) || num(ev.amount) < 0) return;
			const src = ev.source?.actor?.uuid ?? null;
			for (const t of ev.targets ?? []) if (t?.actor) flush(`${t.actor.uuid}|${ev.resource}`, src);
		} catch (err) {
			console.warn(`${MODULE_ID} | resource`, err);
		}
	});
	Hooks.on('projectfu.events.checks.resolve', (ev) => {
		const c = ev?.check;
		if (!c || !(c.critical || c.fumble)) return;
		record({ k: 'check', src: ev.source?.actor?.uuid ?? null, critical: !!c.critical, fumble: !!c.fumble });
	});
	// the status event names the affected actor as its source, so look for the real one
	Hooks.on('projectfu.events.status', (ev) => {
		if (!ev?.actor || !ev.status) return;
		const src = ev.enabled ? statusSource(ev.actor, ev.status) : turnActor();
		record({ k: 'status', src, tgt: ev.actor.uuid, status: ev.status, enabled: !!ev.enabled });
	});

	/* GM side: HP / MP / IP changes give knock-outs, defeated enemies and resources spent */
	Hooks.on('updateActor', (actor, changed) => {
		if (!activeGM() || !game.combat?.started) return;
		const r = changed.system?.resources;
		if (!r) return;
		const s = ensure(game.combat);
		const me = s.actors[actor.uuid];
		if (!me) return;
		if (r.hp?.value !== undefined) {
			// falls from any cause (finishing blows are credited by the damage record itself)
			const now = res(actor, 'hp').value;
			if (now <= 0 && !s.down[actor.uuid]) {
				s.down[actor.uuid] = true;
				me.falls += 1;
			} else if (now > 0) s.down[actor.uuid] = false;
			s.hp[actor.uuid] = now;
		}
		save(game.combat);
	});
	Hooks.on('preUpdateActor', (actor, changed) => {
		// spending happens on the owner's client: remember the drop there and report it
		if (!game.combat?.started) return;
		const r = changed.system?.resources;
		if (!r) return;
		for (const key of ['mp', 'ip']) {
			if (r[key]?.value === undefined) continue;
			const drop = res(actor, key).value - num(r[key].value);
			if (drop > 0) record({ k: 'spend', res: key, amount: drop, src: actor.uuid });
		}
	});

	Hooks.on('combatStart', (combat) => {
		if (activeGM()) ensure(combat);
	});
	Hooks.on('createCombatant', (c) => {
		if (activeGM() && c.combat?.started) ensure(c.combat);
	});
	Hooks.once('ready', () => {
		if (activeGM()) for (const c of game.combats) if (c.started) ensure(c);
	});
}
