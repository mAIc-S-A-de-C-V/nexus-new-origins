#!/usr/bin/env bash
# Short narration that fits the ~80s video
set -euo pipefail

OUTDIR="results/demo-video/narration-short"
VOICE="Paulina"
RATE=175
mkdir -p "$OUTDIR"

echo "Generating short narration segments..."

# Scene 1: Intro + Login (0s - 5s)
say -v "$VOICE" -r $RATE -o "$OUTDIR/01.aiff" "Nexus. Plataforma de inteligencia empresarial. Demo de seguros médicos."

# Scene 2: Connectors (5s - 15s)
say -v "$VOICE" -r $RATE -o "$OUTDIR/02.aiff" "Tres conectores configurados: pólizas, reclamos y solicitudes médicas. Cada uno extrae datos de forma automática."

# Scene 3: Connector detail (15s - 22s)
say -v "$VOICE" -r $RATE -o "$OUTDIR/03.aiff" "El repositorio de pólizas contiene 500 contratos con detalle de cobertura."

# Scene 4: Ontology (22s - 33s)
say -v "$VOICE" -r $RATE -o "$OUTDIR/04.aiff" "La ontología muestra los tipos de objeto y sus relaciones. Pólizas vinculadas con reclamos y solicitudes."

# Scene 5: Data Explorer (33s - 42s)
say -v "$VOICE" -r $RATE -o "$OUTDIR/05.aiff" "El explorador de datos permite consultar y filtrar toda la información sin código."

# Scene 6: Pipelines (42s - 50s)
say -v "$VOICE" -r $RATE -o "$OUTDIR/06.aiff" "Pipelines visuales transforman y cargan datos automáticamente."

# Scene 7: Agent (50s - 58s)
say -v "$VOICE" -r $RATE -o "$OUTDIR/07.aiff" "El agente verificador de cobertura. Tiene acceso directo a pólizas y solicitudes."

# Scene 8: Agent query (58s - 65s)
say -v "$VOICE" -r $RATE -o "$OUTDIR/08.aiff" "Le preguntamos si la solicitud está cubierta. El agente consulta, analiza, y responde."

# Scene 9: Closing (65s - 79s)
say -v "$VOICE" -r $RATE -o "$OUTDIR/09.aiff" "Nexus: datos, inteligencia artificial y automatización en una sola plataforma. Desplegado en tu infraestructura."

echo "Converting and concatenating..."

# Convert all to WAV
for f in "$OUTDIR"/*.aiff; do
  base=$(basename "$f" .aiff)
  ffmpeg -y -i "$f" -ar 44100 -ac 1 "$OUTDIR/${base}.wav" 2>/dev/null
done

# Silence
ffmpeg -y -f lavfi -i anullsrc=r=44100:cl=mono -t 1.5 "$OUTDIR/gap.wav" 2>/dev/null
ffmpeg -y -f lavfi -i anullsrc=r=44100:cl=mono -t 2.5 "$OUTDIR/gap_long.wav" 2>/dev/null

cat > "$OUTDIR/concat.txt" << 'EOF'
file 'gap.wav'
file '01.wav'
file 'gap.wav'
file '02.wav'
file 'gap.wav'
file '03.wav'
file 'gap.wav'
file '04.wav'
file 'gap.wav'
file '05.wav'
file 'gap.wav'
file '06.wav'
file 'gap.wav'
file '07.wav'
file 'gap.wav'
file '08.wav'
file 'gap_long.wav'
file '09.wav'
file 'gap_long.wav'
EOF

ffmpeg -y -f concat -safe 0 -i "$OUTDIR/concat.txt" -c copy "$OUTDIR/full_narration.wav" 2>/dev/null

DURATION=$(ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "$OUTDIR/full_narration.wav" 2>/dev/null)
echo "Narration: ${DURATION}s"
