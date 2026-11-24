import { MODULE_ID, SOCKET, activeGM, esc, setting } from './util.mjs';
import { installTracker, onSocketRecord, statsFor, ensure, forget, loadStats } from './tracker.mjs';
import { OUTCOMES, buildReport, detectOutcome, saveHistory, titleFor } from './report.mjs';
import { closeScreen, isOpen, receiveReady, receiveState, showScreen } from './screen.mjs';
import { HistoryApp } from './history.mjs';
import { playFanfare } from './fanfare.mjs';

let pendingOutcome = null;

async function askOutcome(suggested) {
	const D = foundry.applications.api.DialogV2;
	const buttons = Object.entries(OUTCOMES).map(([k, o]) => ({ action: k, label: o.label, default: k === (suggested ?? 'victory') }));
	buttons.push({ action: 'none', label: 'No screen' });
	return D.wait({
		window: { title: 'How did the battle end?', icon: 'fa-solid fa-flag-checkered' },
		content: `<p>Pick the outcome for the victory screen.${suggested ? ` It looks like <b>${esc(OUTCOMES[suggested].label)}</b>.` : ''}</p>`,
		buttons,
		rejectClose: false,
	});
}

/** Active GM: the combat is over, build the report and show it to everyone */
async function finish(combat) {
	const stats = statsFor(combat) ?? loadStats(combat);
	forget(combat);
	if (!stats || !combat.started) return;
	if (!Object.values(stats.actors).some((a) => a.side === 'heroes')) return;
	let outcome = pendingOutcome;
	pendingOutcome = null;
	if (!outcome) {
		const guess = detectOutcome(combat, stats);
		outcome = guess && setting('askAlways') !== true ? guess : await askOutcome(guess);
	}
	if (!outcome || outcome === 'none' || !OUTCOMES[outcome]) return;
	const report = await saveHistory(buildReport(combat, stats, outcome));
	if (setting('showPlayers') !== false) game.socket.emit(SOCKET, { type: 'show', report });
	showScreen(report);
}

/** End the current combat with a chosen outcome (combat tracker button and API) */
async function endBattle(outcome) {
	const combat = game.combat;
	if (!combat) return ui.notifications.info('No combat to end.');
	if (!outcome) {
		const stats = statsFor(combat) ?? ensure(combat);
		outcome = await askOutcome(detectOutcome(combat, stats));
		if (!outcome) return;
	}
	pendingOutcome = outcome;
	await combat.delete();
}

Hooks.once('init', () => {
	const reg = (key, data) => game.settings.register(MODULE_ID, key, { config: true, ...data });
	reg('showPlayers', { name: 'Show the screen to players', hint: 'Off: only the GM sees it.', scope: 'world', type: Boolean, default: true });
	reg('askAlways', { name: 'Always ask for the outcome', hint: 'Off: when every enemy is down it is a Victory, when every hero is down a Defeat, and you are only asked when it is unclear (retreat, surrender, negotiation).', scope: 'world', type: Boolean, default: false });
	for (const [k, o] of Object.entries(OUTCOMES)) reg(`title_${k}`, { name: `Banner text: ${o.label}`, scope: 'world', type: String, default: titleFor(k) });
	reg('layout', {
		name: 'Hero stats',
		hint: 'All heroes side by side, or one hero at a time with a tab for each hero (plus a Party tab), with extra details and each hero\'s share of the party\'s damage, healing and protection.',
		scope: 'world',
		type: String,
		default: 'party',
		choices: { party: 'All heroes side by side', each: 'One hero at a time', mine: 'One hero at a time, players start on their own hero' },
	});
	reg('showCombat', { name: 'Show combat stats', scope: 'world', type: Boolean, default: true });
	reg('showSupport', { name: 'Show support stats', hint: 'Healing, damage prevented, buffs, debuffs, cleansing and revives, next to the damage numbers.', scope: 'world', type: Boolean, default: true });
	reg('showResources', { name: 'Show HP / MP / IP', scope: 'world', type: Boolean, default: true });
	reg('showAffinities', { name: 'Show affinities discovered', scope: 'world', type: Boolean, default: true });
	reg('background', { name: 'Background image', hint: 'Optional image behind the screen (all outcomes). Empty: an animated gradient in the outcome colour.', scope: 'world', type: String, default: '', filePicker: 'image' });
	for (const [k, o] of Object.entries(OUTCOMES)) reg(`bg_${k}`, { name: `Background: ${o.label}`, hint: 'Optional, overrides the shared background for this outcome.', scope: 'world', type: String, default: '', filePicker: 'image' });
	reg('fonts', { name: 'Typography', scope: 'world', type: String, default: 'jrpg', choices: { jrpg: 'JRPG (Antonio and PT Sans)', foundry: 'Foundry default', storybook: 'Storybook (serif)' } });
	reg('fontBanner', { name: 'Banner font (optional)', hint: 'Name of any font installed in Foundry (Settings → Fonts) to use for the banner and headings.', scope: 'world', type: String, default: '' });
	reg('animations', { name: 'Animations', hint: 'Off: the screen appears without the letter drop, count-up and slide-in effects.', scope: 'client', type: Boolean, default: true });
	reg('historySize', { name: 'Battles kept in the history', scope: 'world', type: Number, range: { min: 5, max: 100, step: 5 }, default: 30 });
	reg('fanfare', { name: 'Fanfare', scope: 'client', type: Boolean, default: true });
	reg('volume', { name: 'Fanfare volume', scope: 'client', type: Number, range: { min: 0, max: 1, step: 0.05 }, default: 0.7 });
	for (const [k, o] of Object.entries(OUTCOMES)) reg(`sound_${k}`, { name: `Sound: ${o.label}`, hint: 'Optional audio file. Empty: Battle UI\'s fanfare when it is active (victories), otherwise a short synthesized tune.', scope: 'world', type: String, default: '', filePicker: 'audio' });
	game.settings.register(MODULE_ID, 'history', { scope: 'world', config: false, type: Array, default: [], onChange: () => foundry.applications.instances?.get('fuvs-history')?.render() });
	game.settings.register(MODULE_ID, 'records', { scope: 'world', config: false, type: Object, default: {} });

	installTracker();
	game.modules.get(MODULE_ID).api = {
		endBattle,
		history: () => new HistoryApp().render({ force: true }),
		show: (report) => showScreen(report, { replay: true }),
		close: () => closeScreen(),
		fanfare: playFanfare,
		stats: () => statsFor(game.combat),
	};
});

Hooks.once('ready', () => {
	game.socket.on(SOCKET, (msg, userId) => {
		// only a GM shows, changes or closes the screen for everyone
		const fromGM = !!game.users.get(userId)?.isGM;
		switch (msg?.type) {
			case 'rec':
				return onSocketRecord(msg, userId);
			case 'show':
				if (fromGM && (!game.user.isGM || msg.replay)) showScreen(msg.report, { replay: !!msg.replay });
				return;
			case 'state':
				return fromGM ? receiveState(msg.report) : undefined;
			case 'ready':
				return receiveReady(msg.user);
			case 'close':
				if (fromGM && isOpen()) closeScreen(false);
				return;
		}
	});
});

Hooks.on('deleteCombat', (combat) => {
	if (activeGM()) finish(combat).catch((err) => console.error(`${MODULE_ID} |`, err));
});

/* "End battle" in the combat tracker */
Hooks.on('renderCombatTracker', (app, html) => {
	if (!game.user.isGM || !game.combat?.started) return;
	const el = html instanceof HTMLElement ? html : html[0];
	if (!el || el.querySelector('.fuvs-end')) return;
	const btn = document.createElement('button');
	btn.type = 'button';
	btn.className = 'fuvs-end';
	btn.innerHTML = '<i class="fa-solid fa-flag-checkered"></i> End battle';
	btn.dataset.tooltip = 'End the combat and show the victory screen (pick the outcome)';
	btn.addEventListener('click', () => endBattle());
	const host = el.querySelector('.combat-controls') ?? el.querySelector('footer') ?? el.querySelector('nav') ?? el;
	host.append(btn);
});

/* Battle history in the token controls */
Hooks.on('getSceneControlButtons', (controls) => {
	try {
		const tokens = controls.tokens ?? controls.token;
		if (tokens?.tools && !Array.isArray(tokens.tools)) tokens.tools.fuvsHistory = { name: 'fuvsHistory', title: 'Battle history', icon: 'fa-solid fa-book', button: true, order: 61, visible: true, onChange: () => new HistoryApp().render({ force: true }) };
	} catch (err) {
		console.warn(`${MODULE_ID} | scene control`, err);
	}
});
