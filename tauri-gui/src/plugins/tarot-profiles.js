/**
 * @file tarot-profiles.js
 * @module Spoti-Tauri / Stats & Fate — Fate Book
 *
 * @description
 * Pixel-Themed Tarot Quest Collection for the "Stats & Fate" (Spotify Wrapped) feature.
 *
 * Each card in TAROT_PROFILES represents a **collectible listening quest/achievement**
 * in the Fate Book. Cards are unlocked dynamically based on the user's local play
 * history and persist across sessions via localStorage under the key
 * `"stats-fate-unlocked-tarot"`.
 *
 * Design Brief:
 * ─────────────
 * • Retro RPG pixel aesthetic fused with mystical tarot divination.
 * • 22 Major Arcana cards mapped to distinct listening behaviours.
 * • Each card carries: RPG stat attributes, quest/trigger logic, lore, and
 *   upright/reversed interpretive meanings rooted in real tarot tradition —
 *   but recontextualised for modern music consumption habits.
 * • Trigger functions receive a `stats` object derived from the local play-history
 *   database. See the Stats & Fate heuristics spec for full field definitions.
 *
 * @author   Spoti-Tauri Game Design Team
 * @version  1.0.0
 */

// ─────────────────────────────────────────────────────────────────────────────
// TAROT_PROFILES — All 22 Major Arcana
// ─────────────────────────────────────────────────────────────────────────────

const TAROT_PROFILES = [

  // ── 0 ── The Fool ────────────────────────────────────────────────────────
  {
    id: 0,
    key: "theFool",
    name: "The Fool",
    folder: "0_theFool",
    file: "0_theFool_5x.png",
    mysticTitle: "The Wandering Beat",
    gamingStats: {
      tempo: 45,
      variety: 95,
      obscurity: 80,
      mysticism: 90,
    },
    questDescription:
      "Venture into the unknown. Listen to a high number of unique tracks with very few repetitions.",
    uprightMeaning:
      "You treat music as an endless frontier. A low repeat rate means you are constantly stepping into the unknown, collecting new melodies and leaving them behind like breadcrumbs in an algorithmic forest.",
    reversedMeaning:
      "A lack of playlist anchors might leave you floating in noise. Beware of never letting a song sink deep enough to form a core memory — even a pilgrim needs a campfire song.",
    loreDescription:
      "Level 1 Pilgrim. Equipped with lightweight headphones and an empty playlist. They wander through algorithmic forest tracks, seeking sounds they have never heard. They do not look down at the skip button.",
    trigger: (s) => s.uniqueTracks > 20 && s.ratio < 1.3,
  },

  // ── 1 ── The Magician ─────────────────────────────────────────────────────
  {
    id: 1,
    key: "theMagician",
    name: "The Magician",
    folder: "1_theMagician",
    file: "1_theMagician_5x.png",
    mysticTitle: "The Alchemist of Sound",
    gamingStats: {
      tempo: 78,
      variety: 88,
      obscurity: 65,
      mysticism: 72,
    },
    questDescription:
      "Channel all four elements. Maintain a broad roster of unique artists with a balanced, moderate repeat rate.",
    uprightMeaning:
      "You are a conduit of musical forces. Your listening is intentional — spreading attention across many artists like a master strategist commanding different units on the field. Every genre is a spell in your grimoire.",
    reversedMeaning:
      "The Alchemist who hoards ingredients but never completes the formula. Breadth without depth can leave your taste shapeless — refine your craft by letting a few artists truly transform you.",
    loreDescription:
      "Class: Arcane Curator. Wields a four-channel mixing staff. Each orb above the altar represents a genre mastered. The pixel sparks flying from their hands are corrupted audio packets being purified into pure waveform gold.",
    trigger: (s) => s.uniqueArtists > 15 && s.ratio < 2.0,
  },

  // ── 2 ── The High Priestess ───────────────────────────────────────────────
  {
    id: 2,
    key: "theHighPriestess",
    name: "The High Priestess",
    folder: "2_theHighPriestess",
    file: "2_theHighPriestess_5x.png",
    mysticTitle: "The Midnight Seer",
    gamingStats: {
      tempo: 22,
      variety: 55,
      obscurity: 88,
      mysticism: 99,
    },
    questDescription:
      "Seek wisdom in silence. More than 40% of your listening must occur between midnight and 6 AM.",
    uprightMeaning:
      "The world sleeps, but you receive transmissions. Midnight listening is the ultimate act of musical introspection — the High Priestess reveals hidden meanings in frequencies that daylight minds cannot perceive.",
    reversedMeaning:
      "Secrets kept too long become isolation. Nocturnal listening is sacred, but if all your music lives only in the dark hours, you may be using sound to build walls rather than doors.",
    loreDescription:
      "Guardian of the Sub-Bass Temple. She sits between two monolith speakers — one tuned to the past, one broadcasting frequencies from possible futures. Her veil is woven from spectrograms of songs no one else has heard. The crescent moon above her reads 3:17 AM.",
    trigger: (s) => s.totalPlays > 0 && s.nightPlays / s.totalPlays > 0.4,
  },

  // ── 3 ── The Empress ──────────────────────────────────────────────────────
  {
    id: 3,
    key: "theEmpress",
    name: "The Empress",
    folder: "3_theEmpress",
    file: "3_theEmpress_5x.png",
    mysticTitle: "The Cozy Nurturer",
    gamingStats: {
      tempo: 55,
      variety: 60,
      obscurity: 35,
      mysticism: 68,
    },
    questDescription:
      "Cultivate abundance. Maintain an average track duration between 3:40 and 5:20 — the sweet spot of immersive comfort listening.",
    uprightMeaning:
      "You nest in music like a garden in full bloom. Medium-to-long tracks suggest you seek richness and development in a song — not quick dopamine, but slow, warm nourishment that settles into the body.",
    reversedMeaning:
      "A garden left unattended overgrows. If comfort listening turns into avoidance, the Empress warns that even the coziest sonic cocoon can become a cage. Step into the dissonant thorns occasionally.",
    loreDescription:
      "Realm: The Velvet Grove. The Empress reclines on a throne of blooming woofers, crowned with a laurel of looping waveforms. Her sceptre is a rosewood vinyl stylus. Pixel butterflies — each representing a track played to completion — orbit her like a life counter.",
    trigger: (s) =>
      s.averageTrackDuration > 220 && s.averageTrackDuration < 320,
  },

  // ── 4 ── The Emperor ──────────────────────────────────────────────────────
  {
    id: 4,
    key: "theEmperor",
    name: "The Emperor",
    folder: "4_theEmperor",
    file: "4_theEmperor_5x.png",
    mysticTitle: "Overlord of Loops",
    gamingStats: {
      tempo: 82,
      variety: 18,
      obscurity: 42,
      mysticism: 55,
    },
    questDescription:
      "Assert dominion. Let one track or one artist consume more than 25% or 40% of your total play count respectively.",
    uprightMeaning:
      "You rule with an iron fist and a singular playlist. The Emperor does not wander — they conquer. Your loop loyalty is a declaration: this song or this artist is your territory, and you defend it with relentless replays.",
    reversedMeaning:
      "Tyranny of repetition can calcify your taste into stone. The Emperor reversed asks: are you listening on repeat because it truly nourishes you, or because venturing beyond your empire feels dangerous?",
    loreDescription:
      "The Loop Throne. An iron-clad ruler whose armour is forged from stacked cassette tapes of a single album. Their sceptre is a seek bar locked permanently at 0:00. Four stone pillars behind them each display the play count of the same song, incrementing endlessly. The digit display now reads: 9,999.",
    trigger: (s) =>
      s.totalPlays > 0 &&
      (s.topTrackCount / s.totalPlays > 0.25 ||
        s.topArtistPlays / s.totalPlays > 0.4),
  },

  // ── 5 ── The Hierophant ───────────────────────────────────────────────────
  {
    id: 5,
    key: "theHierophant",
    name: "The Hierophant",
    folder: "5_theHierophant",
    file: "5_theHierophant_5x.png",
    mysticTitle: "The Legacy Guardian",
    gamingStats: {
      tempo: 38,
      variety: 30,
      obscurity: 50,
      mysticism: 80,
    },
    questDescription:
      "Honour your origins. Play the very first track you ever logged in history at least 8 times.",
    uprightMeaning:
      "Tradition is not a prison — it is a foundation. Returning to the track that started your journey means something in that song still speaks to who you are. The Hierophant rewards reverence for roots.",
    reversedMeaning:
      "Dogma dressed as devotion. If you only return to the origin track out of habit or guilt rather than love, the Hierophant reversed urges you to question which traditions still serve you and which simply occupy space.",
    loreDescription:
      "The Archive Sanctum. The Hierophant sits between two towering stacks of physical media — records, tapes, CDs, DAT cartridges — all labelled with the same artist. They hold an open scroll that lists the First Track's metadata in gold pixel font. Two acolytes flank them, each holding a stylus in offering.",
    trigger: (s) => s.firstTrackPlayedCount >= 8,
  },

  // ── 6 ── The Lovers ───────────────────────────────────────────────────────
  {
    id: 6,
    key: "theLovers",
    name: "The Lovers",
    folder: "6_theLovers",
    file: "6_theLovers_5x.png",
    mysticTitle: "The Twin Anthems",
    gamingStats: {
      tempo: 65,
      variety: 70,
      obscurity: 48,
      mysticism: 75,
    },
    questDescription:
      "Find your counterpart. Your top two artists must be nearly equal in play count — within a ratio of 1.2 — and each played at least 5 times.",
    uprightMeaning:
      "Two voices in perfect harmony. You have found a pair of artists who occupy equal territory in your heart, creating a beautiful tension — the soundtrack of a love story told in stereo, neither dominant, neither silent.",
    reversedMeaning:
      "Forced compatibility strains both parties. If your two top artists are balanced but you feel lukewarm about both, the Lovers reversed suggests you are playing it safe, afraid to commit to the one that truly moves you.",
    loreDescription:
      "The Duet Altar. Two pixel figures stand beneath a radiant waveform angel, each holding one earbud of a shared pair. Their track lists are visible on glowing screens and mirror each other almost perfectly — save for one song, different for each, hidden behind their backs.",
    trigger: (s) =>
      s.secondArtistPlays > 0 &&
      s.topArtistPlays / s.secondArtistPlays < 1.2 &&
      s.topArtistPlays > 5,
  },

  // ── 7 ── The Chariot ──────────────────────────────────────────────────────
  {
    id: 7,
    key: "theChariot",
    name: "The Chariot",
    folder: "7_theChariot",
    file: "7_theChariot_5x.png",
    mysticTitle: "The Momentum Engine",
    gamingStats: {
      tempo: 95,
      variety: 55,
      obscurity: 40,
      mysticism: 48,
    },
    questDescription:
      "Harness the peak hours. More than 45% of your total plays must occur in the afternoon window (12 PM – 6 PM).",
    uprightMeaning:
      "You move with the sun at its peak. Afternoon listening is productive, driven, forward-facing. The Chariot wears your headphones like a battle helmet — music is fuel, and you burn it during the hours when the world expects results.",
    reversedMeaning:
      "Speed without direction is just noise. If your heavy afternoon listening reflects anxious over-stimulation rather than purposeful momentum, the Chariot reversed invites you to check: are you running toward something, or from it?",
    loreDescription:
      "The BPM Racer. A pixel warrior in a chariot pulled by two opposing force-fields — one blue (focus), one red (energy) — hurtling across a pixel highway at 160 BPM. The speedometer is a waveform meter. They hold no reins; they steer with willpower alone.",
    trigger: (s) =>
      s.totalPlays > 0 && s.afternoonPlays / s.totalPlays > 0.45,
  },

  // ── 8 ── Strength ─────────────────────────────────────────────────────────
  {
    id: 8,
    key: "strength",
    name: "Strength",
    folder: "11_strength",
    file: "11_strength_5x.png",
    mysticTitle: "The Sonic Marathoner",
    gamingStats: {
      tempo: 60,
      variety: 65,
      obscurity: 50,
      mysticism: 62,
    },
    questDescription:
      "Prove your endurance. Accumulate more than 80 hours of total listening time.",
    uprightMeaning:
      "Endurance is its own form of mastery. Over 80 hours means music is not background noise for you — it is a sustained practice, a daily ritual of presence. Strength is not force; it is the gentle, unbroken commitment to keep listening.",
    reversedMeaning:
      "Even a marathoner must rest. Strength reversed cautions against using music as a volume shield — filling silence out of fear. True sonic endurance requires moments of quiet to appreciate how far you have run.",
    loreDescription:
      "The Infinite Listener. A calm, luminous figure in pixel robes gently places their hand on a massive roaring subwoofer — and it quiets, not from domination, but from understanding. Their HP bar reads MAX. Their stamina gauge shows no depletion. They have been here since the first track.",
    trigger: (s) => s.hoursListened > 80,
  },

  // ── 9 ── The Hermit ───────────────────────────────────────────────────────
  {
    id: 9,
    key: "theHermit",
    name: "The Hermit",
    folder: "9_theHermit",
    file: "9_theHermit_5x.png",
    mysticTitle: "The Solo Hermit",
    gamingStats: {
      tempo: 20,
      variety: 10,
      obscurity: 92,
      mysticism: 95,
    },
    questDescription:
      "Retreat into deep focus. Listen to 8 or fewer unique tracks with more than 30 total plays — pure loop meditation.",
    uprightMeaning:
      "You have chosen depth over breadth — playing the same few tracks until you know every breath, every silence between notes. The Hermit's lantern shines inward. This is not poverty of taste; it is a profound act of sonic devotion.",
    reversedMeaning:
      "The cave that once protected now confines. If those 8 tracks are a moat keeping the world out, the Hermit reversed suggests it may be time to turn the lantern around and let some outside light — and sound — find its way in.",
    loreDescription:
      "The Loop Cave. A solitary pixel sage on a mountaintop, carrying only a lantern with a waveform flame and a single vinyl record worn smooth from play. Their playlist glows behind them — 8 tracks, all played to equal depth, like grooves carved into stone. Snow falls. They do not skip.",
    trigger: (s) => s.uniqueTracks <= 8 && s.totalPlays > 30,
  },

  // ── 10 ── Wheel of Fortune ────────────────────────────────────────────────
  {
    id: 10,
    key: "wheelOfFortune",
    name: "Wheel of Fortune",
    folder: "10_wheelOfFortune",
    file: "10_wheelOfFortune_5x.png",
    mysticTitle: "The Random Shuffler",
    gamingStats: {
      tempo: 70,
      variety: 100,
      obscurity: 72,
      mysticism: 78,
    },
    questDescription:
      "Embrace pure entropy. Achieve an artist-to-track ratio above 0.8 with over 40 total plays — almost every track from a different artist.",
    uprightMeaning:
      "Fortune favours the chaotic. Your listening history resembles a cosmic slot machine — the wheel spins and lands on a new artist almost every time. You are not curating a collection; you are surfing the eternal feed of possibility.",
    reversedMeaning:
      "Randomness mistaken for freedom. If every shuffle feels the same because nothing sticks, the Wheel of Fortune reversed warns that constant novelty can become its own form of numbness. Let the wheel stop sometimes.",
    loreDescription:
      "The Shuffle Cosmos. A great cosmic wheel spins in the pixel sky, divided into 78 segments — one for each track in the history log, each a different colour. Four creatures at the cardinal points each hold a different genre flag. The pointer lands somewhere new every frame. BING. New track. Always.",
    trigger: (s) =>
      s.uniqueTracks > 0 &&
      s.uniqueArtists / s.uniqueTracks > 0.8 &&
      s.totalPlays > 40,
  },

  // ── 11 ── Justice ─────────────────────────────────────────────────────────
  {
    id: 11,
    key: "justice",
    name: "Justice",
    folder: "8_justice",
    file: "8_justice_5x.png",
    mysticTitle: "The Balanced Equalizer",
    gamingStats: {
      tempo: 50,
      variety: 50,
      obscurity: 45,
      mysticism: 60,
    },
    questDescription:
      "Achieve perfect equilibrium. With over 20 total plays, your morning and evening play counts must differ by less than 6% of your total.",
    uprightMeaning:
      "You are the living EQ. Your days are bookended by music with perfect symmetry — dawn and dusk receive equal portions of your ear. Justice does not judge your taste; it commends your balance, the rare gift of giving equal time to both the sunrise and the sunset song.",
    reversedMeaning:
      "A scales tipped in secret. If your balance is forced — deliberately splitting listening to achieve symmetry rather than living it — Justice reversed sees through the performance. Authentic equilibrium cannot be calculated; it must be felt.",
    loreDescription:
      "The Frequency Court. A robed pixel figure sits on a throne flanked by twin equaliser displays — one for morning sessions, one for evening — both showing identical curves. In one hand, a sword of spectral analysis. In the other, scales holding two floating music notes of equal weight. The verdict: Harmony.",
    trigger: (s) =>
      s.totalPlays > 20 &&
      Math.abs(s.morningPlays - s.eveningPlays) < s.totalPlays * 0.06,
  },

  // ── 12 ── The Hanged Man ──────────────────────────────────────────────────
  {
    id: 12,
    key: "theHangedMan",
    name: "The Hanged Man",
    folder: "12_theHangedMan",
    file: "12_theHangedMan_5x.png",
    mysticTitle: "The Patient Listener",
    gamingStats: {
      tempo: 15,
      variety: 40,
      obscurity: 85,
      mysticism: 94,
    },
    questDescription:
      "Surrender to deep time. Maintain an average track duration above 6 minutes — suites, epics, and ambient journeys only.",
    uprightMeaning:
      "You have learned the art of suspension. Six-minute-plus tracks require trust — trust that the journey will be worth the wait, that the silence between movements holds meaning, that not every song needs a hook in the first eight seconds. You have found enlightenment in the long form.",
    reversedMeaning:
      "Patience weaponised as avoidance. The Hanged Man reversed asks whether your preference for long tracks is about the love of depth, or a fear of making choices. Sometimes a three-minute song contains more truth than a twenty-minute epic.",
    loreDescription:
      "The Inverted Pilgrim. Hanging from a pixel tree by one boot, perfectly still, headphones trailing upward as if defying gravity. Their expression: serene. A progress bar floats beside them, only 12% complete. A clock on the tree reads: time remaining — ∞. They do not rush. They never skip.",
    trigger: (s) => s.averageTrackDuration > 360,
  },

  // ── 13 ── Death ───────────────────────────────────────────────────────────
  {
    id: 13,
    key: "death",
    name: "Death",
    folder: "13_death",
    file: "13_death_5x.png",
    mysticTitle: "The Great Rebirth",
    gamingStats: {
      tempo: 55,
      variety: 85,
      obscurity: 75,
      mysticism: 88,
    },
    questDescription:
      "Transform completely. Your top artist in the first half of your history must be entirely different from your top artist in the second half.",
    uprightMeaning:
      "The old self has been composted into fertile ground. A total taste shift means you allowed music to change you — not just accompany you. Death is not an ending; it is the most powerful level-up in the game, the moment the character you were gives way to the character you are becoming.",
    reversedMeaning:
      "The chrysalis that refuses to crack. If your taste shift feels forced or reactive — running from a sound rather than running toward a new one — Death reversed suggests the transformation is incomplete. True rebirth requires grieving what is left behind.",
    loreDescription:
      "The Transition Gate. Death rides a skeletal pixel horse through a field of discarded album covers — all from the old listening era — toward a horizon glowing with the frequencies of a new genre. They carry a scythe that doubles as a crossfader. Old tracks fade out. New ones rise. The transition is always at 0 dB.",
    trigger: (s) => s.tasteShiftDetected === true,
  },

  // ── 14 ── Temperance ──────────────────────────────────────────────────────
  {
    id: 14,
    key: "temperance",
    name: "Temperance",
    folder: "14_temperance",
    file: "14_temperance_5x.png",
    mysticTitle: "The Sound Harmonizer",
    gamingStats: {
      tempo: 52,
      variety: 58,
      obscurity: 45,
      mysticism: 70,
    },
    questDescription:
      "Find the golden mean. Average track duration between 3:00 and 4:00, and a repeat ratio between 1.5 and 2.5 plays per track.",
    uprightMeaning:
      "Neither feast nor fast — you are the alchemist of moderation. Tracks long enough to breathe, short enough to respect your time. Repeated enough to build familiarity, varied enough to keep growing. Temperance is not restraint; it is the mastery of flow.",
    reversedMeaning:
      "Balance maintained by constant effort is exhausting. Temperance reversed warns against a moderate listening diet maintained only through willpower — true harmony comes effortlessly when your tastes naturally align, not when you force the numbers.",
    loreDescription:
      "The Mixing Angel. A winged figure in pixel robes pours audio between two golden chalices — neither overflowing, neither empty. One chalice labelled DEPTH, one labelled BREADTH. The pour is infinite, continuous, perfectly calibrated. The EQ readout behind them shows a flat, pristine line.",
    trigger: (s) =>
      s.averageTrackDuration >= 180 &&
      s.averageTrackDuration <= 240 &&
      s.ratio >= 1.5 &&
      s.ratio <= 2.5,
  },

  // ── 15 ── The Devil ───────────────────────────────────────────────────────
  {
    id: 15,
    key: "theDevil",
    name: "The Devil",
    folder: "15_devil", // Note: mapped to assets
    file: "15_devil_5x.png",
    mysticTitle: "The Obsessive Hook",
    gamingStats: {
      tempo: 88,
      variety: 8,
      obscurity: 38,
      mysticism: 65,
    },
    questDescription:
      "Surrender to the hook. Play your single most-listened track more than 40 times.",
    uprightMeaning:
      "The song has you. Not you, the song. Every listen tightens the chain — but you clicked play again anyway. The Devil does not judge your obsession; it illuminates it. Forty plays means this track has accessed something primal in you, something that logic cannot override.",
    reversedMeaning:
      "The chains were never locked. You could step away at any time — and perhaps you should. The Devil reversed challenges you to ask: what void does this song fill? What would you have to face if the hook finally let go?",
    loreDescription:
      "The Hook Throne. The Devil sits above two chained pixel listeners who stare at screens showing the same track's waveform on repeat. The chains are not iron — they are headphone cables. The play counter on the throne reads: 40+. The listeners look up. They do not look distressed. They look exactly as they want to look.",
    trigger: (s) => s.topTrackCount > 40,
  },

  // ── 16 ── The Tower ───────────────────────────────────────────────────────
  {
    id: 16,
    key: "theTower",
    name: "The Tower",
    folder: "16_theTower",
    file: "16_theTower_5x.png",
    mysticTitle: "The Sonic Collision",
    gamingStats: {
      tempo: 90,
      variety: 92,
      obscurity: 60,
      mysticism: 70,
    },
    questDescription:
      "Shatter all patterns. Achieve a duration variance score above 75 — your track lengths must be wildly inconsistent.",
    uprightMeaning:
      "Your playlist is a lightning bolt. 30-second noise bursts next to 20-minute ambient suites — your listening defies categorisation, shattering every algorithmic box that tries to contain it. The Tower destroys false structures. Your chaos is honest.",
    reversedMeaning:
      "Destruction for its own sake leaves rubble, not revelation. The Tower reversed asks whether your eclecticism is genuine curiosity or an identity built on refusing to be boxed. After the lightning: what do you actually want to build?",
    loreDescription:
      "The Frequency Tower. A great pixel spire struck by a bolt of spectral lightning, its masonry crumbling to reveal the tracks inside — a grindcore 90-seconder lodged next to a 47-minute drone piece, both equally valid, both equally alight. Two pixel listeners fall from the tower, headphones intact, expressions: liberated.",
    trigger: (s) => s.durationVarianceScore > 75,
  },

  // ── 17 ── The Star ────────────────────────────────────────────────────────
  {
    id: 17,
    key: "theStar",
    name: "The Star",
    folder: "17_theStar",
    file: "17_theStar_5x.png",
    mysticTitle: "The Dawn Beacon",
    gamingStats: {
      tempo: 62,
      variety: 72,
      obscurity: 70,
      mysticism: 96,
    },
    questDescription:
      "Rise with the light. More than 40% of your listening must occur during the morning hours (6 AM – 12 PM).",
    uprightMeaning:
      "You greet each day with music as your first act of faith. Morning listening is an optimistic ritual — a signal that you believe the coming hours are worth soundtracking. The Star pours hope over the horizon. You have been doing it all along.",
    reversedMeaning:
      "Even stars dim. Morning music used to crowd out silence and thought becomes less a ritual of hope and more a defence mechanism. The Star reversed asks: can you sit with the quiet of the dawn, just for one morning, and let the hope exist without a score?",
    loreDescription:
      "The Auroral DJ. A luminous pixel figure kneels at the edge of a pixel ocean, pouring music from two urns into the water and the air at the first light of dawn. Seven stars overhead each pulse at the beat of a different genre. The horizon is warming. It is 6:01 AM. First track: loading.",
    trigger: (s) =>
      s.totalPlays > 0 && s.morningPlays / s.totalPlays > 0.4,
  },

  // ── 18 ── The Moon ────────────────────────────────────────────────────────
  {
    id: 18,
    key: "theMoon",
    name: "The Moon",
    folder: "18_theMoon",
    file: "18_theMoon_5x.png",
    mysticTitle: "The Nocturnal Muse",
    gamingStats: {
      tempo: 30,
      variety: 65,
      obscurity: 90,
      mysticism: 98,
    },
    questDescription:
      "Walk the path between dusk and dream. More than 30% of your plays must fall in the late night window (12 AM – 6 AM).",
    uprightMeaning:
      "The Moon illuminates what daylight hides. Late-night listening is the most honest kind — uninhibited by productivity, social performance, or the need to curate for others. What you play at 2 AM is your true self, unfiltered and luminous.",
    reversedMeaning:
      "Illusion nourished in the dark. The Moon reversed warns that nocturnal music can become a place to hide unresolved feelings rather than illuminate them. The path beneath the moon is beautiful, but it does not go in circles — eventually, you must walk it to its end.",
    loreDescription:
      "The Night Garden. A pixel fox and hound walk opposite paths under a full waveform moon, each hearing different music through the same headphone cable that connects them across the frame. The pool beneath the moon reflects a playlist that does not exist in daylight. Crawfish wade in the shallows between genres.",
    trigger: (s) =>
      s.totalPlays > 0 && s.nightPlays / s.totalPlays > 0.3,
  },

  // ── 19 ── The Sun ─────────────────────────────────────────────────────────
  {
    id: 19,
    key: "theSun",
    name: "The Sun",
    folder: "19_theSun",
    file: "19_theSun_5x.png",
    mysticTitle: "The Radiant Energy",
    gamingStats: {
      tempo: 92,
      variety: 75,
      obscurity: 28,
      mysticism: 55,
    },
    questDescription:
      "Radiate full-spectrum warmth. Afternoon and evening plays combined must exceed 70% of your total listening.",
    uprightMeaning:
      "You are a solar-powered listener. Afternoon and evening are the hours of presence, socialisation, and shared experience — and your playlist lives there. The Sun says: your music is alive in the world, not hidden in the shadows. It is warm, visible, and unapologetically bright.",
    reversedMeaning:
      "Brightness without depth can bleach. The Sun reversed gently asks: in all that daylight listening, is there space for shadow? The full spectrum requires both. Even the most radiant playlist earns depth from moments of contrast.",
    loreDescription:
      "The Solar Stage. A joyful pixel child rides a white horse under a massive radiant sun whose rays are individual waveforms. Sunflowers with pixel speakers for faces turn toward the music. The sun's face is a wide grin and an album cover simultaneously. It is mid-afternoon. The play count is still rising.",
    trigger: (s) =>
      s.totalPlays > 0 &&
      (s.afternoonPlays + s.eveningPlays) / s.totalPlays > 0.7,
  },

  // ── 20 ── Judgement ───────────────────────────────────────────────────────
  {
    id: 20,
    key: "judgement",
    name: "Judgement",
    folder: "20_judgement",
    file: "20_judgement_5x.png",
    mysticTitle: "The Critical Curator",
    gamingStats: {
      tempo: 48,
      variety: 12,
      obscurity: 55,
      mysticism: 82,
    },
    questDescription:
      "Edit with severity. Listen to 5 or fewer unique artists with over 20 total plays — a tightly curated sonic identity.",
    uprightMeaning:
      "You have answered the call — and only let five voices through the gate. Judgement is not about limiting yourself; it is about knowing yourself so precisely that only a handful of artists are worthy of your continued time. This is not restriction. This is refinement at its highest form.",
    reversedMeaning:
      "Discernment hardened into gatekeeping. Judgement reversed challenges you: is your tight roster the result of deep love for these five, or a subtle fear of being changed by a sixth? The trumpet calls — but you must choose to rise, not merely to rank.",
    loreDescription:
      "The Final Audit. An angel blasts a pixel trumpet above a field of rising artists — but only five emerge from the graves of the discarded library. They ascend, arms raised, into a verified playlist in the sky. The rest remain below, unplayed. The angel's scoreboard: 5/∞. APPROVED.",
    trigger: (s) => s.uniqueArtists <= 5 && s.totalPlays > 20,
  },

  // ── 21 ── The World ───────────────────────────────────────────────────────
  {
    id: 21,
    key: "theWorld",
    name: "The World",
    folder: "21_theWorld",
    file: "21_theWorld_5x.png",
    mysticTitle: "The Cosmic Archive",
    gamingStats: {
      tempo: 70,
      variety: 100,
      obscurity: 70,
      mysticism: 100,
    },
    questDescription:
      "Complete the cycle. Amass a library of more than 100 unique tracks — the full breadth of a musical cosmos.",
    uprightMeaning:
      "You have circled the globe of sound. One hundred unique tracks is not a number — it is a testament. You have danced through genres, lingered in decades, whispered across languages. The World does not end here. It hands you the next empty globe and says: again.",
    reversedMeaning:
      "A completed world with nowhere to go. The World reversed cautions against treating 100 tracks as a destination rather than a waypoint. Completion is beautiful — but if it turns to hoarding, the archive becomes a museum. Keep the door open. Keep the door facing outward.",
    loreDescription:
      "The Archive Cosmos. A pixel dancer in the centre of an ouroboros wreath made of interlocked album covers, suspended in space. Four corner beings — Fire, Air, Water, Earth — each hold a different genre flag, blessing the collection. The dancer holds a wand that trails a waveform comet. Behind them: 100 lit stars. Every one, a track played.",
    trigger: (s) => s.uniqueTracks > 100,
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// evaluateUnlockedCards — Merge triggers with persisted Fate Book history
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Evaluates which tarot cards are currently unlocked, merging live trigger
 * results with any previously unlocked cards stored in localStorage.
 *
 * Once a card has been unlocked it remains in the Fate Book permanently —
 * a card is never "re-locked" even if the listener's stats change.
 *
 * @param {Object} stats - Play-history statistics object. Expected fields:
 *   totalPlays, uniqueTracks, uniqueArtists, ratio, topTrackCount,
 *   topArtistPlays, secondArtistPlays, hoursListened, minutesListened,
 *   totalDurationSecs, averageTrackDuration, firstTrackPlayedCount,
 *   tasteShiftDetected, durationVarianceScore,
 *   morningPlays, afternoonPlays, eveningPlays, nightPlays
 *
 * @returns {{ unlockedCards: Object[], allCards: Object[] }}
 *   unlockedCards — array of unlocked TAROT_PROFILES entries (with `unlocked: true`).
 *   allCards      — full array of all 22 cards, each annotated with `unlocked` boolean.
 */
function evaluateUnlockedCards(stats) {
  const STORAGE_KEY = "stats-fate-unlocked-tarot";

  // ── 1. Load previously persisted unlocked card IDs from localStorage ──────
  let persistedIds = new Set();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        parsed.forEach((id) => persistedIds.add(Number(id)));
      }
    }
  } catch (err) {
    // localStorage unavailable or data corrupted — proceed with empty set.
    console.warn("[Fate Book] Could not read persisted tarot data:", err);
  }

  // ── 2. Evaluate live triggers against current stats ───────────────────────
  const newlyUnlockedIds = new Set();
  TAROT_PROFILES.forEach((card) => {
    try {
      if (card.trigger(stats)) {
        newlyUnlockedIds.add(card.id);
      }
    } catch (triggerErr) {
      // Defensive: if stats fields are missing, trigger silently fails.
      console.warn(
        `[Fate Book] Trigger error for card "${card.name}":`,
        triggerErr
      );
    }
  });

  // ── 3. Merge — union of persisted + newly triggered ───────────────────────
  const allUnlockedIds = new Set([...persistedIds, ...newlyUnlockedIds]);

  // ── 4. Persist the updated set back to localStorage ───────────────────────
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify([...allUnlockedIds])
    );
  } catch (err) {
    console.warn("[Fate Book] Could not persist tarot unlock data:", err);
  }

  // ── 5. Annotate all cards and build result arrays ─────────────────────────
  const allCards = TAROT_PROFILES.map((card) => ({
    ...card,
    unlocked: allUnlockedIds.has(card.id),
  }));

  const unlockedCards = allCards.filter((card) => card.unlocked);

  return { unlockedCards, allCards };
}

// ─────────────────────────────────────────────────────────────────────────────
// Exports
// ─────────────────────────────────────────────────────────────────────────────

export { TAROT_PROFILES, evaluateUnlockedCards };
