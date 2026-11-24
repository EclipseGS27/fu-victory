import { MODULE_ID, duration, esc } from './util.mjs';
import { OUTCOMES, RECORD_KEYS, titleFor } from './report.mjs';
import { showScreen } from './screen.mjs';

const { ApplicationV2 } = foundry.applications.api;
const RECORD_LABEL = { dealt: 'Damage', healed: 'Healing', prevented: 'Prevented', biggest: 'Biggest hit', buffs: 'Buffs', debuffs: 'Debuffs', revives: 'Revives', kos: 'Finishing blows', crits: 'Criticals' };

/** Past battles (click to see the screen again) and every hero's personal bests */
export class HistoryApp extends ApplicationV2 {
	static DEFAULT_OPTIONS = {
		id: 'fuvs-history',
		classes: ['fuvs-history'],
		window: { title: 'Battle history', icon: 'fa-solid fa-book', resizable: true },
		position: { width: 640, height: 620 },
		actions: { open: HistoryApp.#open, remove: HistoryApp.#remove, show: HistoryApp.#show },
	};

	async _renderHTML() {
		const list = game.settings.get(MODULE_ID, 'history') ?? [];
		const records = game.settings.get(MODULE_ID, 'records') ?? {};
		const names = new Map();
		for (const b of list) for (const h of b.heroes) names.set(h.uuid, h.name);
		const div = document.createElement('div');
		div.className = 'fuvs-hist';
		const rows = list
			.map(
				(b) => `<li class="tone-${OUTCOMES[b.outcome]?.tone}">
				<button type="button" class="row" data-action="open" data-id="${b.id}">
					<b>${esc(titleFor(b.outcome))}</b><span>${esc(b.scene || 'Battle')}</span>
					<small>${new Date(b.date).toLocaleString()} · ${b.rounds} rounds · ${duration(b.duration)} · ${b.totals.defeated}/${b.foes.length} enemies</small>
				</button>
				${game.user.isGM ? `<button type="button" data-action="show" data-id="${b.id}" data-tooltip="Show to everyone"><i class="fa-solid fa-display"></i></button><button type="button" data-action="remove" data-id="${b.id}" data-tooltip="Delete"><i class="fa-solid fa-trash"></i></button>` : ''}
			</li>`,
			)
			.join('');
		const recs = Object.entries(records)
			.map(([uuid, r]) => {
				const a = fromUuidSync(uuid);
				const nm = a?.name ?? names.get(uuid);
				if (!nm) return '';
				return `<tr><th>${esc(nm)}</th>${RECORD_KEYS.map((k) => `<td>${r[k] ? Math.round(r[k]).toLocaleString() : '–'}</td>`).join('')}</tr>`;
			})
			.join('');
		div.innerHTML = `<h3>Battles</h3><ul class="battles">${rows || '<li class="empty">No battles yet.</li>'}</ul>
			<h3>Personal bests</h3>${recs ? `<div class="tw"><table><thead><tr><th></th>${RECORD_KEYS.map((k) => `<th>${RECORD_LABEL[k]}</th>`).join('')}</tr></thead><tbody>${recs}</tbody></table></div>` : '<p class="empty">Records appear after the first battle.</p>'}`;
		return div;
	}

	_replaceHTML(result, content) {
		content.replaceChildren(result);
	}

	static #find(target) {
		return (game.settings.get(MODULE_ID, 'history') ?? []).find((b) => b.id === target.dataset.id);
	}

	static #open(event, target) {
		const b = HistoryApp.#find(target);
		if (b) showScreen(b, { replay: true, sound: false });
	}

	static #show(event, target) {
		const b = HistoryApp.#find(target);
		if (!b) return;
		game.socket.emit(`module.${MODULE_ID}`, { type: 'show', report: b, replay: true });
		showScreen(b, { replay: true, sound: false });
	}

	static async #remove(event, target) {
		const list = (game.settings.get(MODULE_ID, 'history') ?? []).filter((b) => b.id !== target.dataset.id);
		await game.settings.set(MODULE_ID, 'history', list);
		this.render();
	}
}
