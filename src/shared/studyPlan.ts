import type { LessonKind } from './course'
import { isDateKey, parseDateKey } from './planner'
import { dayKey } from './streak'

/**
 * Plano de estudos de um curso: distribui as aulas que faltam pelos dias de estudo, até uma data-alvo
 * (`date`) ou num ritmo de minutos por dia (`pace`). Cada dia vira uma tarefa no Planner.
 */
export type PlanMode = 'date' | 'pace'

export interface PlanSettings {
  mode: PlanMode
  /** Data-alvo 'AAAA-MM-DD' (modo `date`). */
  targetDate: string | null
  /** Minutos por dia de estudo (modo `pace`; no modo `date`, usado se a data-alvo já tiver passado). */
  minutesPerDay: number
  /** Dias da semana com estudo: 0 = domingo … 6 = sábado. */
  weekdays: number[]
  /** Velocidade em que a pessoa assiste (vídeos a 1,5× ocupam 2/3 do tempo). */
  speed: number
  /** Replanejar sozinho quando sobrarem aulas de dias que já passaram. */
  autoReplan: boolean
}

export const DEFAULT_PLAN: PlanSettings = {
  mode: 'date',
  targetDate: null,
  minutesPerDay: 30,
  weekdays: [1, 2, 3, 4, 5],
  speed: 1,
  autoReplan: true
}

export const SPEEDS = [1, 1.25, 1.5, 1.75, 2] as const
export const WEEKDAY_LABELS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'] as const
/** Tempo estimado de uma aula em texto ou documento. */
export const READING_MINUTES = 10
/** Vídeo sem duração conhecida e curso sem nenhuma duração para comparar. */
export const UNKNOWN_VIDEO_MINUTES = 10
/** Acima disso por dia, o plano avisa que está pesado. */
export const HEAVY_MINUTES_PER_DAY = 240
const MAX_PLAN_DAYS = 3 * 366
const PACE_SLACK = 1.1

/** Valida as opções vindas da interface; lança com uma mensagem para a pessoa. */
export function validatePlanSettings(input: unknown, today: string): PlanSettings {
  const o = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>
  const mode: PlanMode = o.mode === 'pace' ? 'pace' : 'date'
  const weekdays = Array.isArray(o.weekdays)
    ? [...new Set(o.weekdays.map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort()
    : []
  if (weekdays.length === 0) throw new Error('Escolha pelo menos um dia da semana para estudar')
  const minutes = Math.round(Number(o.minutesPerDay))
  if (!Number.isFinite(minutes) || minutes < 5 || minutes > 720) throw new Error('Minutos por dia devem ficar entre 5 e 720')
  const speed = Number(o.speed)
  if (!Number.isFinite(speed) || speed < 0.5 || speed > 3) throw new Error('Velocidade inválida')
  let targetDate: string | null = null
  if (mode === 'date') {
    if (!isDateKey(o.targetDate)) throw new Error('Escolha a data em que quer terminar o curso')
    if (o.targetDate < today) throw new Error('A data-alvo já passou')
    targetDate = o.targetDate
  } else if (isDateKey(o.targetDate)) {
    targetDate = o.targetDate
  }
  return { mode, targetDate, minutesPerDay: minutes, weekdays, speed, autoReplan: o.autoReplan !== false }
}

/** Lê opções guardadas no banco sem lançar (valores estranhos voltam ao padrão). */
export function readPlanSettings(json: string): PlanSettings {
  try {
    const raw = JSON.parse(json) as Partial<PlanSettings>
    return {
      mode: raw.mode === 'pace' ? 'pace' : 'date',
      targetDate: isDateKey(raw.targetDate) ? raw.targetDate : null,
      minutesPerDay: Number.isFinite(raw.minutesPerDay) ? Math.min(720, Math.max(5, Math.round(raw.minutesPerDay!))) : DEFAULT_PLAN.minutesPerDay,
      weekdays: Array.isArray(raw.weekdays) && raw.weekdays.length ? raw.weekdays.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6) : DEFAULT_PLAN.weekdays,
      speed: Number.isFinite(raw.speed) ? Math.min(3, Math.max(0.5, raw.speed!)) : 1,
      autoReplan: raw.autoReplan !== false
    }
  } catch {
    return { ...DEFAULT_PLAN }
  }
}

export interface PlanLessonInput {
  id: number
  kind: LessonKind
  durationSec: number | null
}

/** Mediana das durações conhecidas dos vídeos (para estimar os que ainda não foram medidos). */
export function typicalVideoSeconds(lessons: PlanLessonInput[]): number {
  const known = lessons
    .filter((l) => l.kind === 'video' && l.durationSec && l.durationSec > 0)
    .map((l) => l.durationSec!)
    .sort((a, b) => a - b)
  if (known.length === 0) return UNKNOWN_VIDEO_MINUTES * 60
  const mid = Math.floor(known.length / 2)
  return known.length % 2 ? known[mid] : (known[mid - 1] + known[mid]) / 2
}

/** Minutos que a aula ocupa no plano. */
export function lessonMinutes(lesson: PlanLessonInput, typicalSec: number, speed: number): number {
  if (lesson.kind !== 'video') return lesson.durationSec && lesson.durationSec > 0 ? lesson.durationSec / 60 : READING_MINUTES
  const seconds = lesson.durationSec && lesson.durationSec > 0 ? lesson.durationSec : typicalSec
  return seconds / 60 / speed
}

export function addDaysKey(key: string, days: number): string {
  const d = parseDateKey(key)
  d.setDate(d.getDate() + days)
  return dayKey(d)
}

/** Dias de estudo de `from` a `to` (inclusive) nos dias da semana escolhidos. */
export function studyDates(from: string, to: string, weekdays: number[]): string[] {
  const out: string[] = []
  const allowed = new Set(weekdays)
  for (let key = from, i = 0; key <= to && i < MAX_PLAN_DAYS; key = addDaysKey(key, 1), i++) {
    if (allowed.has(parseDateKey(key).getDay())) out.push(key)
  }
  return out
}

export interface PlannedDay {
  date: string
  lessonIds: number[]
  minutes: number
}

export interface PlanResult {
  days: PlannedDay[]
  totalMinutes: number
  /** Minutos por dia de estudo (no modo data-alvo, a média necessária). */
  minutesPerDay: number
  endDate: string | null
  /** Algo que a pessoa precisa saber (plano pesado, data-alvo que não dá mais…). */
  warning: string | null
}

/**
 * Distribui as aulas, na ordem do curso, a partir de `start`.
 * - Data-alvo: divide o tempo total igualmente entre os dias de estudo até a data (cada aula vai para o dia em
 *   que cai o meio dela na linha do tempo, então a ordem se mantém e os dias ficam equilibrados).
 * - Ritmo: enche cada dia até os minutos escolhidos (com 10% de folga); aula maior que o dia fica sozinha.
 * Se não houver dia de estudo até a data-alvo, cai no ritmo de `minutesPerDay` e avisa.
 */
export function buildPlan(lessons: { id: number; minutes: number }[], settings: PlanSettings, start: string): PlanResult {
  const totalMinutes = lessons.reduce((sum, l) => sum + l.minutes, 0)
  const empty = (warning: string | null = null): PlanResult => ({ days: [], totalMinutes, minutesPerDay: 0, endDate: null, warning })
  if (lessons.length === 0) return empty()

  if (settings.mode === 'date' && settings.targetDate) {
    const dates = studyDates(start, settings.targetDate, settings.weekdays)
    if (dates.length > 0) {
      const perDay = totalMinutes / dates.length
      const days: PlannedDay[] = []
      let elapsed = 0
      for (const lesson of lessons) {
        const index = perDay > 0 ? Math.min(dates.length - 1, Math.floor((elapsed + lesson.minutes / 2) / perDay)) : 0
        elapsed += lesson.minutes
        const date = dates[index]
        let day = days[days.length - 1]
        if (!day || day.date !== date) {
          day = { date, lessonIds: [], minutes: 0 }
          days.push(day)
        }
        day.lessonIds.push(lesson.id)
        day.minutes += lesson.minutes
      }
      const warning =
        perDay > HEAVY_MINUTES_PER_DAY
          ? `São cerca de ${Math.round(perDay)} min por dia de estudo. Que tal uma data mais distante ou mais dias na semana?`
          : null
      return { days, totalMinutes, minutesPerDay: perDay, endDate: days[days.length - 1].date, warning }
    }
    const paced = buildPlan(lessons, { ...settings, mode: 'pace' }, start)
    return {
      ...paced,
      warning: `Não há dias de estudo até ${formatDateKey(settings.targetDate)}. As aulas foram distribuídas em ${settings.minutesPerDay} min por dia; escolha uma nova data.`
    }
  }

  const budget = settings.minutesPerDay
  const allowed = new Set(settings.weekdays)
  const days: PlannedDay[] = []
  let date = start
  let guard = 0
  const nextStudyDate = (from: string) => {
    let key = from
    while (!allowed.has(parseDateKey(key).getDay()) && guard++ < MAX_PLAN_DAYS) key = addDaysKey(key, 1)
    return key
  }
  date = nextStudyDate(date)
  let day: PlannedDay = { date, lessonIds: [], minutes: 0 }
  for (const lesson of lessons) {
    if (day.lessonIds.length > 0 && day.minutes + lesson.minutes > budget * PACE_SLACK) {
      days.push(day)
      date = nextStudyDate(addDaysKey(date, 1))
      day = { date, lessonIds: [], minutes: 0 }
    }
    day.lessonIds.push(lesson.id)
    day.minutes += lesson.minutes
  }
  days.push(day)
  return { days, totalMinutes, minutesPerDay: budget, endDate: day.date, warning: null }
}

/** "12 de dez." ou "12 de dez. de 2027" se for outro ano. */
export function formatDateKey(key: string, today = dayKey(new Date())): string {
  const date = parseDateKey(key)
  const sameYear = key.slice(0, 4) === today.slice(0, 4)
  return date.toLocaleDateString('pt-BR', { day: 'numeric', month: 'short', ...(sameYear ? {} : { year: 'numeric' }) })
}

/** "45 min", "1 h 20 min", "3 h". */
export function formatMinutes(minutes: number): string {
  const total = Math.max(0, Math.round(minutes))
  if (total < 60) return `${total} min`
  const h = Math.floor(total / 60)
  const m = total % 60
  return m ? `${h} h ${m} min` : `${h} h`
}

// ── O que a interface mostra ────────────────────────────────────────────────

export interface PlanLessonRef {
  id: number
  title: string
  completed: boolean
}

export interface PlanDayView {
  taskId: number
  date: string
  minutes: number
  done: boolean
  lessons: PlanLessonRef[]
}

export interface PlanStatus {
  remainingLessons: number
  remainingMinutes: number
  /** Aulas de dias que já passaram e não foram concluídas. */
  behindLessons: number
  /** Aulas que faltam e não estão em nenhum dia pendente do plano (ex.: aulas novas depois de revalidar). */
  unplannedLessons: number
  /** Último dia do plano. */
  endDate: string | null
  /** Média de minutos por dia de estudo, de hoje em diante. */
  averageMinutes: number
  /** Hoje e os próximos dias com aulas (até 7). */
  upcoming: PlanDayView[]
  /** Minutos de aulas deste curso concluídas por dia, em média, nos últimos 14 dias. */
  recentMinutesPerDay: number
  /** Quando terminaria mantendo o ritmo dos últimos 14 dias (null sem estudo recente). */
  forecastDate: string | null
}

export interface StudyPlanView {
  id: number
  courseId: number
  courseTitle: string
  settings: PlanSettings
  createdAt: number
  replannedAt: number | null
  status: PlanStatus
}

export interface PlanPreview {
  result: PlanResult
  remainingLessons: number
  /** Vídeos sem duração medida, estimados pela duração típica do curso. */
  estimatedLessons: number
  /** Minutos por dia que outros planos ativos já pedem (para não passar do tempo disponível). */
  otherPlansMinutes: number
}

export const RECENT_DAYS = 14
