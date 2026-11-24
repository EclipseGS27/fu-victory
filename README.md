# Fabula Ultima Victory Screen

An animated end-of-battle screen for the Project FU system (Foundry v13, Project FU 4.14+). When a combat ends, every player sees the result at the same time: the banner and fanfare, what each hero did, the records they set, and the rewards the GM hands out.

## Install
In Foundry: Add-on Modules → Install Module → paste this Manifest URL:
`https://github.com/EclipseGS27/fu-victory/releases/latest/download/module.json`

## How it works
- During a combat the module keeps score from Project FU's own events (damage, healing, checks, statuses) and from HP / MP / IP changes. Players' clients report to the GM, who keeps the tally; it survives a reload.
- Healing is credited to whoever cast or used it, and a status to whoever applied it (Project FU records that on the effect). When the system doesn't say who did it, the credit goes to the combatant whose turn it is.
- **End the combat** as usual, or with **End battle** in the combat tracker to pick the outcome yourself. When every enemy is down it's a **Victory**, when every hero is down a **Defeat**; otherwise you are asked: **Victory, Defeat, Retreat, Surrender, Negotiated**, or no screen.

## On the screen
- **Banner and fanfare**, coloured by outcome. The fanfare is your own sound file if you set one, Battle UI's fanfare when that module is active, otherwise a short synthesized tune.
- **Combat stats** per hero: damage dealt, biggest hit, enemies defeated (finishing blows), critical successes, damage taken.
- **Support stats**, shown beside the damage with the same weight: healing done, damage prevented (resistances, immunities, absorption and other reductions), buffs given, debuffs inflicted, statuses cleansed, allies revived, MP restored.
- **Battle records**: titles for whoever led each category (Guardian Angel, Lifeline, Bulwark, Tactician, Purifier, Hexer, Wellspring, Heavy Hitter, Giant Slayer, Showstopper, Lucky Star, Iron Wall, Spellslinger). Support titles come first, and every hero gets at least one: their best showing if they led nothing, or Steadfast. **New record** badges mark personal bests.
- **Resources**: HP, MP and IP at the start and the end of the battle, Fabula Points, and the MP and IP each hero spent.
- **Enemies** defeated, **affinities discovered** (vulnerabilities, resistances, immunities, absorption revealed by hits), the biggest hit, rounds and duration.
- **Rewards (GM)**: enter zenit (to each hero, split among them, or to the party fund; **Suggest** gives a homebrew guide: 10 × each defeated enemy's level, × the soldiers it counts as, so 2 for an elite), drop items from the sidebar, a compendium or an enemy's sheet, choose who gets each, then **Hand out rewards**. Players see the rewards appear live.
- **Continue** closes it for a player, and the GM sees who is done; **Close for everyone** ends it.

## Battle history
The book button in the token controls (and on the screen) lists past battles with their outcome; open one to see its screen again, or show it to everyone. It also has each hero's personal bests.

## Settings
World: show to players, always ask for the outcome, hero stats layout (all heroes side by side, or one hero at a time with a tab per hero and a Party tab, optionally opening on each player's own hero), banner text for each outcome, which stat sections to show, battles kept, a sound file for each outcome, a background image (shared or per outcome), typography (JRPG, Foundry default, storybook) and an optional banner font. Client: fanfare on/off, volume, and animations on/off.

API: `game.modules.get('fu-victory').api` → `endBattle(outcome)`, `history()`, `stats()`.

Fonts: Antonio and PT Sans, SIL Open Font License (see fonts/).
