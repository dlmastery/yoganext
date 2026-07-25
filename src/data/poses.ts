/**
 * poses.ts — named yoga sequences.
 *
 * Each sequence is an ordered `Pose[]`; `seconds` is the hold, so the sum of a
 * sequence is roughly its practice length (minus the transitions, which are
 * cued in the practice script rather than modelled here).
 *
 * The `cue` field is the whole value of this file. A cue must be something a
 * teacher would actually say in the room — one specific, checkable instruction,
 * usually about where the effort *isn't* supposed to be. "Relax and breathe" is
 * not a cue. "Bend the knees until the belly rests on the thighs" is.
 *
 * `glyph` is a single short token the pose illustration renders; keep it to one
 * or two characters so it fits the small card.
 */

import type { Pose } from '../lib/types.ts';

// ───────────────────────────────────────────────────── sun salutation A ──

/** Surya Namaskar A — the classical ten-count round. ~2:15 per round. */
export const SUN_SALUTATION_A: Pose[] = [
  {
    id: 'sun-a-tadasana',
    name: 'Mountain',
    sanskrit: 'Tadasana',
    seconds: 20,
    cue: 'Feet hip-width, weight even across both heels and both big toes. Let the arms hang until the shoulders stop asking to be somewhere.',
    glyph: '🧍',
  },
  {
    id: 'sun-a-urdhva-hastasana',
    name: 'Upward Salute',
    sanskrit: 'Urdhva Hastasana',
    seconds: 12,
    cue: 'Reach up without letting the front ribs pop forward — draw them down first, and the length arrives in the upper back instead of the low back.',
    glyph: '🙆',
  },
  {
    id: 'sun-a-uttanasana',
    name: 'Standing Forward Fold',
    sanskrit: 'Uttanasana',
    seconds: 20,
    cue: 'Bend the knees generously. This is a spine release first and a hamstring stretch only by accident; let the head be heavy.',
    glyph: '🙇',
  },
  {
    id: 'sun-a-ardha-uttanasana',
    name: 'Half Lift',
    sanskrit: 'Ardha Uttanasana',
    seconds: 10,
    cue: 'Fingertips to shins, chest forward. Lengthen from the crown of the head — if you lift the chin to do it, you have gone too far.',
    glyph: '📐',
  },
  {
    id: 'sun-a-phalakasana',
    name: 'Plank',
    sanskrit: 'Phalakasana',
    seconds: 20,
    cue: 'Push the floor away so the space between the shoulder blades domes slightly. Ribs down, tailbone heavy, heels reaching back.',
    glyph: '▬',
  },
  {
    id: 'sun-a-chaturanga',
    name: 'Low Plank',
    sanskrit: 'Chaturanga Dandasana',
    seconds: 8,
    cue: 'Elbows brush the ribs and stop at ninety degrees — no lower. Knees down is the strong version of this pose, not the lesser one.',
    glyph: '⬓',
  },
  {
    id: 'sun-a-urdhva-mukha',
    name: 'Upward Facing Dog',
    sanskrit: 'Urdhva Mukha Svanasana',
    seconds: 15,
    cue: 'Press the hands down and slightly back so the chest travels forward through the arms. Shoulders away from the ears, thighs lifted off the mat.',
    glyph: '🐕',
  },
  {
    id: 'sun-a-adho-mukha',
    name: 'Downward Facing Dog',
    sanskrit: 'Adho Mukha Svanasana',
    seconds: 40,
    cue: 'Bend the knees a lot and lift the sitting bones to the ceiling. Length in the spine beats straight legs, every single time.',
    glyph: '⛰',
  },
  {
    id: 'sun-a-uttanasana-return',
    name: 'Forward Fold, Return',
    sanskrit: 'Uttanasana',
    seconds: 15,
    cue: 'Walk or step the feet to the hands and let everything above the hips give up for a moment. Sway a little if it helps.',
    glyph: '🙇',
  },
  {
    id: 'sun-a-tadasana-close',
    name: 'Mountain, Again',
    sanskrit: 'Tadasana',
    seconds: 20,
    cue: 'Rise with a flat back, arms overhead, then hands to the heart. Stand still long enough to notice you are not quite who you were two minutes ago.',
    glyph: '🧍',
  },
];

// ─────────────────────────────────────────────────────── gentle spine ──

/** A slow, floor-based flow for a back that has been in a chair too long. */
export const GENTLE_SPINE_FLOW: Pose[] = [
  {
    id: 'spine-child',
    name: "Child's Pose",
    sanskrit: 'Balasana',
    seconds: 75,
    cue: 'Knees as wide as the mat, big toes touching, forehead down. If the hips do not reach the heels, put a cushion between them and stop negotiating.',
    glyph: '🧎',
  },
  {
    id: 'spine-cat-cow',
    name: 'Cat and Cow',
    sanskrit: 'Marjaryasana Bitilasana',
    seconds: 90,
    cue: 'Move one vertebra at a time — tailbone first on the way up, tailbone first on the way down. Let the breath set the speed, not the other way round.',
    glyph: '🐈',
  },
  {
    id: 'spine-thread-needle',
    name: 'Thread the Needle',
    sanskrit: 'Parsva Balasana',
    seconds: 100,
    cue: 'Slide one arm under the other and let the outer shoulder rest on the mat. Keep the hips stacked over the knees so the twist stays in the upper back.',
    glyph: '🧵',
  },
  {
    id: 'spine-sphinx',
    name: 'Sphinx',
    sanskrit: 'Salamba Bhujangasana',
    seconds: 80,
    cue: 'Elbows under the shoulders, forearms parallel. Drag the elbows back toward your hips without moving them — the chest opens, the low back stays quiet.',
    glyph: '🐊',
  },
  {
    id: 'spine-supine-twist',
    name: 'Supine Twist',
    sanskrit: 'Supta Matsyendrasana',
    seconds: 120,
    cue: 'Knees fall to one side, arms wide. If the top shoulder lifts off the floor, stack a cushion under the knees rather than forcing the shoulder down.',
    glyph: '🌀',
  },
  {
    id: 'spine-bridge',
    name: 'Bridge',
    sanskrit: 'Setu Bandha Sarvangasana',
    seconds: 70,
    cue: 'Feet parallel and hip-width, press through the heels. Lift from the back of the thighs — the glutes work, the low back should not be the one shouting.',
    glyph: '🌉',
  },
  {
    id: 'spine-knees-chest',
    name: 'Knees to Chest',
    sanskrit: 'Apanasana',
    seconds: 60,
    cue: 'Hug the knees in, then rock gently side to side. This is a small massage for the low back, not a stretch — very little effort required.',
    glyph: '🫂',
  },
];

// ──────────────────────────────────────────────────────── hip opening ──

/** Long holds. Hips move slowly and resent being hurried. */
export const HIP_OPENING_FLOW: Pose[] = [
  {
    id: 'hips-malasana',
    name: 'Garland Squat',
    sanskrit: 'Malasana',
    seconds: 90,
    cue: 'Heels down if they reach, on a folded blanket if they do not. Elbows press the inner knees wide while the chest stays tall.',
    glyph: '🪷',
  },
  {
    id: 'hips-anjaneyasana',
    name: 'Low Lunge',
    sanskrit: 'Anjaneyasana',
    seconds: 120,
    cue: 'Back knee down, then tuck the tailbone under before you sink. That small tuck is the difference between stretching the hip flexor and squashing the low back.',
    glyph: '🏹',
  },
  {
    id: 'hips-lizard',
    name: 'Lizard',
    sanskrit: 'Utthan Pristhasana',
    seconds: 120,
    cue: 'Front foot outside the hand, back knee down. Come onto forearms or a block only when the breath is still even — if it changes, you have gone too deep.',
    glyph: '🦎',
  },
  {
    id: 'hips-pigeon',
    name: 'Half Pigeon',
    sanskrit: 'Eka Pada Rajakapotasana',
    seconds: 150,
    cue: 'Prop the hip of the front leg on a cushion so the pelvis stays level. An unlevel pelvis turns this into a knee pose, which is not what you came for.',
    glyph: '🕊',
  },
  {
    id: 'hips-figure-four',
    name: 'Reclined Figure Four',
    sanskrit: 'Supta Kapotasana',
    seconds: 120,
    cue: 'Ankle over the opposite thigh, then draw the bottom leg in. Actively press the crossed knee away from you — that is where the sensation actually lives.',
    glyph: '4️⃣',
  },
  {
    id: 'hips-baddha-konasana',
    name: 'Bound Angle',
    sanskrit: 'Baddha Konasana',
    seconds: 120,
    cue: 'Soles together, heels a comfortable distance from the body. Fold from the hip crease, not the waist, and let the knees be wherever they are today.',
    glyph: '🦋',
  },
  {
    id: 'hips-happy-baby',
    name: 'Happy Baby',
    sanskrit: 'Ananda Balasana',
    seconds: 90,
    cue: 'Hold the outer edges of the feet, shins vertical, and press the low back down into the floor. Rock side to side if stillness feels like too much.',
    glyph: '👶',
  },
];

// ──────────────────────────────────────────────────────── sleep wind-down ──

/** Six shapes, all close to the floor, all supported. Nothing here wakes you up. */
export const SLEEP_WIND_DOWN: Pose[] = [
  {
    id: 'sleep-child',
    name: "Child's Pose",
    sanskrit: 'Balasana',
    seconds: 90,
    cue: 'Arms alongside the body rather than reaching forward — reaching is a daytime shape. Turn one cheek to the mat and let the jaw go slack.',
    glyph: '🧎',
  },
  {
    id: 'sleep-paschimottanasana',
    name: 'Seated Forward Fold',
    sanskrit: 'Paschimottanasana',
    seconds: 120,
    cue: 'Sit on the edge of a folded blanket, knees generously bent, and rest your forearms on your shins. There is no destination in this one.',
    glyph: '🌙',
  },
  {
    id: 'sleep-supta-baddha',
    name: 'Reclined Bound Angle',
    sanskrit: 'Supta Baddha Konasana',
    seconds: 150,
    cue: 'Cushions under both outer thighs so the legs are held, not hanging. If the shoulders round forward, add a rolled towel lengthways under the spine.',
    glyph: '🦋',
  },
  {
    id: 'sleep-twist',
    name: 'Supine Twist',
    sanskrit: 'Supta Matsyendrasana',
    seconds: 150,
    cue: 'Ninety seconds each side, knees resting on a cushion. Let the head turn the opposite way only if the neck agrees; it often does not at night.',
    glyph: '🌀',
  },
  {
    id: 'sleep-viparita-karani',
    name: 'Legs Up the Wall',
    sanskrit: 'Viparita Karani',
    seconds: 180,
    cue: 'Hips a hand-span from the wall, not jammed against it. Legs completely passive — if the hamstrings are working, slide further back.',
    glyph: '🧱',
  },
  {
    id: 'sleep-savasana',
    name: 'Final Rest',
    sanskrit: 'Savasana',
    seconds: 150,
    cue: 'Palms up, feet falling open, a small pillow under the knees. Nothing to do now. You are allowed to fall asleep here — this one has no ending.',
    glyph: '🌊',
  },
];

// ───────────────────────────────────────────────────────── desk break ──

/** Five minutes, no mat, no changing clothes, doable in office trousers. */
export const DESK_BREAK_FLOW: Pose[] = [
  {
    id: 'desk-seated-cat-cow',
    name: 'Seated Cat and Cow',
    sanskrit: 'Marjaryasana Bitilasana',
    seconds: 45,
    cue: 'Hands on knees, feet flat. Round and arch from the pelvis, and let the head follow last rather than lead.',
    glyph: '🪑',
  },
  {
    id: 'desk-neck',
    name: 'Ear to Shoulder',
    seconds: 45,
    cue: 'Sit on the hand of the side you are stretching to anchor the shoulder down. Thirty seconds each way; do not pull on your own head.',
    glyph: '👂',
  },
  {
    id: 'desk-wrists',
    name: 'Wrist and Forearm Release',
    seconds: 40,
    cue: 'Fingers pointing back toward you, palms on the desk, lean back a millimetre at a time. Typing forearms are usually far tighter than people expect.',
    glyph: '🤲',
  },
  {
    id: 'desk-twist',
    name: 'Seated Twist',
    sanskrit: 'Ardha Matsyendrasana',
    seconds: 45,
    cue: 'Both sitting bones stay planted. Turn from the base of the ribs and use the chair back to hold, not to crank.',
    glyph: '🌀',
  },
  {
    id: 'desk-chest-opener',
    name: 'Standing Chest Opener',
    seconds: 40,
    cue: 'Hands clasped behind you, knuckles down toward the floor. Lift the chest without dumping the ribs — the stretch belongs across the collarbones.',
    glyph: '🕊',
  },
  {
    id: 'desk-side-bend',
    name: 'Standing Side Bend',
    seconds: 40,
    cue: 'Reach up and over, and press the opposite hip out the other way. Keep both feet quiet on the floor so the length is real.',
    glyph: '🌾',
  },
  {
    id: 'desk-fold',
    name: 'Standing Forward Fold',
    sanskrit: 'Uttanasana',
    seconds: 45,
    cue: 'Knees soft, hold opposite elbows and hang. Ten slow breaths here undoes a surprising amount of an afternoon.',
    glyph: '🙇',
  },
];

/** Every sequence, addressable by name — used by the practice library and tools. */
export const POSE_SEQUENCES: Record<string, Pose[]> = {
  'sun-salutation-a': SUN_SALUTATION_A,
  'gentle-spine-flow': GENTLE_SPINE_FLOW,
  'hip-opening-flow': HIP_OPENING_FLOW,
  'sleep-wind-down': SLEEP_WIND_DOWN,
  'desk-break-flow': DESK_BREAK_FLOW,
};
