// Three AI chatrooms with DIFFERENT permission matrices, a seeded transcript in each
// (the Strength room's transcript shows the answer difference before/after a category
// is granted), a rolling summary, saved memory units (shareable/pinned), a cross-room
// memory grant, and per-room file access. Demonstrates the whole AI data-governance
// story without needing a live LLM key.
import { rid, TODAY, addDays, atTime } from '../util.ts'

type Row = Record<string, unknown>
export interface BuiltChat {
  chatrooms: Row[]; chat_messages: Row[]; chatroom_summaries: Row[]
  chatroom_memories: Row[]; chatroom_memory_access: Row[]; chatroom_file_access: Row[]
}

export function buildChatrooms(fileIds: Record<string, string>): BuiltChat {
  const strength = rid(); const nutrition = rid(); const rehab = rid()
  const chatrooms: Row[] = [
    { id: strength, name: '力量教练 Strength Coach', topic: '力量进步、动作与计划', sort_order: 0, provider: null, model: null, created_at: atTime(addDays(TODAY, -20), 9), perms: { profile_min: true, training: true, injuries: true, basics: true } },
    { id: nutrition, name: '营养顾问 Nutrition', topic: '饮食、补剂与体重管理', sort_order: 1, provider: null, model: null, created_at: atTime(addDays(TODAY, -14), 9), perms: { food: true, supplements: true, basics: true, profile_min: true } },
    { id: rehab, name: '康复顾问 Rehab / Physio', topic: '伤病康复与运动安全', sort_order: 2, provider: null, model: null, created_at: atTime(addDays(TODAY, -10), 9), perms: { injuries: true, medical: true, training: true } },
  ]

  const msgs: Row[] = []
  let seq = 0
  const msg = (room: string, role: string, content: string, daysAgo: number, hour: number) =>
    msgs.push({ id: rid(), chatroom_id: room, role, content, created_at: atTime(addDays(TODAY, -daysAgo), hour, seq++ % 60), updated_at: atTime(addDays(TODAY, -daysAgo), hour, seq % 60) })

  // Strength room — the permission ON/OFF difference, told through the transcript.
  msg(strength, 'user', '我的卧推最近怎么样?', 20, 9)
  msg(strength, 'assistant', '我现在还看不到你的训练记录——这个聊天室的「训练记录」权限没有开启,所以我无法读取具体数据。你可以在右上角的权限条打开它,我就能分析你的卧推进展了。', 20, 9)
  msg(strength, 'user', '开好了,你再看看', 19, 9)
  msg(strength, 'assistant', '收到,现在能看到了。你的卧推从计划初期的 60kg 稳步提升,最近两周的顶组已到 ~70kg 并创下新高(PR)。建议:下放放慢到 2 秒离心,肩胛后缩夹紧;下一步用 5×5 冲一冲 72.5kg。注意右肩过顶动作先热身。', 19, 9)
  msg(strength, 'user', '深蹲呢?', 5, 20)
  msg(strength, 'assistant', '深蹲同样在进步,顶组接近 100kg,深度和节奏都不错。下肢日可以保留保加利亚分腿蹲改善左右差。', 5, 20)

  // Nutrition room — uses food + supplements + basics.
  msg(nutrition, 'user', '我训练日的饮食够不够?', 12, 13)
  msg(nutrition, 'assistant', '从你的饮食记录看,训练日蛋白基本达标(约 1.8g/kg),碳水略偏低。训练日可以再加 ~50g 碳水(如多半碗米饭或一根香蕉)支撑训练量。补剂方面肌酸 5g/日很稳,继续保持。', 12, 13)
  msg(nutrition, 'user', '减脂期蛋白要加吗?', 4, 21)
  msg(nutrition, 'assistant', '减脂期建议蛋白提到 2.0–2.2g/kg 以保住肌肉,同时优先保留力量训练强度。你目前体重下降平稳,方向是对的。', 4, 21)

  // Rehab room — injuries + medical (high-sensitivity, granted here only).
  msg(rehab, 'user', '右肩还有点撞击感,推举怎么练比较安全?', 8, 18)
  msg(rehab, 'assistant', '根据你的伤病与医疗记录:右肩撞击、过顶弧内疼痛。建议过顶推举充分热身,先做肩胛俯卧撑和弹力带外旋激活;疼痛弧内减量,用中立握距的哑铃肩推替代杠铃。膝盖不适时用西班牙深蹲做等长负荷。', 8, 18)
  msg(rehab, 'user', '踝关节可以开始跑了吗?', 3, 18)
  msg(rehab, 'assistant', '你的左踝扭伤已进入「逐步复训」,近期疼痛评分降到 2/10 且慢跑无痛,可以从直线慢跑开始,避免急停变向;继续踝字母操和单腿提踵巩固本体感觉。', 3, 18)

  const summaries: Row[] = [
    { id: rid(), chatroom_id: strength, content: '用户以力量进步为主要目标(卧推年底 100kg)。卧推 60→70kg 创 PR,深蹲近 100kg。教练建议:放慢离心、加强肩胛后缩、注意右肩热身。', covered_through: atTime(addDays(TODAY, -5), 20) },
    { id: rid(), chatroom_id: nutrition, content: '训练日蛋白达标、碳水偏低,建议 +50g 碳水;减脂期蛋白提到 2.0–2.2g/kg。肌酸 5g/日。', covered_through: atTime(addDays(TODAY, -4), 21) },
    { id: rid(), chatroom_id: rehab, content: '右肩撞击(康复训练中):过顶先热身、疼痛弧减量、哑铃替代杠铃。左踝扭伤(逐步复训):可直线慢跑,继续本体感觉训练。', covered_through: atTime(addDays(TODAY, -3), 18) },
  ]

  const memories: Row[] = [
    { id: rid(), chatroom_id: strength, content: '卧推目标:年底 100kg;技术要点:2 秒离心 + 肩胛后缩。', shareable: true, pinned: true, created_at: atTime(addDays(TODAY, -19), 9) },
    { id: rid(), chatroom_id: strength, content: '右肩过顶动作训练前必须充分热身,避免撞击复发。', shareable: true, pinned: false, created_at: atTime(addDays(TODAY, -8), 18) },
    { id: rid(), chatroom_id: nutrition, content: '训练日在正常饮食基础上 +50g 碳水。', shareable: true, pinned: false, created_at: atTime(addDays(TODAY, -12), 13) },
    { id: rid(), chatroom_id: rehab, content: '膝盖不适时用西班牙深蹲(等长)替代常规深蹲。', shareable: true, pinned: true, created_at: atTime(addDays(TODAY, -8), 18) },
  ]

  // Cross-room memory grants: Rehab and Nutrition may READ the Strength room's
  // shareable memory (goals/technique) — never its raw data or full chat.
  const memory_access: Row[] = [
    { id: rid(), reader_room_id: rehab, source_room_id: strength },
    { id: rid(), reader_room_id: nutrition, source_room_id: strength },
  ]

  // Per-room file access.
  const file_access: Row[] = [
    { id: rid(), chatroom_id: strength, file_id: fileIds.plan },
    { id: rid(), chatroom_id: strength, file_id: fileIds.coach },
    { id: rid(), chatroom_id: nutrition, file_id: fileIds.plan },
    { id: rid(), chatroom_id: rehab, file_id: fileIds.labs },
  ]

  return {
    chatrooms, chat_messages: msgs, chatroom_summaries: summaries,
    chatroom_memories: memories, chatroom_memory_access: memory_access, chatroom_file_access: file_access,
  }
}
