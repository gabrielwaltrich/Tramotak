import { describe, expect, it } from 'vitest'
import { compatibility, mediaUrl, offsetSegments, parseMediaUrl, parseProbe, progressFrom, segmentsToVtt } from '@shared/media'

const HEVC = `Input #0, mov,mp4,m4a,3gp,3g2,mj2, from 'aula.mp4':
  Metadata:
    major_brand     : isom
  Duration: 01:02:03.50, start: 0.000000, bitrate: 1200 kb/s
  Stream #0:0[0x1](und): Video: hevc (Main) (hvc1 / 0x31637668), yuv420p(tv), 1920x1080, 1000 kb/s, 30 fps
  Stream #0:1[0x2](por): Audio: aac (LC) (mp4a / 0x6134706D), 48000 Hz, stereo, fltp, 128 kb/s
At least one output file must be specified`

const AVI = `Input #0, avi, from 'velho.avi':
  Duration: 00:10:00.00, start: 0.000000, bitrate: 900 kb/s
  Stream #0:0: Video: h264 (High) (H264 / 0x34363248), yuv420p, 640x480, 25 fps
  Stream #0:1: Audio: mp3 (U[0][0][0] / 0x0055), 44100 Hz, stereo, fltp, 128 kb/s`

describe('parseProbe e compatibilidade', () => {
  it('lê duração, contêiner e codecs', () => {
    expect(parseProbe(HEVC)).toEqual({ durationSec: 3723.5, container: 'mov,mp4,m4a,3gp,3g2,mj2', videoCodec: 'hevc', audioCodec: 'aac' })
  })

  it('HEVC precisa de conversão completa', () => {
    expect(compatibility(parseProbe(HEVC))).toMatchObject({ playable: false, plan: 'full' })
  })

  it('H.264 em AVI só precisa trocar de contêiner (rápido)', () => {
    expect(compatibility(parseProbe(AVI))).toMatchObject({ playable: false, plan: 'remux' })
  })

  it('áudio AC-3 converte só o áudio; vídeo comum é compatível', () => {
    const ac3 = HEVC.replace('Video: hevc', 'Video: h264').replace('Audio: aac', 'Audio: ac3')
    expect(compatibility(parseProbe(ac3))).toMatchObject({ plan: 'audio' })
    expect(compatibility(parseProbe(HEVC.replace('Video: hevc', 'Video: h264')))).toEqual({ playable: true, plan: 'none', reason: 'Compatível' })
    expect(compatibility(parseProbe('Input #0, matroska,webm, from x\n  Stream #0:0: Video: vp9'))).toMatchObject({ playable: true })
  })

  it('arquivo sem vídeo', () => {
    expect(compatibility(parseProbe('Input #0, mp3, from x\n  Stream #0:0: Audio: mp3'))).toMatchObject({ playable: false, plan: 'none' })
  })
})

describe('progresso e legendas', () => {
  it('progresso do FFmpeg', () => {
    expect(progressFrom('out_time_us=30000000', 60)).toBe(0.5)
    expect(progressFrom('out_time_us=90000000', 60)).toBe(1)
    expect(progressFrom('frame=10', 60)).toBeNull()
    expect(progressFrom('out_time_us=1', null)).toBeNull()
  })

  it('WebVTT a partir dos trechos, com deslocamento entre pedaços', () => {
    const segs = [...offsetSegments([{ start: 0, end: 2.5, text: ' Olá ' }], 0), ...offsetSegments([{ start: 1, end: 3, text: 'segundo pedaço' }, { start: 4, end: 4, text: '  ' }], 600)]
    expect(segs).toEqual([
      { start: 0, end: 2.5, text: 'Olá' },
      { start: 601, end: 603, text: 'segundo pedaço' }
    ])
    expect(segmentsToVtt(segs)).toBe('WEBVTT\n\n1\n00:00:00.000 --> 00:00:02.500\nOlá\n\n2\n00:10:01.000 --> 00:10:03.000\nsegundo pedaço\n')
  })
})

describe('URLs do protocolo', () => {
  it('versão de cache e transcrição', () => {
    expect(mediaUrl.lesson(3, 99)).toBe('tramotak-media://lesson/3?v=99')
    expect(parseMediaUrl('tramotak-media://lesson/3?v=99')).toEqual({ type: 'lesson', id: 3 })
    expect(parseMediaUrl(mediaUrl.transcript(5))).toEqual({ type: 'transcript', id: 5 })
  })
})
