import { MODULE_ID, actorFrom, num, res, setting } from './util.mjs';
import { blankActor } from './tracker.mjs';

export const OUTCOMES = {
	victory: { label: 'Victory', tone: 'gold' },
	defeat: { label: 'Defeat', tone: 'red' },
	retreat: { label: 'Retreat', tone: 'blue' },
	surrender: { label: 'Surrender', tone: 'violet' },
	negotiated: { label: 'Negotiated', tone: 'green' },
};

export const titleFor = (outcome) => setting(`title_${outcome}`) || { victory: 'Victory!', defeat: 'Defeat', retreat: 'Escaped!', surrender: 'Surrendered', negotiated: 'Agreement reached' }[outcome];

/**
 * Battle records. Support awards come first on purpose: healing, protecting and setting up allies win
 * battles as surely as damage does, and every hero leaves with at least one title.
 */
export const AWARDS = [
	{ id: 'revives', title: 'Guardian Angel', blurb: 'brought allies back on their feet', unit: 'revived', support: true },
	{ id: 'healed', title: 'Lifeline', blurb: 'restored the most Hit Points', unit: 'HP healed', support: true },
	{ id: 'prevented', title: 'Bulwark', blurb: 'shrugged off the most damage', unit: 'damage prevented', support: true },
	{ id: 'buffs', title: 'Tactician', blurb: 'empowered the party the most', unit: 'buffs given', support: true },
	{ id: 'cleanses', title: 'Purifier', blurb: 'cleared away the most status effects', unit: 'cleansed', support: true },
	{ id: 'debuffs', title: 'Hexer', blurb: 'weakened the enemy the most', unit: 'debuffs inflicted', support: true },
	{ id: 'mpRestored', title: 'Wellspring', blurb: 'restored the most Mind Points', unit: 'MP restored', support: true },
	{ id: 'dealt', title: 'Heavy Hitter', blurb: 'dealt the most damage', unit: 'damage dealt' },
	{ id: 'kos', title: 'Giant Slayer', blurb: 'landed the most finishing blows', unit: 'enemies defeated' },
	{ id: 'biggest', title: 'Showstopper', blurb: 'landed the single biggest hit', unit: 'in one hit' },
	{ id: 'crits', title: 'Lucky Star', blurb: 'rolled the most critical successes', unit: 'critical successes' },
	{ id: 'taken', title: 'Iron Wall', blurb: 'took the most damage and kept standing', unit: 'damage taken', standing: true },
	{ id: 'mpSpent', title: 'Spellslinger', blurb: 'poured the most Mind Points into the fight', unit: 'MP spent' },
];

export const RECORD_KEYS = ['dealt', 'healed', 'prevented', 'biggest', 'buffs', 'debuffs', 'revives', 'kos', 'crits'];

/** Pick awards: the leader of each category gets it; heroes left with nothing get their best showing */
export function assignAwards(heroes) {
	const out = new Map(heroes.map((h) => [h.uuid, []]));
	for (const aw of AWARDS) {
		const pool = heroes.filter((h) => num(h[aw.id]) > 0 && (!aw.standing || h.end.hp.value > 0));
		if (!pool.length) continue;
		const best = Math.max(...pool.map((h) => num(h[aw.id])));
		for (const h of pool.filter((x) => num(x[aw.id]) === best)) out.get(h.uuid).push({ id: aw.id, title: aw.title, blurb: aw.blurb, value: best, unit: aw.unit, support: !!aw.support });
	}
	for (const h of heroes) {
		const list = out.get(h.uuid);
		if (list.length) continue;
		// their strongest category relative to the party's best
		let pick = null;
		for (const aw of AWARDS) {
			const v = num(h[aw.id]);
			if (v <= 0) continue;
			const top = Math.max(...heroes.map((x) => num(x[aw.id])));
			const score = v / top + (aw.support ? 0.15 : 0);
			if (!pick || score > pick.score) pick = { aw, v, score };
		}
		if (pick) list.push({ id: pick.aw.id, title: `Rising ${pick.aw.title}`, blurb: pick.aw.blurb.replace('the most', 'a lot of').replace('the single biggest', 'a big'), value: pick.v, unit: pick.aw.unit, support: !!pick.aw.support });
		else list.push({ id: 'steadfast', title: h.end.hp.value > 0 ? 'Steadfast' : 'Fallen Hero', blurb: h.end.hp.value > 0 ? 'held the line with the party to the end' : 'gave everything for the party', value: null, unit: '' });
	}
	return out;
}

/** Turn the GM's running tally into a finished, self-contained report */
export function buildReport(combat, stats, outcome) {
	const heroes = [];
	const foes = [];
	for (const [uuid, a] of Object.entries(stats.actors)) {
		const actor = actorFrom(uuid);
		const end = actor ? { hp: res(actor, 'hp'), mp: res(actor, 'mp'), ip: res(actor, 'ip') } : a.start;
		const row = { uuid, ...blankActor(), ...a, end };
		if (a.side === 'heroes') heroes.push(row);
		else if (a.side === 'foes') foes.push(row);
	}
	const awards = assignAwards(heroes);
	for (const h of heroes) h.awards = awards.get(h.uuid);

	const records = game.settings.get(MODULE_ID, 'records') ?? {};
	for (const h of heroes) {
		h.newRecords = [];
		const r = (records[h.uuid] ??= {});
		for (const k of RECORD_KEYS) {
			const v = num(h[k]);
			if (v > 0 && v > num(r[k])) {
				if (num(r[k]) > 0) h.newRecords.push(k);
				r[k] = v;
			}
		}
	}

	const affinities = Object.entries(stats.affinities ?? {}).map(([uuid, map]) => ({ name: stats.actors[uuid]?.name ?? '?', img: stats.actors[uuid]?.img, list: Object.entries(map).map(([type, aff]) => ({ type, aff })) }));
	const biggest = stats.biggest ? { ...stats.biggest, srcName: stats.actors[stats.biggest.src]?.name ?? '?', tgtName: stats.actors[stats.biggest.tgt]?.name ?? '?' } : null;

	return {
		id: foundry.utils.randomID(),
		combatId: combat.id,
		outcome,
		date: Date.now(),
		scene: stats.scene || combat.scene?.name || '',
		rounds: num(combat.round),
		duration: Date.now() - num(stats.started, Date.now()),
		heroes,
		foes: foes.map((f) => ({ uuid: f.uuid, name: f.name, img: f.img, level: f.level, rank: f.rank, villain: f.villain, defeated: f.end.hp.value <= 0, dealt: f.dealt })),
		totals: {
			dealt: heroes.reduce((s, h) => s + h.dealt, 0),
			taken: heroes.reduce((s, h) => s + h.taken, 0),
			healed: heroes.reduce((s, h) => s + h.healed, 0),
			prevented: heroes.reduce((s, h) => s + h.prevented, 0),
			support: heroes.reduce((s, h) => s + h.buffs + h.debuffs + h.cleanses + h.revives, 0),
			defeated: foes.filter((f) => f.end.hp.value <= 0).length,
		},
		affinities,
		biggest,
		rewards: { zenit: 0, split: 'each', loot: [], given: false },
		_records: records,
	};
}

/** Guess the outcome; null when only the GM can tell */
export function detectOutcome(combat, stats) {
	const rows = Object.entries(stats?.actors ?? {});
	const hp = (uuid) => res(actorFrom(uuid), 'hp').value;
	const foes = rows.filter(([, a]) => a.side === 'foes');
	const heroes = rows.filter(([, a]) => a.side === 'heroes');
	const defeatedMark = new Set(combat.combatants.filter((c) => c.defeated).map((c) => c.actor?.uuid));
	if (heroes.length && heroes.every(([u]) => hp(u) <= 0)) return 'defeat';
	if (foes.length && foes.every(([u]) => hp(u) <= 0 || defeatedMark.has(u))) return 'victory';
	if (heroes.length && heroes.every(([u]) => hp(u) <= 0 || defeatedMark.has(u))) return 'surrender';
	return null;
}

export async function saveHistory(report) {
	const { _records, ...clean } = report;
	await game.settings.set(MODULE_ID, 'records', _records);
	const list = (game.settings.get(MODULE_ID, 'history') ?? []).filter((r) => r.id !== clean.id);
	list.unshift(clean);
	await game.settings.set(MODULE_ID, 'history', list.slice(0, num(setting('historySize'), 30)));
	return clean;
}

export async function updateHistory(report) {
	const list = game.settings.get(MODULE_ID, 'history') ?? [];
	const i = list.findIndex((r) => r.id === report.id);
	if (i >= 0) {
		list[i] = report;
		await game.settings.set(MODULE_ID, 'history', list);
	}
}
