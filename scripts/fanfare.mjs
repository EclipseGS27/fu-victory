import { setting } from './util.mjs';

/**
 * The fanfare: a sound file the GM picked, else Battle UI's fanfare when that module is active,
 * else a short tune synthesized on the spot (an original arpeggio, nothing borrowed).
 */
const TUNES = {
	victory: [
		[523.25, 0, 0.14], [659.25, 0.14, 0.14], [783.99, 0.28, 0.14], [1046.5, 0.42, 0.5],
		[783.99, 0.98, 0.14], [1046.5, 1.12, 0.9],
	],
	negotiated: [[587.33, 0, 0.2], [739.99, 0.2, 0.2], [880, 0.4, 0.7]],
	retreat: [[659.25, 0, 0.12], [587.33, 0.12, 0.12], [659.25, 0.24, 0.12], [880, 0.36, 0.5]],
	surrender: [[493.88, 0, 0.35], [440, 0.35, 0.35], [392, 0.7, 0.8]],
	defeat: [[392, 0, 0.45], [369.99, 0.45, 0.45], [349.23, 0.9, 0.45], [261.63, 1.35, 1.2]],
};

let ctx = null;
function synth(outcome, volume) {
	try {
		ctx ??= new (window.AudioContext || window.webkitAudioContext)();
		const t0 = ctx.currentTime + 0.05;
		const master = ctx.createGain();
		master.gain.value = 0.18 * volume;
		master.connect(ctx.destination);
		for (const [f, at, len] of TUNES[outcome] ?? TUNES.victory) {
			for (const [type, mult, g] of [['triangle', 1, 1], ['square', 2, 0.18]]) {
				const o = ctx.createOscillator();
				const env = ctx.createGain();
				o.type = type;
				o.frequency.value = f * mult;
				env.gain.setValueAtTime(0, t0 + at);
				env.gain.linearRampToValueAtTime(g, t0 + at + 0.02);
				env.gain.exponentialRampToValueAtTime(0.001, t0 + at + len + 0.25);
				o.connect(env).connect(master);
				o.start(t0 + at);
				o.stop(t0 + at + len + 0.3);
			}
		}
	} catch {
		/* no audio */
	}
}

export function playFanfare(outcome) {
	if (setting('fanfare') === false) return;
	const volume = Number(setting('volume') ?? 0.7);
	const custom = setting(`sound_${outcome}`) || (outcome === 'victory' ? setting('sound_victory') : '');
	const play = (src) => foundry.audio.AudioHelper.play({ src, volume, autoplay: true, loop: false, channel: 'interface' }, false);
	try {
		if (custom) return play(custom);
		const bui = game.modules.get('fu-battle-ui');
		if (bui?.active && ['victory', 'negotiated'].includes(outcome)) {
			let pack = 'ff13';
			try {
				pack = game.settings.get('fu-battle-ui', 'sfxPack');
			} catch {
				/* older Battle UI */
			}
			if (['ff13', 'ff7'].includes(pack)) return play(`modules/fu-battle-ui/sounds/${pack}/fanfare.ogg`);
		}
	} catch {
		/* fall through to the synth */
	}
	synth(outcome, volume);
}
