// Five AI chatrooms with DIFFERENT permission matrices, a seeded transcript in each
// (the Strength room's transcript shows the answer difference before/after a category
// is granted), a rolling summary, saved memory units (shareable/pinned), cross-room
// memory grants, and per-room file access. Demonstrates the whole AI data-governance
// story without needing a live LLM key.
//
// Language: the demo is aimed at English speakers, so four rooms are English. The
// fifth (中文教练) is deliberately Chinese — the app is bilingual, and one Chinese
// room shows the same assistant working in the other language.
import { rid, TODAY, addDays, atTime } from '../util.ts'

type Row = Record<string, unknown>
export interface BuiltChat {
  chatrooms: Row[]; chat_messages: Row[]; chatroom_summaries: Row[]
  chatroom_memories: Row[]; chatroom_memory_access: Row[]; chatroom_file_access: Row[]
}

export function buildChatrooms(fileIds: Record<string, string>): BuiltChat {
  const strength = rid(); const nutrition = rid(); const rehab = rid()
  const program = rid(); const chinese = rid()
  const chatrooms: Row[] = [
    { id: strength, name: 'Strength Coach', topic: 'Strength progress, technique and programming', sort_order: 0, provider: null, model: null, created_at: atTime(addDays(TODAY, -20), 9), perms: { profile_min: true, training: true, injuries: true, basics: true } },
    { id: nutrition, name: 'Nutrition', topic: 'Diet, supplements and weight management', sort_order: 1, provider: null, model: null, created_at: atTime(addDays(TODAY, -14), 9), perms: { food: true, supplements: true, basics: true, profile_min: true } },
    { id: rehab, name: 'Rehab / Physio', topic: 'Injury rehab and training safely around it', sort_order: 2, provider: null, model: null, created_at: atTime(addDays(TODAY, -10), 9), perms: { injuries: true, medical: true, training: true } },
    { id: program, name: 'Program Review', topic: 'Reads the uploaded plan and coach feedback — no health data', sort_order: 3, provider: null, model: null, created_at: atTime(addDays(TODAY, -6), 9), perms: { training: true, profile_min: true } },
    { id: chinese, name: '中文教练', topic: '中文训练问答 — 同一个助手,另一种语言', sort_order: 4, provider: null, model: null, created_at: atTime(addDays(TODAY, -2), 9), perms: { training: true, basics: true, profile_min: true } },
  ]

  const msgs: Row[] = []
  let seq = 0
  const msg = (room: string, role: string, content: string, daysAgo: number, hour: number) =>
    msgs.push({ id: rid(), chatroom_id: room, role, content, created_at: atTime(addDays(TODAY, -daysAgo), hour, seq++ % 60), updated_at: atTime(addDays(TODAY, -daysAgo), hour, seq % 60) })

  // Strength room — the permission ON/OFF difference, told through the transcript.
  // This is the one room with two exchanges: the first answer is what the assistant
  // says WITHOUT the training permission, the second is after it was granted.
  msg(strength, 'user', 'How has my bench press been going lately?', 20, 9)
  msg(strength, 'assistant', "I can't see your training log yet — this room doesn't have the Training permission turned on, so I have no access to the actual numbers. Flip it on in the permission bar at the top right and I'll break down your bench progression.", 20, 9)
  msg(strength, 'user', "Turned it on — take a look.", 19, 9)
  msg(strength, 'assistant', 'Got it, I can see the data now. Your bench has climbed steadily from 60kg early in the block to a ~70kg top set in the last two weeks, which is a new PR. Suggestions: slow the descent to a 2s eccentric and keep the shoulder blades pinned back. Next step, push 72.5kg for 5×5. Warm the right shoulder up first on overhead days.', 19, 9)

  // Nutrition room — food + supplements + basics.
  msg(nutrition, 'user', 'Am I eating enough on training days?', 12, 13)
  msg(nutrition, 'assistant', "From your food log, protein is on target on training days (about 1.8g/kg) but carbs run a little low. Add roughly 50g of carbs on lifting days — an extra half bowl of rice or a banana — to support the volume. Creatine at 5g daily looks consistent; keep that going.", 12, 13)

  // Rehab room — injuries + medical (high-sensitivity, granted here only).
  msg(rehab, 'user', 'My right shoulder still pinches. How do I press safely?', 8, 18)
  msg(rehab, 'assistant', 'Based on your injury and medical records — right-shoulder impingement, pain through the overhead arc: warm up thoroughly before overhead pressing, and prime it with scapular push-ups and band external rotations. Reduce load inside the painful arc and swap the barbell for neutral-grip dumbbell presses. When the knee is bothering you, use Spanish squats for isometric loading instead.', 8, 18)

  // Program Review — no health data at all; its value comes from the granted files.
  msg(program, 'user', 'Does my current plan match what my coach asked for?', 5, 11)
  msg(program, 'assistant', "Comparing your uploaded plan with the Q2 coach feedback: the coach asked for a slower bench eccentric and more unilateral lower-body work. Your plan does include Bulgarian split squats on day B, so the unilateral piece is covered. Tempo isn't written anywhere in the plan, though — worth adding '2s down' next to the bench so it actually gets trained. Note that this room can read your plan and training log, but has no access to injury, medical or food data.", 5, 11)

  // 中文房间 — 同样的助手,中文对话。
  msg(chinese, 'user', '深蹲最近怎么样?下一步该怎么练?', 2, 20)
  msg(chinese, 'assistant', '你的深蹲一直在稳步进步,顶组已经接近 100kg,深度和节奏都不错。下一步建议:下肢日保留保加利亚分腿蹲,改善左右腿的力量差;主项每周加 2.5kg,力竭时降一次次数。膝盖有不适的时候用西班牙深蹲做等长负荷替代。', 2, 20)

  const summaries: Row[] = [
    { id: rid(), chatroom_id: strength, content: 'Main goal is strength progression (100kg bench by year end). Bench went 60→70kg with a new PR; squat approaching 100kg. Coaching cues: slower eccentric, scapular retraction, warm the right shoulder up first.', covered_through: atTime(addDays(TODAY, -19), 9) },
    { id: rid(), chatroom_id: nutrition, content: 'Protein on target on training days, carbs slightly low — add ~50g on lifting days. In a cut, push protein to 2.0–2.2g/kg. Creatine 5g daily.', covered_through: atTime(addDays(TODAY, -12), 13) },
    { id: rid(), chatroom_id: rehab, content: 'Right-shoulder impingement (in rehab): warm up before overhead work, reduce load in the painful arc, dumbbells instead of the barbell. Left ankle sprain (returning to play): straight-line jogging is fine, keep up the proprioception work.', covered_through: atTime(addDays(TODAY, -8), 18) },
    { id: rid(), chatroom_id: program, content: 'Plan vs. coach feedback: unilateral leg work is covered by Bulgarian split squats; bench tempo is missing from the written plan and should be added.', covered_through: atTime(addDays(TODAY, -5), 11) },
  ]

  const memories: Row[] = [
    { id: rid(), chatroom_id: strength, content: 'Bench goal: 100kg by year end. Technique cues: 2s eccentric + scapular retraction.', shareable: true, pinned: true, created_at: atTime(addDays(TODAY, -19), 9) },
    { id: rid(), chatroom_id: strength, content: 'Always warm the right shoulder up before overhead work — keeps the impingement from coming back.', shareable: true, pinned: false, created_at: atTime(addDays(TODAY, -8), 18) },
    { id: rid(), chatroom_id: nutrition, content: 'Add ~50g of carbs on top of normal intake on training days.', shareable: true, pinned: false, created_at: atTime(addDays(TODAY, -12), 13) },
    { id: rid(), chatroom_id: rehab, content: 'Use Spanish squats (isometric) in place of regular squats whenever the knee is bothering him.', shareable: true, pinned: true, created_at: atTime(addDays(TODAY, -8), 18) },
    { id: rid(), chatroom_id: chinese, content: '主项每周 +2.5kg;膝盖不适时改用西班牙深蹲等长负荷。', shareable: true, pinned: false, created_at: atTime(addDays(TODAY, -2), 20) },
  ]

  // Cross-room memory grants: Rehab, Nutrition and the Chinese room may READ the
  // Strength room's shareable memory (goals/technique) — never its raw data or full chat.
  const memory_access: Row[] = [
    { id: rid(), reader_room_id: rehab, source_room_id: strength },
    { id: rid(), reader_room_id: nutrition, source_room_id: strength },
    { id: rid(), reader_room_id: chinese, source_room_id: strength },
  ]

  // Per-room file access.
  const file_access: Row[] = [
    { id: rid(), chatroom_id: strength, file_id: fileIds.plan },
    { id: rid(), chatroom_id: strength, file_id: fileIds.coach },
    { id: rid(), chatroom_id: nutrition, file_id: fileIds.plan },
    { id: rid(), chatroom_id: rehab, file_id: fileIds.labs },
    { id: rid(), chatroom_id: program, file_id: fileIds.plan },
    { id: rid(), chatroom_id: program, file_id: fileIds.coach },
  ]

  return {
    chatrooms, chat_messages: msgs, chatroom_summaries: summaries,
    chatroom_memories: memories, chatroom_memory_access: memory_access, chatroom_file_access: file_access,
  }
}
