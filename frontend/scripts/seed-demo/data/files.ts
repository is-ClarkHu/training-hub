// Three fictional reference files (uploaded to the public-files bucket) with both the
// extracted `content` and an LLM-style `summary`. They're granted to specific AI
// chatrooms (see chatrooms.ts) to demo per-room file access.
import { rid, UID_TOKEN, type Asset } from '../util.ts'

type Row = Record<string, unknown>
export interface BuiltFiles { public_files: Row[]; assets: Asset[]; ids: Record<string, string> }

interface Doc { key: string; name: string; content: string; summary: string }
const DOCS: Doc[] = [
  {
    key: 'plan',
    name: '训练计划-上下肢分化.txt',
    content: [
      '上/下肢分化计划 (8 周)', '',
      'A 上肢: 卧推 4×5、杠铃划船 4×6、哑铃肩推 3×8、高位下拉 3×10、锤式弯举 3×12、仰卧臂屈伸 3×12',
      'B 下肢: 深蹲 4×5、罗马尼亚硬拉 3×6、保加利亚分腿蹲 3×10/侧、腿弯举 3×12、提踵 4×15、悬垂举腿 3×12',
      'C 全身+有氧: 硬拉 3×5、站姿推举 3×6、引体向上 4×AMRAP、绳索卷腹 3×15、跑步机 25min',
      '', '进阶: 每周主项 +2.5kg,力竭时降 1 组次数。每 4 周 deload 一周。',
      '注意: 右肩过顶动作先热身;膝盖不适时用西班牙深蹲替代。',
    ].join('\n'),
    summary: '8 周上/下肢分化(A 上肢/B 下肢/C 全身+有氧)。主项线性 +2.5kg/周,每 4 周 deload。含肩、膝的伤病注意事项。',
  },
  {
    key: 'coach',
    name: '教练反馈-2026Q2.txt',
    content: [
      '教练季度反馈 (2026 Q2)', '',
      '优点: 深蹲深度与节奏改善明显;硬拉背部保持中立。',
      '待改进: 卧推下放过快,建议 2 秒离心;肩胛后缩不足。',
      '目标: 卧推年底 100kg;增加单侧下肢训练改善左右差。',
      '饮食: 训练日碳水可再加 50g;蛋白维持 1.8g/kg。',
    ].join('\n'),
    summary: '教练反馈:深蹲/硬拉技术进步;卧推需放慢离心、加强肩胛后缩。目标卧推 100kg,补单侧下肢。训练日加碳,蛋白 1.8g/kg。',
  },
  {
    key: 'labs',
    name: '体检摘要.txt',
    content: [
      '年度体检摘要', '',
      '身高 178cm 体重 76kg BMI 24.0 静息心率 56',
      '血压 118/74 血脂正常 空腹血糖 5.1 mmol/L',
      '维生素 D 略低(已补充);其余指标正常。',
      '建议: 保持有氧,继续补充维 D,春季注意过敏。',
    ].join('\n'),
    summary: '体检正常:血压 118/74、血脂/血糖正常、静息心率 56;维生素 D 略低(已补)。建议保持有氧、注意季节性过敏。',
  },
]

export function buildFiles(): BuiltFiles {
  const public_files: Row[] = []; const assets: Asset[] = []; const ids: Record<string, string> = {}
  for (const doc of DOCS) {
    const id = rid(); ids[doc.key] = id
    const storage_path = `${UID_TOKEN}/${id}.txt`
    assets.push({ bucket: 'public-files', path: storage_path, body: doc.content, contentType: 'text/plain; charset=utf-8' })
    public_files.push({ id, name: doc.name, storage_path, content: doc.content, summary: doc.summary })
  }
  return { public_files, assets, ids }
}
