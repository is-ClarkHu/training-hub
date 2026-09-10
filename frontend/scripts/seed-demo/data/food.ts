// Food log: ~10 meals over the last two weeks. Each carries the user's own note
// (description) AND a seeded AI recognition+nutrition result (ai_description) in the
// exact 4-line format the vision backend emits, so the History/Data food views and
// the "AI recognized" state are populated. Most have a colour placeholder photo.
import { rid, TODAY, addDays, atTime, UID_TOKEN, type Asset } from '../util.ts'
import { solidPng } from '../png.ts'

type Row = Record<string, unknown>
export interface BuiltFood { food_log: Row[]; assets: Asset[] }

interface Meal { daysAgo: number; hour: number; desc: string; ai: string; color?: [number, number, number] }
const MEALS: Meal[] = [
  { daysAgo: 0, hour: 8, desc: 'Oatmeal + blueberries + 2 boiled eggs + black coffee', ai: 'Foods: bowl of oatmeal, handful of blueberries, two boiled eggs, black coffee\nCalories: ~420 kcal\nProtein / Carbs / Fat: ~24g / 48g / 14g\nNote: solid protein to open the day, carbs moderate — good for a training day.', color: [214, 190, 145] },
  { daysAgo: 0, hour: 13, desc: 'Beef rice bowl + broccoli', ai: 'Foods: beef rice bowl, small side of broccoli\nCalories: ~780 kcal\nProtein / Carbs / Fat: ~42g / 90g / 24g\nNote: good post-training carb refeed; could use more greens.', color: [176, 120, 74] },
  { daysAgo: 1, hour: 19, desc: 'Ribeye + asparagus + sweet potato', ai: 'Foods: ribeye steak (~220g), asparagus, roasted sweet potato\nCalories: ~850 kcal\nProtein / Carbs / Fat: ~55g / 55g / 42g\nNote: plenty of protein; fat runs high but the meal is balanced overall.', color: [150, 80, 66] },
  { daysAgo: 2, hour: 8, desc: 'Whole-wheat sandwich (chicken + avocado) + latte', ai: 'Foods: whole-wheat chicken and avocado sandwich, one latte\nCalories: ~520 kcal\nProtein / Carbs / Fat: ~30g / 48g / 22g\nNote: good fats from the avocado; could stand another protein source.', color: [198, 176, 120] },
  { daysAgo: 3, hour: 13, desc: 'Chicken breast stir-fried with onion + bowl of noodles', ai: 'Foods: chicken breast stir-fried with onion, bowl of hand-cut noodles\nCalories: ~720 kcal\nProtein / Carbs / Fat: ~46g / 88g / 18g\nNote: high carb and high protein — suits a heavy training day.', color: [205, 160, 90] },
  { daysAgo: 4, hour: 20, desc: 'Salmon + quinoa salad', ai: 'Foods: pan-seared salmon fillet, quinoa and vegetable salad\nCalories: ~610 kcal\nProtein / Carbs / Fat: ~40g / 42g / 30g\nNote: plenty of omega-3 and fibre — an ideal rest-day meal.', color: [206, 128, 108] },
  { daysAgo: 6, hour: 12, desc: 'Chipotle chicken bowl (double protein)', ai: 'Foods: chicken burrito bowl, brown rice, black beans, double chicken\nCalories: ~820 kcal\nProtein / Carbs / Fat: ~62g / 78g / 24g\nNote: high-protein and balanced; a solid post-lift meal.', color: [160, 120, 80] },
  { daysAgo: 7, hour: 8, desc: 'Protein shake + banana', ai: 'Foods: one scoop whey, milk, one banana\nCalories: ~350 kcal\nProtein / Carbs / Fat: ~30g / 40g / 6g\nNote: fast protein and carbs — works before or after training.' },
  { daysAgo: 9, hour: 19, desc: 'Hot pot (clear broth — beef, shrimp paste, vegetables)', ai: 'Foods: clear-broth hot pot with sliced beef, shrimp paste, mushrooms and vegetables\nCalories: ~900 kcal (estimate)\nProtein / Carbs / Fat: ~60g / 40g / 45g\nNote: protein-rich; watch the sodium and fat in the dipping sauce and processed meats.', color: [200, 90, 80] },
  { daysAgo: 11, hour: 13, desc: 'Meal-prep box: chicken breast + brown rice', ai: 'Foods: pan-seared chicken breast, brown rice, seasonal vegetables\nCalories: ~560 kcal\nProtein / Carbs / Fat: ~45g / 60g / 12g\nNote: classic meal prep — clean macro split.', color: [190, 165, 110] },
]

export function buildFood(): BuiltFood {
  const food_log: Row[] = []; const assets: Asset[] = []
  for (const m of MEALS) {
    const id = rid()
    const d = addDays(TODAY, -m.daysAgo)
    let photo_path: string | null = null
    if (m.color) {
      photo_path = `${UID_TOKEN}/${id}.png`
      assets.push({ bucket: 'food-photos', path: photo_path, body: solidPng(64, 48, m.color), contentType: 'image/png' })
    }
    food_log.push({ id, description: m.desc, ai_description: m.ai, photo_path, eaten_at: atTime(d, m.hour) })
  }
  return { food_log, assets }
}
