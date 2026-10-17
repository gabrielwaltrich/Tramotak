/**
 * Gera o vídeo (com legenda) e o PDF do curso de exemplo em resources/sample-course. O resultado fica no repositório;
 * rode de novo só quando mudar o conteúdo abaixo:
 *
 *   node --experimental-strip-types scripts/build-sample-course.ts
 *
 * O vídeo são telas de texto sem narração (FFmpeg + legendas ASS queimadas na imagem); a "fala" vai num .srt com o
 * mesmo nome, que o player mostra e a IA lê. O PDF usa o mesmo gerador dos testes (Helvetica, só latin1).
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { makePdf } from '../tests/helpers/pdf.ts'

const ROOT = join(import.meta.dirname, '..', 'resources', 'sample-course', 'Como usar o Tramotak')
const FFMPEG = join(import.meta.dirname, '..', 'node_modules', 'ffmpeg-static', 'ffmpeg')
const SLIDE_SEC = 10

/** Cada tela: título, linhas e o que a "fala" (legenda) diz enquanto ela aparece. */
const SLIDES: { title: string; lines: string[]; speech: string[] }[] = [
  {
    title: 'O player de vídeo',
    lines: ['Atalhos para estudar sem tirar', 'as mãos do teclado'],
    speech: ['Esta aula mostra os atalhos do player.', 'Com eles, dá para estudar sem tirar as mãos do teclado.']
  },
  {
    title: 'Pausar e navegar',
    lines: ['Espaço ou K  ·  pausar e continuar', '← e →  ·  voltar ou avançar 10 segundos'],
    speech: ['A barra de espaço ou a tecla K pausa e continua o vídeo.', 'As setas para a esquerda e para a direita voltam ou avançam dez segundos.']
  },
  {
    title: 'Velocidade e volume',
    lines: ['[ e ]  ·  mais devagar ou mais rápido', '↑ e ↓  ·  volume      M  ·  sem som'],
    speech: ['Os colchetes mudam a velocidade: estudar a 1,25 ou 1,5 vez economiza tempo.', 'As setas para cima e para baixo mudam o volume, e a tecla M tira o som.']
  },
  {
    title: 'Tela cheia e janela flutuante',
    lines: ['F  ·  tela cheia', 'P  ·  janela flutuante, por cima de outros programas'],
    speech: ['A tecla F deixa o vídeo em tela cheia.', 'A tecla P abre a janela flutuante, que fica por cima dos outros programas enquanto você pratica.']
  },
  {
    title: 'Próxima aula e anotações',
    lines: ['Shift + N  ·  próxima aula', 'Anotações guardam o minuto do vídeo'],
    speech: ['Shift mais N passa para a próxima aula.', 'Na aba Anotações, cada nota guarda o minuto do vídeo: clicar nela volta para aquele ponto.']
  },
  {
    title: 'Legendas',
    lines: ['Esta legenda vem de um arquivo .srt', 'com o mesmo nome do vídeo'],
    speech: ['A legenda desta aula vem de um arquivo .srt com o mesmo nome do vídeo.', 'Ela também é o material que a IA lê para conversar sobre a aula e gerar flashcards.']
  }
]

const PDF_PAGES: string[][] = [
  [
    'Guia rápido do leitor de PDF',
    '',
    'PDFs abrem dentro do Tramotak, sem programa externo.',
    'Nada é escrito no arquivo: grifos e notas ficam no app.',
    '',
    'Navegação',
    '- Setas para os lados: página anterior e próxima.',
    '- Ctrl + roda do mouse: zoom.',
    '- Ajustar à largura: botão na barra do leitor.',
    '- Busca: procure qualquer palavra no texto do PDF.'
  ],
  [
    'Grifos e anotações',
    '',
    'Selecione um trecho para grifar em uma de quatro cores.',
    'Clique num grifo para trocar a cor, anotar ou remover.',
    '',
    'As anotações de um PDF guardam a página. Na tela',
    'Anotações, clicar nela abre o PDF naquela página.',
    '',
    'Experimente agora: grife esta frase e anote algo.'
  ],
  [
    'Concluir a aula',
    '',
    'Uma aula em PDF é concluída quando você chega',
    'à última página, como esta.',
    '',
    'Ao concluir, o app pode oferecer a revisão pós-aula:',
    'algumas perguntas rápidas sobre o conteúdo, feitas',
    'pela IA (se ela estiver configurada).',
    '',
    'PDFs anexados a uma aula de vídeo abrem no mesmo leitor.'
  ]
]

const pad = (n: number, size = 2) => String(n).padStart(size, '0')
const srtTime = (sec: number) => `${pad(Math.floor(sec / 3600))}:${pad(Math.floor(sec / 60) % 60)}:${pad(Math.floor(sec) % 60)},${pad(Math.round((sec % 1) * 1000), 3)}`
const assTime = (sec: number) => `${Math.floor(sec / 3600)}:${pad(Math.floor(sec / 60) % 60)}:${pad(Math.floor(sec) % 60)}.${pad(Math.round((sec % 1) * 100))}`

function buildSrt(): string {
  const cues: string[] = []
  SLIDES.forEach((slide, i) => {
    const step = SLIDE_SEC / slide.speech.length
    slide.speech.forEach((text, j) => {
      const start = i * SLIDE_SEC + j * step + 0.3
      cues.push(`${cues.length + 1}\n${srtTime(start)} --> ${srtTime(start + step - 0.5)}\n${text}\n`)
    })
  })
  return cues.join('\n')
}

function buildAss(): string {
  const events = SLIDES.flatMap((slide, i) => {
    const start = assTime(i * SLIDE_SEC)
    const end = assTime((i + 1) * SLIDE_SEC)
    return [
      `Dialogue: 0,${start},${end},Titulo,,0,0,0,,{\\fad(300,300)}${slide.title}`,
      `Dialogue: 0,${start},${end},Texto,,0,0,0,,{\\fad(300,300)}${slide.lines.join('\\N')}`,
      `Dialogue: 0,${start},${end},Rodape,,0,0,0,,Tramotak · curso de exemplo   ${i + 1}/${SLIDES.length}`
    ]
  })
  return `[Script Info]
ScriptType: v4.00+
PlayResX: 1280
PlayResY: 720

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Titulo,DejaVu Sans,64,&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,1,0,0,0,100,100,0,0,1,0,0,8,80,80,190,1
Style: Texto,DejaVu Sans,40,&H00F5C27A,&H00F5C27A,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,0,0,5,80,80,0,1
Style: Rodape,DejaVu Sans,22,&H00A0A0A0,&H00A0A0A0,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,0,0,2,80,80,40,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
${events.join('\n')}
`
}

const work = mkdtempSync(join(tmpdir(), 'tramotak-exemplo-'))
try {
  const ass = join(work, 'slides.ass')
  writeFileSync(ass, buildAss())
  const video = join(ROOT, '01. Primeiros passos', '02. O player de vídeo.mp4')
  const duration = SLIDES.length * SLIDE_SEC
  execFileSync(
    FFMPEG,
    [
      '-y', '-hide_banner', '-loglevel', 'error',
      '-f', 'lavfi', '-i', `color=c=0x15192b:s=1280x720:r=24:d=${duration}`,
      '-f', 'lavfi', '-i', `anullsrc=r=44100:cl=mono`,
      '-vf', `subtitles=${ass.replace(/[\\:']/g, '\\$&')}`,
      '-t', String(duration),
      '-c:v', 'libx264', '-preset', 'slow', '-crf', '28', '-pix_fmt', 'yuv420p', '-tune', 'stillimage',
      '-c:a', 'aac', '-b:a', '32k',
      '-movflags', '+faststart',
      video
    ],
    { stdio: 'inherit' }
  )
  writeFileSync(video.replace(/\.mp4$/, '.srt'), buildSrt())
  writeFileSync(join(ROOT, '02. Estudar com o material', '02. Guia rápido do leitor de PDF.pdf'), makePdf(PDF_PAGES))
  console.log('Curso de exemplo gerado em', ROOT)
} finally {
  rmSync(work, { recursive: true, force: true })
}
