import type { SegmentKind } from '@/types/segment'
import { makeId } from '@/utils/id'

export interface TextBlock {
  id: string
  /** 块编号，交给模型打标签时用它对齐回原文 */
  index: number
  text: string
  /** 在原文中的字符偏移 */
  range: [number, number]
  ruleKind: SegmentKind
  ruleSpeaker: string | null
  ruleAddressee: string[]
  ruleConfidence: number
  ruleNotes: string[]
}

export interface NormalizedDoc {
  text: string
  blocks: TextBlock[]
  /** 规则层扫到的时间标记（给模型做参考） */
  timeMarkerHits: { text: string; range: [number, number] }[]
}

/** 超过这个长度的行会按句末标点再切 */
const MAX_BLOCK_LEN = 200

/** 说话动词（长的排前面，避免被短的抢先匹配） */
const VERB =
  '(?:说道|问道|答道|喊道|叫道|笑道|冷笑道|低声说|轻声道|开口道|回应道|嘟囔|喃喃|补充|反问|解释|重复|嘀咕|说|道|问|答|喊|叫|应|开口)'
/** 名字用非贪婪，否则「林砚说道」会被整串吃进名字里 */
const NAME = '([\\u4e00-\\u9fa5A-Za-z·]{1,4}?)'
/** 名字与动词之间只允许白名单里的修饰语，避免吞掉名字的一部分 */
const MODIFIER = '(?:冷冷地|淡淡地|低声|轻声|笑着|皱着眉|叹了口气|顿了顿|缓缓|忽然|轻轻)?'

const QUOTE_SPAN_RE = /[\u300c\u201c"][^\u300d\u201d"]*[\u300d\u201d"]/g
const INNER_RE = /(心想|暗想|心道|心里想|心中想|内心深处|暗自|默默想|琢磨|寻思|思忖|盘算|回忆起|回想起|记得|意识到|忽然明白)/
/** 括号里写的往往是舞台指示或状态；带情绪的算心理活动 */
const PAREN_RE = /[（(]([^）)]+)[）)]/
const EMOTION_RE =
  /(尴尬|窘迫|紧张|忐忑|害怕|恐惧|高兴|开心|难过|伤心|心虚|后悔|不安|兴奋|生气|愤怒|愧疚|失落|委屈|焦虑|烦躁|无奈|得意|心酸|害羞|嫉妒|厌烦|安心|失望|期待|犹豫|纠结|慌|别扭|抱歉|感激|庆幸)/
const ACTION_RE =
  /(走|跑|站|坐|推|拉|抬|低|转|伸|握|放|拿|递|接|点头|摇头|皱眉|撇嘴|笑|哭|叹气|起身|坐下|转身|抬头|低头|后退|靠近|躲|踢|抓|松开|抱|推开|看向|盯着|扫了|环视|转身|迈步)/

/**
 * 时间标记。
 * 注意：带 g 的正则会在 test()/exec() 之间共享 lastIndex，所以这里拆成两份，
 * 一份不带 g 用于 test，一份带 g 用于 matchAll。
 */
const TIME_PATTERN =
  '(\\d+\\s*(?:分钟|小时|天|个月|月|年|周|礼拜|秒)(?:后|之后|以后|前))|(翌日|次日|第二天早上|第二天|当晚|当天晚上|次日清晨|片刻后|半晌后|半晌|稍后|许久|过了一会儿|三天后|多年后|一炷香|半个时辰)'
const TIME_RE = new RegExp(TIME_PATTERN)
const TIME_RE_GLOBAL = new RegExp(TIME_PATTERN, 'g')

function splitLines(text: string): { text: string; start: number }[] {
  const lines: { text: string; start: number }[] = []
  let start = 0
  for (let i = 0; i <= text.length; i += 1) {
    if (i === text.length || text[i] === '\n') {
      lines.push({ text: text.slice(start, i), start })
      start = i + 1
    }
  }
  return lines
}

/**
 * 把一行按括号切开：「A（B）C」→ [A, （B）, C]
 * 括号往往是插进来的心理或动作，它把前后的台词切成了两段 —— 还原这个结构很重要。
 */
function splitByParens(text: string, absStart: number): { text: string; range: [number, number] }[] {
  const out: { text: string; range: [number, number] }[] = []
  const re = /[（(][^）)]*[）)]/g

  const pushPiece = (from: number, to: number) => {
    const rawPiece = text.slice(from, to)
    const piece = rawPiece.trim()
    if (!piece) return
    const offset = from + (rawPiece.length - rawPiece.trimStart().length)
    out.push({ text: piece, range: [absStart + offset, absStart + offset + piece.length] })
  }

  let last = 0
  for (const match of text.matchAll(re)) {
    const at = match.index ?? 0
    if (at > last) pushPiece(last, at)
    const paren = match[0].trim()
    if (paren) {
      const parenOffset = at + (match[0].length - match[0].trimStart().length)
      out.push({ text: paren, range: [absStart + parenOffset, absStart + parenOffset + paren.length] })
    }
    last = at + match[0].length
  }
  if (last < text.length) pushPiece(last, text.length)

  if (!out.length) out.push({ text, range: [absStart, absStart + text.length] })
  return out
}

/** 把原文切成块：先按行，再按括号，过长再按句末标点 */
export function splitIntoBlocks(raw: string): { text: string; range: [number, number] }[] {
  const out: { text: string; range: [number, number] }[] = []

  const pushWithLengthSplit = (piece: { text: string; range: [number, number] }) => {
    if (piece.text.length <= MAX_BLOCK_LEN) {
      out.push(piece)
      return
    }
    let cursor = 0
    for (const part of piece.text.split(/(?<=[。！？!?；;…])/)) {
      const partTrimmed = part.trim()
      if (partTrimmed) {
        const partStart = piece.range[0] + cursor + (part.length - part.trimStart().length)
        out.push({ text: partTrimmed, range: [partStart, partStart + partTrimmed.length] })
      }
      cursor += part.length
    }
  }

  for (const line of splitLines(raw)) {
    const trimmed = line.text.trim()
    if (!trimmed) continue
    const absStart = line.start + (line.text.length - line.text.trimStart().length)

    for (const piece of splitByParens(trimmed, absStart)) {
      pushWithLengthSplit(piece)
    }
  }

  return out
}

function quoteRatio(text: string): number {
  let quoted = 0
  for (const match of text.matchAll(QUOTE_SPAN_RE)) {
    quoted += match[0].length
  }
  return text.length ? quoted / text.length : 0
}

/** 从「X说道：「…」」或「「…」X说道」里抽出说话人 */
export function detectSpeaker(text: string): { speaker: string | null; addressee: string[] } {
  const prefix = new RegExp(`^${NAME}${MODIFIER}${VERB}\\s*[：:，,]?\\s*[\\u300c\\u201c"]`)
  const suffix = new RegExp(`[\\u300d\\u201d"]\\s*${NAME}${MODIFIER}${VERB}`)
  const colonOnly = new RegExp(`^${NAME}\\s*[：:]\\s*[\\u300c\\u201c"]`)

  const addressee: string[] = []
  const addrMatch = /(?:对|向|朝)\s*([\u4e00-\u9fa5A-Za-z·]{1,8})\s*(?:说|道|问|喊|解释)/.exec(text)
  if (addrMatch) addressee.push(addrMatch[1])

  const m1 = prefix.exec(text)
  if (m1) return { speaker: m1[1], addressee }
  const m3 = colonOnly.exec(text)
  if (m3) return { speaker: m3[1], addressee }
  const m2 = suffix.exec(text)
  if (m2) return { speaker: m2[1], addressee }

  return { speaker: null, addressee }
}

/** 规则预标注：能省掉大量模型成本，也给模型当提示 */
function annotate(text: string): { kind: SegmentKind; confidence: number; notes: string[]; speaker: string | null; addressee: string[] } {
  const notes: string[] = []
  let kind: SegmentKind = 'narration'
  let confidence = 0.3

  // 「（我有一点尴尬）」这种括号里的情绪状态，算心理活动
  const paren = PAREN_RE.exec(text)
  if (paren && EMOTION_RE.test(paren[1])) {
    kind = 'inner'
    confidence = 0.72
    notes.push('括号里写的是情绪状态')
  }

  if (INNER_RE.test(text)) {
    kind = 'inner'
    confidence = 0.8
    notes.push('含心理活动关键词')
  }

  const ratio = quoteRatio(text)
  if (ratio >= 0.45) {
    kind = 'speech'
    confidence = 0.78
    notes.push('引号内容占比高')
  } else if (ratio > 0.05 && kind === 'narration') {
    notes.push('含少量引号，可能台词与叙述混合')
    confidence = 0.42
  }

  if (kind === 'narration' && ACTION_RE.test(text)) {
    kind = 'action'
    confidence = 0.5
    notes.push('含动作动词')
  }

  if (TIME_RE.test(text)) {
    notes.push('含时间标记')
  }

  const { speaker, addressee } = kind === 'speech' ? detectSpeaker(text) : { speaker: null, addressee: [] }
  if (speaker) notes.push(`疑似说话人：${speaker}`)

  return { kind, confidence, notes, speaker, addressee }
}

/** S0：把用户输入规范化成带规则预标注的文本块 */
export function normalizeInput(raw: string): NormalizedDoc {
  const blocks = splitIntoBlocks(raw).map((block, index) => {
    const annotated = annotate(block.text)
    return {
      id: makeId('blk'),
      index,
      text: block.text,
      range: block.range,
      ruleKind: annotated.kind,
      ruleSpeaker: annotated.speaker,
      ruleAddressee: annotated.addressee,
      ruleConfidence: annotated.confidence,
      ruleNotes: annotated.notes,
    } satisfies TextBlock
  })

  const timeMarkerHits: { text: string; range: [number, number] }[] = []
  for (const match of raw.matchAll(TIME_RE_GLOBAL)) {
    const at = match.index ?? 0
    timeMarkerHits.push({ text: match[0], range: [at, at + match[0].length] })
  }

  return { text: raw, blocks, timeMarkerHits }
}
