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
		const id = game.settings.get(SYSTEM, 'activeParty');
		const p = id ? game.actors.get(id) : null;
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
