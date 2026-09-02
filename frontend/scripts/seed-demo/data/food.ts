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
  { daysAgo: 0, hour: 8, desc: '燕麦 + 蓝莓 + 两个水煮蛋 + 黑咖啡', ai: '食物: 燕麦一碗、蓝莓一把、水煮蛋两个、黑咖啡\n热量: 约 420 kcal\n蛋白/碳水/脂肪: 约 24g / 48g / 14g\n点评: 早餐蛋白到位,碳水适中,适合训练日。', color: [214, 190, 145] },
  { daysAgo: 0, hour: 13, desc: '牛肉盖饭 + 西兰花', ai: '食物: 牛肉盖饭一份、西兰花一小碗\n热量: 约 780 kcal\n蛋白/碳水/脂肪: 约 42g / 90g / 24g\n点评: 训练后补碳合适,可再加点绿叶菜。', color: [176, 120, 74] },
  { daysAgo: 1, hour: 19, desc: 'ribeye 一块 + 芦笋 + 红薯', ai: '食物: 肋眼牛排一块(约 220g)、芦笋一份、烤红薯一个\n热量: 约 850 kcal\n蛋白/碳水/脂肪: 约 55g / 55g / 42g\n点评: 蛋白充足,脂肪偏高但整体均衡。', color: [150, 80, 66] },
  { daysAgo: 2, hour: 8, desc: '全麦三明治(鸡胸+牛油果)+ 拿铁', ai: '食物: 全麦鸡胸牛油果三明治、拿铁一杯\n热量: 约 520 kcal\n蛋白/碳水/脂肪: 约 30g / 48g / 22g\n点评: 优质脂肪来自牛油果,蛋白可再加一份。', color: [198, 176, 120] },
  { daysAgo: 3, hour: 13, desc: '洋葱炒鸡胸一盘 + 刀削面一碗', ai: '食物: 洋葱炒鸡胸一盘、刀削面一碗\n热量: 约 720 kcal\n蛋白/碳水/脂肪: 约 46g / 88g / 18g\n点评: 高碳高蛋白,适合大训练量日。', color: [205, 160, 90] },
  { daysAgo: 4, hour: 20, desc: '三文鱼 + 藜麦沙拉', ai: '食物: 煎三文鱼一块、藜麦蔬菜沙拉\n热量: 约 610 kcal\n蛋白/碳水/脂肪: 约 40g / 42g / 30g\n点评: Omega-3 与纤维充足,休息日理想选择。', color: [206, 128, 108] },
  { daysAgo: 6, hour: 12, desc: 'Chipotle chicken bowl (double protein)', ai: 'Foods: chicken burrito bowl, brown rice, black beans, double chicken\nCalories: ~820 kcal\nProtein / Carbs / Fat: ~62g / 78g / 24g\nNote: high-protein and balanced; a solid post-lift meal.', color: [160, 120, 80] },
  { daysAgo: 7, hour: 8, desc: '蛋白粉奶昔 + 香蕉', ai: '食物: 乳清蛋白一勺、牛奶、香蕉一根\n热量: 约 350 kcal\n蛋白/碳水/脂肪: 约 30g / 40g / 6g\n点评: 快速蛋白+碳水,适合训练前后。' },
  { daysAgo: 9, hour: 19, desc: '火锅(清汤,涮牛肉/虾滑/蔬菜)', ai: '食物: 清汤火锅,涮牛肉、虾滑、菌菇与蔬菜\n热量: 约 900 kcal(估)\n蛋白/碳水/脂肪: 约 60g / 40g / 45g\n点评: 蛋白丰富,注意蘸料和加工肉的钠与脂肪。', color: [200, 90, 80] },
  { daysAgo: 11, hour: 13, desc: '鸡胸糙米便当', ai: '食物: 香煎鸡胸、糙米饭、时蔬\n热量: 约 560 kcal\n蛋白/碳水/脂肪: 约 45g / 60g / 12g\n点评: 经典备餐,宏量比例干净。', color: [190, 165, 110] },
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
