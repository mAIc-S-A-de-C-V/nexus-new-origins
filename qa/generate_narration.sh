#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────
# generate_narration.sh
# Generates TTS narration segments for the insurance demo video.
# Uses macOS `say` with Paulina (Mexican Spanish) voice.
# Each segment is timed to match the Playwright video scenes.
# ─────────────────────────────────────────────────────────────────────────
set -euo pipefail

OUTDIR="results/demo-video/narration"
VOICE="Paulina"
RATE=155
mkdir -p "$OUTDIR"

echo "Generating narration segments..."

# Scene 1: Intro (0s - 4s)
say -v "$VOICE" -r $RATE -o "$OUTDIR/01_intro.aiff" "Bienvenidos a Nexus, la plataforma de inteligencia empresarial. Hoy les mostraremos como funciona con un caso real de seguros médicos."

# Scene 2: Connectors (4s - 15s)
say -v "$VOICE" -r $RATE -o "$OUTDIR/02_connectors.aiff" "Comenzamos con los conectores de datos. Aquí vemos tres conectores configurados para nuestro sistema de seguros: el repositorio de pólizas con 500 contratos, el log de reclamos con más de 16 mil eventos, y las solicitudes médicas pendientes."

# Scene 3: Connector detail (15s - 22s)
say -v "$VOICE" -r $RATE -o "$OUTDIR/03_connector_detail.aiff" "Cada conector se configura desde la interfaz. Define la fuente de datos, la autenticación, y la paginación. Sin código."

# Scene 4: Ontology (22s - 33s)
say -v "$VOICE" -r $RATE -o "$OUTDIR/04_ontology.aiff" "En la ontología vemos los tipos de objeto creados: Póliza, Evento de Reclamo, y Solicitud Médica. Cada uno tiene su esquema definido con propiedades tipadas. Aquí podemos ver las 500 pólizas cargadas con sus niveles de cobertura: Básico, Estándar, Premium y Platinum."

# Scene 5: Data Explorer (33s - 44s)
say -v "$VOICE" -r $RATE -o "$OUTDIR/05_data_explorer.aiff" "Desde el explorador de datos cualquier usuario puede consultar, filtrar y analizar la información. Vemos las pólizas con sus primas mensuales, deducibles, y servicios cubiertos. Todo unificado en un solo lugar."

# Scene 6: Pipelines (44s - 55s)
say -v "$VOICE" -r $RATE -o "$OUTDIR/06_pipelines.aiff" "Los pipelines transforman y cargan datos automáticamente. Cada pipeline es una cadena de pasos visuales: desde la fuente de datos, pasando por clasificación con inteligencia artificial, hasta el destino final en la ontología."

# Scene 7: Agent intro (55s - 65s)
say -v "$VOICE" -r $RATE -o "$OUTDIR/07_agent_intro.aiff" "Ahora viene lo más interesante: el agente de verificación de cobertura. Este agente tiene acceso a herramientas que le permiten consultar pólizas, solicitudes y reclamos directamente desde la base de datos."

# Scene 8: Agent query (65s - 75s)
say -v "$VOICE" -r $RATE -o "$OUTDIR/08_agent_query.aiff" "Le preguntamos: la solicitud SUB 30005, está cubierta por su póliza? Observen como el agente trabaja."

# Scene 9: Agent response (75s - 100s)
say -v "$VOICE" -r $RATE -o "$OUTDIR/09_agent_response.aiff" "El agente consultó automáticamente la solicitud médica, encontró la póliza vinculada, analizó el detalle de cobertura, y determinó que el servicio de laboratorio sí está incluido en el plan Premium, pero la póliza está vencida. Por lo tanto, el procedimiento no está cubierto. Todo esto sin intervención humana."

# Scene 10: Process Mining (100s - 115s)
say -v "$VOICE" -r $RATE -o "$OUTDIR/10_process_mining.aiff" "Con la minería de procesos podemos visualizar cómo fluyen los reclamos. Nexus descubre automáticamente las 8 variantes del proceso: desde la aprobación directa, pasando por solicitudes de documentación adicional, hasta investigaciones de fraude y apelaciones."

# Scene 11: Graph (115s - 125s)
say -v "$VOICE" -r $RATE -o "$OUTDIR/11_graph.aiff" "El grafo de conocimiento muestra las relaciones entre los datos. Cada póliza se vincula con sus reclamos y solicitudes médicas, permitiendo trazabilidad completa de principio a fin."

# Scene 12: Closing (125s - 140s)
say -v "$VOICE" -r $RATE -o "$OUTDIR/12_closing.aiff" "Esto es Nexus: una plataforma completa donde los datos, la inteligencia artificial y la automatización trabajan juntos. No es un chatbot. Es un sistema que consulta, analiza y actúa. Desplegado en tu infraestructura, con tus datos, bajo tu control."

echo ""
echo "Converting to WAV..."

for f in "$OUTDIR"/*.aiff; do
  base=$(basename "$f" .aiff)
  ffmpeg -y -i "$f" -ar 44100 -ac 1 "$OUTDIR/${base}.wav" 2>/dev/null
  echo "  $base.wav"
done

echo ""
echo "Generating silence padding..."
# Generate silence segments for gaps
ffmpeg -y -f lavfi -i anullsrc=r=44100:cl=mono -t 2 "$OUTDIR/silence_2s.wav" 2>/dev/null
ffmpeg -y -f lavfi -i anullsrc=r=44100:cl=mono -t 3 "$OUTDIR/silence_3s.wav" 2>/dev/null
ffmpeg -y -f lavfi -i anullsrc=r=44100:cl=mono -t 4 "$OUTDIR/silence_4s.wav" 2>/dev/null

echo ""
echo "Concatenating full narration..."

# Build concat file
cat > "$OUTDIR/concat.txt" << 'EOF'
file 'silence_2s.wav'
file '01_intro.wav'
file 'silence_3s.wav'
file '02_connectors.wav'
file 'silence_2s.wav'
file '03_connector_detail.wav'
file 'silence_3s.wav'
file '04_ontology.wav'
file 'silence_3s.wav'
file '05_data_explorer.wav'
file 'silence_3s.wav'
file '06_pipelines.wav'
file 'silence_3s.wav'
file '07_agent_intro.wav'
file 'silence_2s.wav'
file '08_agent_query.wav'
file 'silence_4s.wav'
file '09_agent_response.wav'
file 'silence_3s.wav'
file '10_process_mining.wav'
file 'silence_3s.wav'
file '11_graph.wav'
file 'silence_3s.wav'
file '12_closing.wav'
file 'silence_4s.wav'
EOF

ffmpeg -y -f concat -safe 0 -i "$OUTDIR/concat.txt" -c copy "$OUTDIR/full_narration.wav" 2>/dev/null

DURATION=$(ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "$OUTDIR/full_narration.wav" 2>/dev/null)
echo "Full narration: ${DURATION}s"

echo ""
echo "Done! Narration at: $OUTDIR/full_narration.wav"
