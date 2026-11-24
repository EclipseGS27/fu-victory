import { MODULE_ID, SOCKET, activeGM, num, res } from './util.mjs';

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
	const d = combatant.token?.disposition ?? combatant.actor?.prototypeToken?.disposition ?? 0;
	if (combatant.actor?.type === 'character') return 'heroes';
	return d === 1 ? 'heroes' : d === -1 ? 'foes' : 'others';
}

function snapshot(actor) {
	return { hp: res(actor, 'hp'), mp: res(actor, 'mp'), ip: res(actor, 'ip') };
}

/** Make sure the stats for this combat exist and know every combatant */
export function ensure(combat) {
	if (!combat) return null;
	let s = STATS.get(combat.id);
	if (!s) {
		s = combat.getFlag(MODULE_ID, 'stats') ?? { id: combat.id, started: Date.now(), scene: combat.scene?.name ?? '', actors: {}, affinities: {}, lastHit: {}, biggest: null, hp: {} };
		STATS.set(combat.id, s);
	}
	for (const c of combat.combatants) {
		const a = c.actor;
		if (!a || s.actors[a.uuid]) continue;
		s.actors[a.uuid] = { name: c.name ?? a.name, img: c.token?.texture?.src ?? a.img, side: sideOf(c), pc: a.type === 'character', level: num(a.system?.level?.value), rank: a.system?.rank?.value ?? '', villain: a.system?.villain?.value ?? '', start: snapshot(a), ...blankActor() };
		s.hp[a.uuid] = res(a, 'hp').value;
	}
	return s;
}

export const statsFor = (combat) => (combat ? STATS.get(combat.id) ?? null : null);
export const forget = (combat) => STATS.delete(combat.id);

let saveTimer = null;
function save(combat) {
	clearTimeout(saveTimer);
	saveTimer = setTimeout(() => {
		const s = STATS.get(combat.id);
		if (s && game.combats.get(combat.id)) combat.setFlag(MODULE_ID, 'stats', s).catch(() => {});
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
			const prevented = rec.affinity >= 1 || rec.result < rec.amount ? Math.max(0, rec.amount - Math.max(0, rec.result)) : 0;
			if (prevented && rec.hpBefore > rec.result) tgt.prevented += prevented;
			if (src && src !== tgt) {
				src.dealt += dealt;
				src.hits += 1;
				src.biggest = Math.max(src.biggest, dealt);
				if (!s.biggest || dealt > s.biggest.amount) s.biggest = { amount: dealt, src: rec.src, tgt: rec.tgt, type: rec.dtype };
				s.lastHit[rec.tgt] = rec.src;
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

/** Every client: send a record to the active GM */
export function record(rec) {
	if (!game.combat?.started) return;
	if (activeGM()) apply(rec);
	else game.socket.emit(SOCKET, { type: 'rec', rec });
}

export function onSocketRecord(msg) {
	if (msg?.type === 'rec' && activeGM()) apply(msg.rec);
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
	Hooks.on('projectfu.events.gain', (ev) => {
		try {
			if (!ev?.actor || !['hp', 'mp'].includes(ev.resource)) return;
			record({ k: 'gain', res: ev.resource, amount: num(ev.amount), src: ev.source?.actor?.uuid ?? null, tgt: ev.actor.uuid, revive: ev.resource === 'hp' && res(ev.actor, 'hp').value <= 0 });
		} catch (err) {
			console.warn(`${MODULE_ID} | gain`, err);
		}
	});
	Hooks.on('projectfu.events.checks.resolve', (ev) => {
		const c = ev?.check;
		if (!c || !(c.critical || c.fumble)) return;
		record({ k: 'check', src: ev.source?.actor?.uuid ?? null, critical: !!c.critical, fumble: !!c.fumble });
	});
	Hooks.on('projectfu.events.status', (ev) => {
		if (!ev?.actor || !ev.status) return;
		record({ k: 'status', src: ev.source?.actor?.uuid ?? null, tgt: ev.actor.uuid, status: ev.status, enabled: !!ev.enabled });
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
			const before = num(s.hp[actor.uuid], res(actor, 'hp').max);
			const now = res(actor, 'hp').value;
			if (before > 0 && now <= 0) {
				me.falls += 1;
				const killer = s.actors[s.lastHit[actor.uuid]];
				if (killer && killer.side !== me.side) killer.kos += 1;
			}
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
