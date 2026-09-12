/**
 * 演示模式的「模型脚本」。
 *
 * `?demo=1` 时，引擎会用这份预设响应**真的跑一遍完整流水线**，
 * 所以截图里的每一步、每条上下文、每条记忆都是真实产物，不是摆拍。
 */

export const DEMO_PC_PERSONA = `沈栖，二十四岁。做古籍修复，手上总有洗不掉的浆糊味。
不太会主动开口；但一旦决定要说，就不太会收回。
三年前离开过一段时间，原因没跟任何人说清。`

export const ROUND1_INPUT = `三天后，傍晚。雨刚停，青石板上还积着水洼。
我推门进了城南那家茶馆，袖子湿了半截。
林砚已经坐在靠里的位置，面前那盏茶只剩一半。
我说：「你来得比我预想的早。」
林砚抬眼看我，笑了一下，说：「路上耽搁了。」
我心里想，他果然还是不想让我看出什么。
柜台后面的阿七擦着杯子，一直没抬头。`

export const ROUND2_INPUT = `我坐下来，把伞靠在桌边。
我其实。。。。（我有点犹豫）。。。。也没那么想回家。。。。
（我看着他）我可以。。。。跟你待一会吗。`

const ROUND1_SEGMENT = {
  segments: [
    {
      blockIndex: 0,
      kind: 'scene',
      text: '三天后，傍晚。雨刚停，青石板上还积着水洼。',
      location: '城南茶馆门口',
      confidence: 0.95,
      reason: '天气与时间，没有人物动作',
    },
    {
      blockIndex: 1,
      kind: 'action',
      text: '我推门进了城南那家茶馆，袖子湿了半截。',
      subject: ['我'],
      confidence: 0.92,
      reason: '视角角色的动作',
    },
    {
      blockIndex: 2,
      kind: 'action',
      text: '林砚已经坐在靠里的位置，面前那盏茶只剩一半。',
      subject: ['林砚'],
      confidence: 0.9,
      reason: '在场人物与其状态',
    },
    {
      blockIndex: 3,
      kind: 'speech',
      text: '你来得比我预想的早。',
      speaker: '我',
      addressee: ['林砚'],
      isFact: true,
      confidence: 0.97,
      reason: '视角角色的台词',
    },
    {
      blockIndex: 4,
      kind: 'action',
      text: '林砚抬眼看我，笑了一下',
      subject: ['林砚'],
      confidence: 0.84,
      reason: '说话前的动作，与台词混在同一段',
    },
    {
      blockIndex: 4,
      kind: 'speech',
      text: '路上耽搁了。',
      speaker: '林砚',
      addressee: ['我'],
      confidence: 0.9,
      reason: '同一段里说出口的话',
    },
    {
      blockIndex: 5,
      kind: 'inner',
      text: '我心里想，他果然还是不想让我看出什么。',
      subject: ['我'],
      visibility: 'private',
      confidence: 0.9,
      reason: '明确的内心活动',
    },
    {
      blockIndex: 6,
      kind: 'action',
      text: '柜台后面的阿七擦着杯子，一直没抬头。',
      subject: ['阿七'],
      confidence: 0.9,
      reason: '在场第三人的动作',
    },
  ],
  entities: [
    { mention: '我', kind: 'person', role: 'pc' },
    { mention: '林砚', kind: 'person', role: 'present' },
    { mention: '阿七', kind: 'person', role: 'present' },
    { mention: '城南茶馆', kind: 'place', role: 'present' },
  ],
  timeMarkers: [{ text: '三天后', kind: 'elapsed', value: 'P3D' }],
}

const ROUND1_SCENE = {
  inputMode: 'dialogue',
  time: '三天后的傍晚',
  place: '城南茶馆',
  atmosphere: '雨刚停，屋里只点了两盏灯',
  opening: [
    '雨刚停，青石板上还积着水洼，踩上去会发出很轻的一声。',
    '茶馆的门是旧木头的，推开时门框上的铃铛响了一下。里头只点了两盏灯，靠里那桌坐着个人。',
  ],
  situation: '你推门进来，林砚已经在那儿了，面前那盏茶只剩一半。',
  pcProfile: '二十出头，外套肩膀湿了一片，站在门口没有立刻往里走。',
  present: [
    { name: '林砚', role: '靠里那桌的客人', brief: '面前那盏茶只剩一半', kind: 'character', active: true },
    { name: '阿七', role: '柜台后面的伙计', brief: '擦着杯子，一直没抬头', kind: 'character', active: true },
  ],
  establishedBeats: [
    { kind: 'action', character: '我', text: '推门进了城南那家茶馆，袖子湿了半截。' },
    { kind: 'speech', character: '我', text: '你来得比我预想的早。' },
    { kind: 'speech', character: '林砚', text: '路上耽搁了。' },
  ],
}

const ROUND1_EXPOSURE = {
  cues: [
    {
      fromIndex: 0,
      hidden: '他果然还是不想让我看出什么',
      visible: '视线在林砚脸上停了一下就移开了，握伞的手指收紧了一点',
      channel: 'gaze',
      leakage: 0.35,
      readability: 0.25,
    },
  ],
  note: '他努力显得只是随口一问，但握伞的那只手出卖了一点紧绷。',
}

const ROUND1_CAST = {
  characters: [
    {
      name: '林砚',
      aliases: [],
      tier: 'major',
      canonical: false,
      franchise: '',
      summary: '把话都收在动作里的人，和「我」有几年说不清的旧账',
      drive: '想让「我」把那三年里没说清的话自己说出口；他不打算先问。',
      speechStyle: '句子短，常用「嗯」「还行」这类含糊的词挡回去；被问到关键处会先停半拍',
      temperament: ['克制', '不主动示弱', '对熟人有一种笨拙的耐心'],
      habits: ['说话前右手会在桌沿上顿一下', '笑的时候只动嘴角，眼睛不动'],
      signature: ['答话前先停半拍', '笑只动嘴角', '永远坐在靠里的位置'],
      voiceSamples: ['「嗯。」', '「路上耽搁了。」', '「你想好了再说。」'],
      canonAnchors: [],
      boundaries: ['不会主动解释自己的动机', '不会当着外人提以前的事'],
      background: '和「我」认识好几年。三年前那件事之后，两人就很少见面了。',
      mood: '戒备里带着一点没散的旧情绪',
      location: '靠里的那桌',
      appearsInInput: true,
      evidence: '「抬眼看我，笑了一下」——不是热络，也不是冷淡',
    },
    {
      name: '阿七',
      aliases: [],
      tier: 'extra',
      canonical: false,
      franchise: '',
      summary: '茶馆的伙计，存在感很低但什么都看在眼里',
      drive: '把今晚这壶茶伺候好，别让这两位在这儿闹出动静来。',
      speechStyle: '话极少，能用一个字就不用两个字',
      temperament: ['不好奇', '手脚麻利'],
      habits: ['一直擦同一个杯子'],
      signature: ['擦杯子', '不抬头'],
      voiceSamples: ['「来了。」'],
      canonAnchors: [],
      boundaries: ['不会打听客人的事'],
      background: '在这家茶馆做了几年，认识常客但不算熟。',
      mood: '无聊',
      location: '柜台后面',
      appearsInInput: true,
      evidence: '「擦着杯子，一直没抬头」',
    },
  ],
}

const ROUND1_ROLEPLAY_LINYAN = {
  beats: [
    { kind: 'cue', text: '笑收得比平时快了一点，右手在桌沿上顿了一下' },
    { kind: 'action', text: '把面前那半盏茶往你那边推了推' },
    { kind: 'speech', text: '坐吧。站门口怪显眼的。', addressee: ['我'] },
  ],
  inner: '她还是老样子，进门先看一圈，再决定往哪走。',
  mood: '把旧情绪压回原处',
}

const ROUND1_ROLEPLAY_AQI = {
  beats: [
    { kind: 'cue', text: '擦杯子的手停了半秒，又接着擦' },
    { kind: 'action', text: '把杯子放回架子上，转身去后头添水' },
  ],
  inner: '这两位看着不像只是来喝茶的。',
  mood: '懒得管',
  silentReason: '店里的事比客人的事要紧，而且也没他插话的份',
}

const ROUND2_SEGMENT = {
  segments: [
    {
      blockIndex: 0,
      kind: 'action',
      text: '我坐下来，把伞靠在桌边。',
      subject: ['我'],
      confidence: 0.92,
      reason: '视角角色的动作',
    },
    { blockIndex: 1, kind: 'speech', text: '我其实。。。。', speaker: '我', addressee: ['林砚'], confidence: 0.88, reason: '没有引号，但是说出口的半截话' },
    { blockIndex: 2, kind: 'inner', text: '（我有点犹豫）', subject: ['我'], visibility: 'private', confidence: 0.86, reason: '括号里写的是情绪状态' },
    { blockIndex: 3, kind: 'speech', text: '。。。。也没那么想回家。。。。', speaker: '我', addressee: ['林砚'], confidence: 0.85, reason: '接着上一句继续说的' },
    { blockIndex: 4, kind: 'action', text: '（我看着他）', subject: ['我'], confidence: 0.8, reason: '括号里写的是动作' },
    {
      blockIndex: 4,
      kind: 'speech',
      text: '我可以。。。。跟你待一会吗。',
      speaker: '我',
      addressee: ['林砚'],
      confidence: 0.9,
      reason: '同一段里说出口的话',
    },
  ],
  entities: [
    { mention: '我', kind: 'person', role: 'pc' },
    { mention: '林砚', kind: 'person', role: 'present' },
  ],
  timeMarkers: [],
}

const ROUND2_SCENE = {
  inputMode: 'mixed',
  time: '同一天稍晚',
  place: '城南茶馆 · 靠里的那桌',
  atmosphere: '雨后的安静，只有后头添水的声音',
  opening: [],
  situation: '你在他对面坐下，把那句话分成了两半说。',
  pcProfile: '二十出头，坐下来之后把伞靠在桌边，手还搭在伞柄上。',
  present: [
    { name: '林砚', role: '坐在你对面的那个人', brief: '刚才把茶推给了你', kind: 'character', active: true },
    { name: '阿七', role: '柜台后面的伙计', brief: '去后头添水了', kind: 'extra', active: false },
  ],
  establishedBeats: [{ kind: 'action', character: '我', text: '坐下来，把伞靠在桌边。' }],
}

const ROUND2_EXPOSURE = {
  cues: [
    {
      fromIndex: 0,
      hidden: '（我有点犹豫）',
      visible: '话说了一半停下来，手指在伞柄上蹭了一下',
      channel: 'pause',
      leakage: 0.5,
      readability: 0.35,
    },
  ],
  note: '他明显把一句话拆成了两截，中间咽回去了点什么。',
}

const ROUND2_ROLEPLAY_LINYAN = {
  beats: [
    { kind: 'cue', text: '视线在你脸上停了一下，比刚才久' },
    { kind: 'speech', text: '……你要是不想回，就别回。', addressee: ['我'] },
    { kind: 'action', text: '把茶杯端起来又放下，没喝' },
  ],
  inner: '她刚才那句是分成两半说的。中间咽回去的那半句，才是她真正想说的。',
  mood: '被那句半截话拽回三年前',
}

const ROUND1_SITUATION = {
  pressure: '林砚等了三天，他今天是有话要说的；柜台后面的阿七并不只是个擦杯子的伙计。',
  escalation: '如果你一直站着不坐下，林砚会先开口——他等不下去了。',
  events: [
    { kind: 'ambient', text: '门框上的铃铛还在轻轻晃，柜台那边传来杯沿碰在一起的一声轻响。' },
  ],
  order: ['林砚', '阿七'],
  note: '',
}

const ROUND2_SITUATION = {
  pressure: '林砚那盏茶已经见底了，他今天不是来叙旧的；阿七擦杯子的手停在了半空。',
  escalation: '你再不把话说完，林砚就会替你说破。',
  events: [
    { kind: 'scene', text: '灯芯爆了一下，屋里暗了半瞬，又亮起来。' },
    { kind: 'ambient', text: '柜台那边传来一声很轻的响动——阿七把手里的杯子放在了木头上。' },
  ],
  order: ['林砚'],
  note: '',
}

const ROUND1_PERCEIVE = {
  entries: [
    { name: '林砚', missed: [], distorted: [], extras: [], note: '' },
    { name: '阿七', missed: [], distorted: [], extras: [], note: '' },
  ],
}

const ROUND2_PERCEIVE = {
  entries: [{ name: '林砚', missed: [], distorted: [], extras: [], note: '' }],
}

export const ROUND1_SCRIPT: Record<string, unknown> = {
  segment: ROUND1_SEGMENT,
  scene: ROUND1_SCENE,
  exposure: ROUND1_EXPOSURE,
  cast: ROUND1_CAST,
  perceive: ROUND1_PERCEIVE,
  situation: ROUND1_SITUATION,
  'roleplay:林砚': ROUND1_ROLEPLAY_LINYAN,
  'roleplay:阿七': ROUND1_ROLEPLAY_AQI,
}

export const ROUND2_SCRIPT: Record<string, unknown> = {
  segment: ROUND2_SEGMENT,
  scene: ROUND2_SCENE,
  exposure: ROUND2_EXPOSURE,
  perceive: ROUND2_PERCEIVE,
  situation: ROUND2_SITUATION,
  'roleplay:林砚': ROUND2_ROLEPLAY_LINYAN,
}
