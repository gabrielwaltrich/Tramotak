import { readPref, writePref } from '../../storage'

export const SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2]

const num = (key: string, fallback: number, min: number, max: number) => {
  const value = Number(readPref(key))
  return Number.isFinite(value) && value >= min && value <= max && readPref(key) !== null ? value : fallback
}

/** Preferências do player, guardadas só nesta máquina. */
export const playerPrefs = {
  rate: () => num('tramotak.player.rate', 1, 0.25, 2),
  setRate: (v: number) => writePref('tramotak.player.rate', String(v)),
  volume: () => num('tramotak.player.volume', 1, 0, 1),
  setVolume: (v: number) => writePref('tramotak.player.volume', String(v)),
  muted: () => readPref('tramotak.player.muted') === '1',
  setMuted: (v: boolean) => writePref('tramotak.player.muted', v ? '1' : '0'),
  autoplay: () => readPref('tramotak.player.autoplay') !== '0',
  setAutoplay: (v: boolean) => writePref('tramotak.player.autoplay', v ? '1' : '0'),
  /** Idioma de legenda preferido; 'off' desliga. */
  subtitle: () => readPref('tramotak.player.subtitle') ?? 'off',
  setSubtitle: (v: string) => writePref('tramotak.player.subtitle', v)
}
