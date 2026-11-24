import { MODULE_ID, SOCKET, activeParty, currency, duration, esc, fmt, num, setting } from './util.mjs';
import { OUTCOMES, titleFor, updateHistory } from './report.mjs';
import { playFanfare } from './fanfare.mjs';

/**
 * The victory screen: a full-window overlay shown to everyone at once. The GM's copy edits the rewards;
 * every change is sent to the players so their screens stay in step.
 */

let current = null; // { report, ready: Set<userId>, replay }
let root = null;

const OFFENSE = [
	['dealt', 'Damage dealt'],
	['biggest', 'Biggest hit'],
	['kos', 'Enemies defeated'],
	['crits', 'Critical successes'],
	['taken', 'Damage taken'],
];
const SUPPORT = [
	['healed', 'Healing done'],
	['prevented', 'Damage prevented'],
	['buffs', 'Buffs given'],
	['debuffs', 'Debuffs inflicted'],
	['cleanses', 'Statuses cleansed'],
	['revives', 'Allies revived'],
	['mpRestored', 'MP restored'],
];
const AFF_LABEL = { vulnerable: 'VU', resistant: 'RS', immune: 'IM', absorbs: 'AB' };
const RECORD_LABEL = { dealt: 'damage', healed: 'healing', prevented: 'damage prevented', biggest: 'biggest hit', buffs: 'buffs', debuffs: 'debuffs', revives: 'revives', kos: 'finishing blows', crits: 'criticals' };

export const isOpen = () => !!root;

export function showScreen(report, { replay = false, sound = true } = {}) {
	closeScreen(false);
	current = { report, ready: new Set(), replay };
	root = document.createElement('div');
	root.id = 'fuvs-root';
	root.className = `fuvs tone-${OUTCOMES[report.outcome]?.tone ?? 'gold'} outcome-${report.outcome}${setting('animations') === false ? ' no-anim' : ''}`;
	applyLook(root, report.outcome);
	document.body.append(root);
	render(true);
	if (sound && !replay) playFanfare(report.outcome);
}

const FONTS = {
	jrpg: ["'FUVS Antonio', 'Antonio', sans-serif", "'FUVS PT Sans', 'PT Sans', sans-serif"],
	foundry: ['var(--font-primary, Signika), sans-serif', 'var(--font-primary, Signika), sans-serif'],
	storybook: ["'Modesto Condensed', 'Palatino Linotype', Georgia, serif", "'Palatino Linotype', Georgia, serif"],
};

/** GM customization: background image (per outcome or shared), fonts */
function applyLook(el, outcome) {
	const bg = setting(`bg_${outcome}`) || setting('background');
	if (bg) el.style.setProperty('--fuvs-bg', `url("${String(bg).replace(/["\\]/g, '')}")`);
	const [disp, text] = FONTS[setting('fonts')] ?? FONTS.jrpg;
	const custom = String(setting('fontBanner') ?? '').replace(/[;{}<>"]/g, '').trim();
	el.style.setProperty('--disp', custom ? `${custom}, ${disp}` : disp);
	el.style.setProperty('--text', text);
	if (bg) el.classList.add('has-bg');
}

export function closeScreen(notify = true) {
	if (!root) return;
	root.classList.add('closing');
	const r = root;
	setTimeout(() => r.remove(), 350);
	root = null;
	if (notify && current && !game.user.isGM && !current.replay) game.socket.emit(SOCKET, { type: 'ready', user: game.user.id });
	current = null;
}

/** Players: the GM changed something */
export function receiveState(report) {
	if (!current || current.report.id !== report.id) return;
	current.report = report;
	render(false);
}

export function receiveReady(userId) {
	if (!current || !game.user.isGM) return;
	current.ready.add(userId);
	const el = root?.querySelector('.fuvs-ready');
	if (el) el.innerHTML = readyLine();
}

/* ---------- rendering ---------- */

function bar(label, start, end) {
	const pct = (v) => (end.max ? Math.max(0, Math.min(100, (v / end.max) * 100)) : 0);
	const diff = end.value - start.value;
	return `<div class="res"><span class="rl">${label}</span>
		<span class="track"><i class="was" style="width:${pct(start.value)}%"></i><i class="now" style="width:${pct(end.value)}%"></i></span>
		<span class="rv">${fmt(end.value)}<small>/${fmt(end.max)}</small> <em class="${diff < 0 ? 'down' : diff > 0 ? 'up' : ''}">${diff > 0 ? '+' : ''}${diff ? fmt(diff) : ''}</em></span></div>`;
}

function stat(h, [k, label]) {
	const v = num(h[k]);
	return `<div class="st ${v ? '' : 'zero'}"><span>${label}</span><b data-n="${v}">${current.first ? 0 : fmt(v)}</b></div>`;
}

function heroCard(h, i) {
	const show = (k) => setting(k) !== false;
	const awards = (h.awards ?? []).map((a) => `<div class="award ${a.support ? 'sup' : ''}" data-tooltip="${esc(a.blurb)}"><i class="fa-solid ${a.support ? 'fa-hand-holding-heart' : 'fa-medal'}"></i><span class="t">${esc(a.title)}</span>${a.value != null ? `<span class="v">${fmt(a.value)} ${esc(a.unit)}</span>` : `<span class="v">${esc(a.blurb)}</span>`}</div>`).join('');
	const recs = (h.newRecords ?? []).map((k) => `<span class="rec">New record: ${esc(RECORD_LABEL[k] ?? k)}</span>`).join('');
	const ko = h.end.hp.value <= 0;
	return `<article class="hero ${ko ? 'ko' : ''}" style="--i:${i}">
		<header><img src="${esc(h.img)}" alt=""><div><div class="nm">${esc(h.name)}</div>${h.level ? `<div class="lv">Level ${h.level}${ko ? ' · KO' : ''}</div>` : ''}</div></header>
		<div class="awards">${awards}</div>${recs ? `<div class="recs">${recs}</div>` : ''}
		<div class="cols">
			${show('showCombat') ? `<div class="col"><h4>Combat</h4>${OFFENSE.map((s) => stat(h, s)).join('')}</div>` : ''}
			${show('showSupport') ? `<div class="col sup"><h4>Support</h4>${SUPPORT.map((s) => stat(h, s)).join('')}</div>` : ''}
		</div>
		${show('showResources') ? `<div class="resources">${bar('HP', h.start.hp, h.end.hp)}${bar('MP', h.start.mp, h.end.mp)}${bar('IP', h.start.ip, h.end.ip)}${spentLine(h)}</div>` : ''}
	</article>`;
}

/** Fabula Points and what the hero spent during the battle */
function spentLine(h) {
	const parts = [];
	if (h.end.fp && h.pc) {
		const d = num(h.end.fp.value) - num(h.start.fp?.value ?? h.end.fp.value);
		parts.push(`<span>FP <b>${fmt(h.end.fp.value)}</b>${d ? ` <em class="${d < 0 ? 'down' : 'up'}">${d > 0 ? '+' : ''}${fmt(d)}</em>` : ''}</span>`);
	}
	const spent = [h.mpSpent ? `${fmt(h.mpSpent)} MP` : '', h.ipSpent ? `${fmt(h.ipSpent)} IP` : ''].filter(Boolean).join(' · ');
	parts.push(`<span>Spent <b>${spent || 'nothing'}</b></span>`);
	return `<div class="spent">${parts.join('')}</div>`;
}

function side(r) {
	const foes = r.foes.map((f) => `<li class="${f.defeated ? 'down' : ''}"><img src="${esc(f.img)}" alt=""><span>${esc(f.name)}</span><small>${f.level ? `Lv ${f.level}` : ''}${f.rank && f.rank !== 'soldier' ? ` ${esc(f.rank)}` : ''}${f.villain ? ` · ${esc(f.villain)} villain` : ''}</small></li>`).join('');
	const aff = setting('showAffinities') === false || !r.affinities.length ? '' : `<section><h3>Affinities discovered</h3>${r.affinities.map((a) => `<div class="aff"><span class="an">${esc(a.name)}</span>${a.list.map((x) => `<span class="chip ${x.aff}">${esc(x.type)} <b>${AFF_LABEL[x.aff] ?? ''}</b></span>`).join('')}</div>`).join('')}</section>`;
	const big = r.biggest ? `<div class="fact"><span>Biggest hit</span><b>${fmt(r.biggest.amount)}</b><small>${esc(r.biggest.srcName)} → ${esc(r.biggest.tgtName)}${r.biggest.type ? ` (${esc(r.biggest.type)})` : ''}</small></div>` : '';
	return `<aside class="side">
		<section><h3>Battle</h3>
			<div class="fact"><span>Rounds</span><b>${r.rounds}</b><small>${duration(r.duration)}</small></div>
			<div class="fact"><span>Party damage</span><b>${fmt(r.totals.dealt)}</b></div>
			<div class="fact"><span>Healing and protection</span><b>${fmt(r.totals.healed + r.totals.prevented)}</b><small>${fmt(r.totals.healed)} healed · ${fmt(r.totals.prevented)} prevented</small></div>
			<div class="fact"><span>Support actions</span><b>${fmt(r.totals.support)}</b></div>
			${big}
		</section>
		${foes ? `<section><h3>Enemies ${r.totals.defeated}/${r.foes.length}</h3><ul class="foes">${foes}</ul></section>` : ''}
		${aff}
	</aside>`;
}

function rewardsHtml(r) {
	const rw = r.rewards;
	const gm = game.user.isGM && !rw.given;
	const heroes = r.heroes;
	const who = (to) => (to === 'party' ? 'Party stash' : heroes.find((h) => h.uuid === to)?.name ?? '?');
	const opts = (sel) => [['party', 'Party stash'], ...heroes.map((h) => [h.uuid, h.name])].map(([v, l]) => `<option value="${esc(v)}" ${v === sel ? 'selected' : ''}>${esc(l)}</option>`).join('');
	const loot = rw.loot.map((l, i) => `<li><img src="${esc(l.img)}" alt=""><span class="ln">${esc(l.name)}${l.qty > 1 ? ` ×${l.qty}` : ''}</span>${gm ? `<select data-loot="${i}">${opts(l.to)}</select><button type="button" data-act="unloot" data-i="${i}" data-tooltip="Remove"><i class="fa-solid fa-xmark"></i></button>` : `<span class="to">→ ${esc(who(l.to))}</span>`}</li>`).join('');
	const split = { each: 'to each hero', split: 'split among the heroes', party: 'to the party fund' };
	if (!gm && !rw.zenit && !rw.loot.length) return '';
	return `<section class="rewards ${rw.given ? 'given' : ''}">
		<h3>Rewards${rw.given ? ' <small>handed out</small>' : ''}</h3>
		${
			gm
				? `<div class="zrow"><label>${esc(currency())} <input type="number" min="0" step="10" data-field="zenit" value="${num(rw.zenit)}"></label>
				<select data-field="split">${Object.entries(split).map(([k, l]) => `<option value="${k}" ${k === rw.split ? 'selected' : ''}>${l}</option>`).join('')}</select>
				<button type="button" data-act="suggest" data-tooltip="Homebrew guide: 10 × each defeated enemy's level, × the soldiers it counts as (elite 2, champion X)">Suggest</button></div>
				<div class="drop">Drop items here from the sidebar, a compendium or an enemy's sheet</div>`
				: rw.zenit
					? `<div class="zline"><b>${fmt(rw.zenit)} ${esc(currency())}</b> ${split[rw.split] ?? ''}</div>`
					: ''
		}
		${loot ? `<ul class="loot">${loot}</ul>` : ''}
		${gm ? `<button type="button" class="cta" data-act="give"><i class="fa-solid fa-gift"></i> Hand out rewards</button>` : ''}
	</section>`;
}

function readyLine() {
	if (!game.user.isGM || current.replay) return '';
	const players = game.users.filter((u) => u.active && !u.isGM);
	if (!players.length) return '';
	return players.map((u) => `<span class="${current.ready.has(u.id) ? 'ok' : ''}">${current.ready.has(u.id) ? '<i class="fa-solid fa-check"></i>' : '<i class="fa-regular fa-clock"></i>'} ${esc(u.name)}</span>`).join('');
}

function render(first) {
	if (!root || !current) return;
	const r = current.report;
	current.first = first && setting('animations') !== false;
	const title = titleFor(r.outcome);
	const letters = [...title].map((ch, i) => `<span style="--i:${i}">${ch === ' ' ? '&nbsp;' : esc(ch)}</span>`).join('');
	const when = new Date(r.date).toLocaleString();
	root.innerHTML = `<div class="fuvs-scrim"></div>
	<div class="fuvs-wrap ${first ? 'enter' : ''}">
		<div class="fuvs-banner"><div class="shine"></div><h1>${letters}</h1>
			<div class="sub">${esc(r.scene || 'Battle')} · ${r.rounds} round${r.rounds === 1 ? '' : 's'} · ${duration(r.duration)}${current.replay ? ` · ${esc(when)}` : ''}</div></div>
		<div class="fuvs-body">
			<div class="party">${r.heroes.map(heroCard).join('') || '<p class="empty">No heroes took part.</p>'}</div>
			${side(r)}
		</div>
		${rewardsHtml(r)}
		<footer><div class="fuvs-ready">${readyLine()}</div><span class="sp"></span>
			${game.user.isGM ? `<button type="button" data-act="history"><i class="fa-solid fa-book"></i> Battle history</button>` : ''}
			${game.user.isGM && !current.replay ? `<button type="button" class="cta" data-act="closeAll">Close for everyone</button>` : `<button type="button" class="cta" data-act="close">Continue</button>`}
		</footer>
	</div>`;
	wire();
	if (current.first) countUp();
}

function countUp() {
	const els = root.querySelectorAll('[data-n]');
	const start = performance.now() + 900;
	const len = 1100;
	const step = (t) => {
		if (!root) return;
		const k = Math.max(0, Math.min(1, (t - start) / len));
		const e = 1 - Math.pow(1 - k, 3);
		for (const el of els) el.textContent = fmt(num(el.dataset.n) * e);
		if (k < 1) requestAnimationFrame(step);
	};
	requestAnimationFrame(step);
}

/* ---------- GM editing ---------- */

let pushTimer = null;
function push() {
	clearTimeout(pushTimer);
	pushTimer = setTimeout(() => {
		if (!current) return;
		game.socket.emit(SOCKET, { type: 'state', report: current.report });
		updateHistory(current.report);
	}, 250);
}

function wire() {
	root.querySelector('[data-act=close]')?.addEventListener('click', () => closeScreen());
	root.querySelector('[data-act=closeAll]')?.addEventListener('click', () => {
		game.socket.emit(SOCKET, { type: 'close', id: current?.report.id });
		closeScreen(false);
	});
	root.querySelector('[data-act=history]')?.addEventListener('click', () => game.modules.get(MODULE_ID).api.history());
	if (!game.user.isGM || current.report.rewards.given) return;
	const rw = current.report.rewards;
	root.querySelector('[data-field=zenit]')?.addEventListener('change', (e) => {
		rw.zenit = Math.max(0, num(e.target.value));
		push();
	});
	root.querySelector('[data-field=split]')?.addEventListener('change', (e) => {
		rw.split = e.target.value;
		push();
	});
	root.querySelector('[data-act=suggest]')?.addEventListener('click', () => {
		const soldiers = (f) => (f.rank === 'champion' ? Math.max(1, num(f.replaced, 2)) : f.rank === 'elite' ? 2 : 1);
		rw.zenit = current.report.foes.filter((f) => f.defeated).reduce((s, f) => s + 10 * Math.max(1, num(f.level)) * soldiers(f), 0);
		rw.zenit = Math.round(rw.zenit / 10) * 10;
		render(false);
		push();
	});
	root.querySelectorAll('select[data-loot]').forEach((s) =>
		s.addEventListener('change', (e) => {
			rw.loot[num(e.target.dataset.loot)].to = e.target.value;
			push();
		}),
	);
	root.querySelectorAll('[data-act=unloot]').forEach((b) =>
		b.addEventListener('click', () => {
			rw.loot.splice(num(b.dataset.i), 1);
			render(false);
			push();
		}),
	);
	const drop = root.querySelector('.rewards');
	drop?.addEventListener('dragover', (e) => {
		e.preventDefault();
		drop.classList.add('over');
	});
	drop?.addEventListener('dragleave', () => drop.classList.remove('over'));
	drop?.addEventListener('drop', async (e) => {
		e.preventDefault();
		drop.classList.remove('over');
		const TE = foundry.applications?.ux?.TextEditor?.implementation ?? TextEditor;
		const data = TE.getDragEventData(e);
		if (data?.type !== 'Item' || !data.uuid) return ui.notifications.warn('Drop an item.');
		const item = await fromUuid(data.uuid);
		if (!item) return;
		const same = rw.loot.find((l) => l.uuid === item.uuid);
		if (same) same.qty += 1;
		else rw.loot.push({ uuid: item.uuid, name: item.name, img: item.img, qty: 1, to: 'party' });
		render(false);
		push();
	});
	root.querySelector('[data-act=give]')?.addEventListener('click', give);
}

async function addZenit(actor, amount) {
	if (!actor || !amount) return;
	await actor.update({ 'system.resources.zenit.value': num(actor.system?.resources?.zenit?.value) + amount });
}

async function give() {
	const r = current.report;
	const rw = r.rewards;
	const heroes = r.heroes.map((h) => ({ h, actor: fromUuidSync(h.uuid) })).filter((x) => x.actor && x.actor.type === 'character');
	const party = activeParty();
	const lines = [];
	const z = Math.floor(num(rw.zenit));
	if (z > 0) {
		if (rw.split === 'party') {
			if (!party) return ui.notifications.warn('No active Party actor for the party fund.');
			await addZenit(party, z);
			lines.push(`${fmt(z)} ${currency()} to the party fund`);
		} else {
			const each = rw.split === 'split' ? Math.floor(z / Math.max(1, heroes.length)) : z;
			for (const { actor } of heroes) await addZenit(actor, each);
			lines.push(`${fmt(each)} ${currency()} to each hero`);
		}
	}
	for (const l of rw.loot) {
		const src = await fromUuid(l.uuid);
		const to = l.to === 'party' ? party : fromUuidSync(l.to);
		if (!src || !to) {
			ui.notifications.warn(`Couldn't hand out ${l.name}.`);
			continue;
		}
		const data = src.toObject();
		delete data._id;
		if (l.qty > 1 && data.system?.quantity) data.system.quantity.value = l.qty;
		const n = l.qty > 1 && !data.system?.quantity ? l.qty : 1;
		await to.createEmbeddedDocuments('Item', Array.from({ length: n }, () => foundry.utils.deepClone(data)));
		lines.push(`${l.name}${l.qty > 1 ? ` ×${l.qty}` : ''} to ${to.name}`);
	}
	rw.given = true;
	if (lines.length) ChatMessage.create({ content: `<div class="fuvs-chat"><h3>${esc(titleFor(r.outcome))}</h3><ul>${lines.map((l) => `<li>${esc(l)}</li>`).join('')}</ul></div>`, speaker: { alias: 'Rewards' } });
	render(false);
	push();
}
