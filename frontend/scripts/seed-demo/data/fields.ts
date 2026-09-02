// Frisbee's optional "level" custom field (mirrors FRISBEE_FIELDS in src; copied
// here so the standalone seeder has no dependency on the app bundle).
export const FRISBEE_FIELDS = [
  {
    key: 'level',
    label_zh: '等级',
    label_en: 'Level',
    type: 'select',
    options: [
      { value: 'toss', zh: '抛接', en: 'Toss' },
      { value: 'casual', zh: '休闲', en: 'Casual' },
      { value: 'club', zh: '俱乐部', en: 'Club' },
      { value: 'major', zh: '大赛', en: 'Major' },
    ],
  },
]
