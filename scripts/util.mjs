export const MODULE_ID = 'fu-victory';
export const SOCKET = `module.${MODULE_ID}`;
export const SYSTEM = 'projectfu';

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);
export const num = (v, d = 0) => {
	const n = Number(v);
	return Number.isFinite(n) ? n : d;
};
export const setting = (key) => {
	try {
		return game.settings.get(MODULE_ID, key);
	} catch {
		return undefined;
	}
};
export const fmt = (n) => Math.round(num(n)).toLocaleString();

export function currency() {
	try {
		return game.i18n.localize(game.settings.get(SYSTEM, 'optionRenameCurrency') || 'FU.Zenit');
	} catch {
		return 'Zenit';
	}
}

export const res = (actor, key) => ({ value: num(actor?.system?.resources?.[key]?.value), max: num(actor?.system?.resources?.[key]?.max) });

export function activeParty() {
	try {
		// Project FU stores the active party under 'optionActiveParty' (an actor id)
		const v = game.settings.get(SYSTEM, 'optionActiveParty');
		const p = v instanceof Actor ? v : v ? game.actors.get(v) : null;
		if (p) return p;
	} catch {
		/* older system */
	}
	return game.actors.find((a) => a.type === 'party') ?? null;
}

/** Resolve an actor uuid without awaiting (world actors and unlinked token actors) */
export function actorFrom(uuid) {
	if (!uuid) return null;
	try {
		return fromUuidSync(uuid) ?? null;
	} catch {
		return null;
	}
}

export const duration = (ms) => {
	const s = Math.max(0, Math.round(ms / 1000));
	const m = Math.floor(s / 60);
	return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m ${String(s % 60).padStart(2, '0')}s`;
};

export const isGM = () => game.user.isGM;
export const activeGM = () => game.users.activeGM?.isSelf ?? game.user.isGM;

/**
 * Listen to a Project FU event. Project FU 4.x sends some events (resource updates, consumables, expenses,
 * checks being rendered…) only through its own AsyncHooks, which awaits listeners; 5.x sends everything through
 * Foundry's Hooks. Listen on both, and run once per event object.
 */
export function onFuEvent(name, fn) {
	const seen = new WeakSet();
	const once = (ev, ...rest) => {
		if (ev && typeof ev === 'object') {
			if (seen.has(ev)) return undefined;
			seen.add(ev);
		}
		return fn(ev, ...rest);
	};
	Hooks.on(name, once);
	const version = game.system?.version ?? '0';
	if (game.system?.id !== 'projectfu' || foundry.utils.isNewerVersion(version, '4.99.99')) return;
	import(foundry.utils.getRoute('systems/projectfu/module/helpers/async-hooks.mjs'))
		.then(({ AsyncHooks }) => AsyncHooks?.on?.(name, once))
		.catch(() => {
			/* this Project FU version has no AsyncHooks */
		});
}
