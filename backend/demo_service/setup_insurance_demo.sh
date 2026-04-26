#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────
# setup_insurance_demo.sh
# Creates the full insurance/siniestros demo in Nexus:
#   - 3 connectors (policies, claims, submissions)
#   - 3 object types
#   - 3 pipelines (one per connector->object_type)
#   - 1 agent configured for coverage verification
#   - Runs all 3 pipelines to load data
#   - Links object types in the knowledge graph
# ─────────────────────────────────────────────────────────────────────────
set -euo pipefail

TENANT="tenant-seguros-demo"
CONNECTOR_API="http://localhost:8001"
ONTOLOGY_API="http://localhost:8004"
PIPELINE_API="http://localhost:8002"
AGENT_API="http://localhost:8013"
DEMO_API="http://localhost:8024"
H="Content-Type: application/json"
T="x-tenant-id: $TENANT"

echo "============================================"
echo "  NEXUS — Insurance Demo Setup"
echo "  Tenant: $TENANT"
echo "============================================"
echo ""

# ── 1. Create Connectors ─────────────────────────────────────────────────

echo "[1/7] Creating connectors..."

CONN_POLICIES=$(curl -s -X POST "$CONNECTOR_API/connectors" \
  -H "$H" -H "$T" \
  -d '{
    "name": "Repositorio de Polizas",
    "type": "REST_API",
    "category": "Insurance",
    "description": "500 polizas de seguro medico con 4 niveles de cobertura (Basico, Estandar, Premium, Platinum)",
    "base_url": "http://demo-service:8024/datasets/insurance-policies/records",
    "auth_type": "None",
    "config": {"response_path": "records", "pagination_strategy": "offset"}
  }' | python3 -c "import sys,json; print(json.load(sys.stdin).get('id',''))")

echo "  Polizas connector: $CONN_POLICIES"

CONN_CLAIMS=$(curl -s -X POST "$CONNECTOR_API/connectors" \
  -H "$H" -H "$T" \
  -d '{
    "name": "Reclamos de Seguros (Event Log)",
    "type": "REST_API",
    "category": "Insurance",
    "description": "Log de eventos del proceso de reclamos — 2000 casos, 16K+ eventos",
    "base_url": "http://demo-service:8024/datasets/insurance-claims/records",
    "auth_type": "None",
    "config": {"response_path": "records", "pagination_strategy": "offset"}
  }' | python3 -c "import sys,json; print(json.load(sys.stdin).get('id',''))")

echo "  Reclamos connector: $CONN_CLAIMS"

CONN_SUBMISSIONS=$(curl -s -X POST "$CONNECTOR_API/connectors" \
  -H "$H" -H "$T" \
  -d '{
    "name": "Solicitudes Medicas Pendientes",
    "type": "REST_API",
    "category": "Insurance",
    "description": "300 solicitudes de procedimientos medicos pendientes de verificacion de cobertura",
    "base_url": "http://demo-service:8024/datasets/insurance-medical-submissions/records",
    "auth_type": "None",
    "config": {"response_path": "records", "pagination_strategy": "offset"}
  }' | python3 -c "import sys,json; print(json.load(sys.stdin).get('id',''))")

echo "  Solicitudes connector: $CONN_SUBMISSIONS"

# ── 2. Create Object Types ───────────────────────────────────────────────

echo ""
echo "[2/7] Creating object types..."

OT_POLICIES=$(curl -s -X POST "$ONTOLOGY_API/object-types" \
  -H "$H" -H "$T" \
  -d '{
    "name": "Poliza",
    "display_name": "Poliza de Seguro",
    "tenant_id": "'"$TENANT"'",
    "description": "Contratos de seguro medico con detalle de coberturas, copagos, limites y exclusiones",
    "properties": [
      {"name": "policy_id", "display_name": "ID de Poliza", "semantic_type": "IDENTIFIER", "data_type": "string", "required": true},
      {"name": "holder_name", "display_name": "Nombre del Asegurado", "semantic_type": "PERSON_NAME", "data_type": "string"},
      {"name": "holder_age", "display_name": "Edad", "semantic_type": "QUANTITY", "data_type": "number"},
      {"name": "holder_id", "display_name": "DUI", "semantic_type": "IDENTIFIER", "data_type": "string"},
      {"name": "plan_type", "display_name": "Tipo de Plan", "semantic_type": "CATEGORY", "data_type": "string"},
      {"name": "tier", "display_name": "Nivel", "semantic_type": "CATEGORY", "data_type": "string"},
      {"name": "status", "display_name": "Estado", "semantic_type": "STATUS", "data_type": "string"},
      {"name": "start_date", "display_name": "Fecha Inicio", "semantic_type": "DATE", "data_type": "string"},
      {"name": "end_date", "display_name": "Fecha Fin", "semantic_type": "DATE", "data_type": "string"},
      {"name": "monthly_premium_usd", "display_name": "Prima Mensual (USD)", "semantic_type": "CURRENCY", "data_type": "number"},
      {"name": "annual_deductible_usd", "display_name": "Deducible Anual (USD)", "semantic_type": "CURRENCY", "data_type": "number"},
      {"name": "max_annual_coverage_usd", "display_name": "Cobertura Max Anual (USD)", "semantic_type": "CURRENCY", "data_type": "number"},
      {"name": "dependents_count", "display_name": "Dependientes", "semantic_type": "QUANTITY", "data_type": "number"},
      {"name": "covered_services", "display_name": "Servicios Cubiertos", "semantic_type": "TEXT", "data_type": "string"},
      {"name": "excluded_services", "display_name": "Servicios Excluidos", "semantic_type": "TEXT", "data_type": "string"},
      {"name": "exclusions", "display_name": "Exclusiones", "semantic_type": "TEXT", "data_type": "string"},
      {"name": "coverage_detail_json", "display_name": "Detalle de Cobertura (JSON)", "semantic_type": "TEXT", "data_type": "string"}
    ],
    "source_connector_ids": ["'"$CONN_POLICIES"'"],
    "position": {"x": 100, "y": 100}
  }' | python3 -c "import sys,json; print(json.load(sys.stdin).get('id',''))")

echo "  Poliza OT: $OT_POLICIES"

OT_CLAIMS=$(curl -s -X POST "$ONTOLOGY_API/object-types" \
  -H "$H" -H "$T" \
  -d '{
    "name": "ReclamoEvento",
    "display_name": "Evento de Reclamo",
    "tenant_id": "'"$TENANT"'",
    "description": "Log de eventos del proceso de reclamos de seguros para mineria de procesos",
    "properties": [
      {"name": "case_id", "display_name": "ID de Reclamo", "semantic_type": "IDENTIFIER", "data_type": "string", "required": true},
      {"name": "policy_id", "display_name": "ID de Poliza", "semantic_type": "IDENTIFIER", "data_type": "string"},
      {"name": "activity", "display_name": "Actividad", "semantic_type": "CATEGORY", "data_type": "string"},
      {"name": "timestamp", "display_name": "Fecha/Hora", "semantic_type": "DATETIME", "data_type": "string"},
      {"name": "resource", "display_name": "Recurso", "semantic_type": "TEXT", "data_type": "string"},
      {"name": "claim_category", "display_name": "Categoria del Reclamo", "semantic_type": "CATEGORY", "data_type": "string"},
      {"name": "diagnosis", "display_name": "Diagnostico", "semantic_type": "TEXT", "data_type": "string"},
      {"name": "claimed_amount_usd", "display_name": "Monto Reclamado (USD)", "semantic_type": "CURRENCY", "data_type": "number"},
      {"name": "tier", "display_name": "Nivel de Poliza", "semantic_type": "CATEGORY", "data_type": "string"},
      {"name": "provider", "display_name": "Proveedor Medico", "semantic_type": "TEXT", "data_type": "string"},
      {"name": "attending_doctor", "display_name": "Doctor Atendiente", "semantic_type": "PERSON_NAME", "data_type": "string"}
    ],
    "source_connector_ids": ["'"$CONN_CLAIMS"'"],
    "position": {"x": 400, "y": 100}
  }' | python3 -c "import sys,json; print(json.load(sys.stdin).get('id',''))")

echo "  ReclamoEvento OT: $OT_CLAIMS"

OT_SUBMISSIONS=$(curl -s -X POST "$ONTOLOGY_API/object-types" \
  -H "$H" -H "$T" \
  -d '{
    "name": "SolicitudMedica",
    "display_name": "Solicitud Medica",
    "tenant_id": "'"$TENANT"'",
    "description": "Solicitudes de procedimientos medicos pendientes de verificacion de cobertura",
    "properties": [
      {"name": "submission_id", "display_name": "ID de Solicitud", "semantic_type": "IDENTIFIER", "data_type": "string", "required": true},
      {"name": "policy_id", "display_name": "ID de Poliza", "semantic_type": "IDENTIFIER", "data_type": "string"},
      {"name": "patient_name", "display_name": "Nombre del Paciente", "semantic_type": "PERSON_NAME", "data_type": "string"},
      {"name": "category", "display_name": "Categoria", "semantic_type": "CATEGORY", "data_type": "string"},
      {"name": "diagnosis", "display_name": "Diagnostico", "semantic_type": "TEXT", "data_type": "string"},
      {"name": "procedure_description", "display_name": "Descripcion del Procedimiento", "semantic_type": "TEXT", "data_type": "string"},
      {"name": "estimated_cost_usd", "display_name": "Costo Estimado (USD)", "semantic_type": "CURRENCY", "data_type": "number"},
      {"name": "provider", "display_name": "Proveedor", "semantic_type": "TEXT", "data_type": "string"},
      {"name": "attending_doctor", "display_name": "Doctor", "semantic_type": "PERSON_NAME", "data_type": "string"},
      {"name": "urgency", "display_name": "Urgencia", "semantic_type": "CATEGORY", "data_type": "string"},
      {"name": "status", "display_name": "Estado", "semantic_type": "STATUS", "data_type": "string"},
      {"name": "submission_date", "display_name": "Fecha de Solicitud", "semantic_type": "DATE", "data_type": "string"},
      {"name": "notes", "display_name": "Notas", "semantic_type": "TEXT", "data_type": "string"}
    ],
    "source_connector_ids": ["'"$CONN_SUBMISSIONS"'"],
    "position": {"x": 700, "y": 100}
  }' | python3 -c "import sys,json; print(json.load(sys.stdin).get('id',''))")

echo "  SolicitudMedica OT: $OT_SUBMISSIONS"

# ── 3. Create Pipelines ──────────────────────────────────────────────────

echo ""
echo "[3/7] Creating pipelines..."

PL_POLICIES=$(curl -s -X POST "$PIPELINE_API/pipelines" \
  -H "$H" -H "$T" \
  -d '{
    "name": "Carga de Polizas",
    "tenant_id": "'"$TENANT"'",
    "description": "Ingesta de repositorio de polizas desde demo-service",
    "connector_ids": ["'"$CONN_POLICIES"'"],
    "target_object_type_id": "'"$OT_POLICIES"'",
    "nodes": [
      {"id": "source-1", "type": "SOURCE", "label": "Polizas API", "config": {"connector_id": "'"$CONN_POLICIES"'", "fetch_mode": "on_demand"}, "connector_id": "'"$CONN_POLICIES"'", "position": {"x": 200, "y": 200}},
      {"id": "sink-1", "type": "SINK_OBJECT", "label": "Guardar Polizas", "config": {"object_type_id": "'"$OT_POLICIES"'", "pk_field": "policy_id"}, "object_type_id": "'"$OT_POLICIES"'", "position": {"x": 200, "y": 400}}
    ],
    "edges": [
      {"id": "e1", "source": "source-1", "target": "sink-1"}
    ]
  }' | python3 -c "import sys,json; print(json.load(sys.stdin).get('id',''))")

echo "  Polizas pipeline: $PL_POLICIES"

PL_CLAIMS=$(curl -s -X POST "$PIPELINE_API/pipelines" \
  -H "$H" -H "$T" \
  -d '{
    "name": "Carga de Reclamos (Event Log)",
    "tenant_id": "'"$TENANT"'",
    "description": "Ingesta de log de eventos de reclamos para mineria de procesos",
    "connector_ids": ["'"$CONN_CLAIMS"'"],
    "target_object_type_id": "'"$OT_CLAIMS"'",
    "nodes": [
      {"id": "source-1", "type": "SOURCE", "label": "Reclamos API", "config": {"connector_id": "'"$CONN_CLAIMS"'", "fetch_mode": "on_demand"}, "connector_id": "'"$CONN_CLAIMS"'", "position": {"x": 200, "y": 200}},
      {"id": "sink-1", "type": "SINK_OBJECT", "label": "Guardar Eventos", "config": {"object_type_id": "'"$OT_CLAIMS"'", "pk_field": "case_id", "dedupe_strategy": "none"}, "object_type_id": "'"$OT_CLAIMS"'", "position": {"x": 200, "y": 400}}
    ],
    "edges": [
      {"id": "e1", "source": "source-1", "target": "sink-1"}
    ]
  }' | python3 -c "import sys,json; print(json.load(sys.stdin).get('id',''))")

echo "  Reclamos pipeline: $PL_CLAIMS"

PL_SUBMISSIONS=$(curl -s -X POST "$PIPELINE_API/pipelines" \
  -H "$H" -H "$T" \
  -d '{
    "name": "Carga de Solicitudes Medicas",
    "tenant_id": "'"$TENANT"'",
    "description": "Ingesta de solicitudes de procedimientos medicos pendientes",
    "connector_ids": ["'"$CONN_SUBMISSIONS"'"],
    "target_object_type_id": "'"$OT_SUBMISSIONS"'",
    "nodes": [
      {"id": "source-1", "type": "SOURCE", "label": "Solicitudes API", "config": {"connector_id": "'"$CONN_SUBMISSIONS"'", "fetch_mode": "on_demand"}, "connector_id": "'"$CONN_SUBMISSIONS"'", "position": {"x": 200, "y": 200}},
      {"id": "sink-1", "type": "SINK_OBJECT", "label": "Guardar Solicitudes", "config": {"object_type_id": "'"$OT_SUBMISSIONS"'", "pk_field": "submission_id"}, "object_type_id": "'"$OT_SUBMISSIONS"'", "position": {"x": 200, "y": 400}}
    ],
    "edges": [
      {"id": "e1", "source": "source-1", "target": "sink-1"}
    ]
  }' | python3 -c "import sys,json; print(json.load(sys.stdin).get('id',''))")

echo "  Solicitudes pipeline: $PL_SUBMISSIONS"

# ── 4. Run Pipelines ─────────────────────────────────────────────────────

echo ""
echo "[4/7] Running pipelines to load data..."

for PL_ID in "$PL_POLICIES" "$PL_CLAIMS" "$PL_SUBMISSIONS"; do
  echo "  Running pipeline $PL_ID..."
  curl -s -X POST "$PIPELINE_API/pipelines/$PL_ID/run" \
    -H "$H" -H "$T" > /dev/null 2>&1
done

echo "  Waiting 15 seconds for pipelines to complete..."
sleep 15

# Check record counts
echo ""
echo "[5/7] Verifying data loaded..."

for OT_ID in "$OT_POLICIES" "$OT_CLAIMS" "$OT_SUBMISSIONS"; do
  COUNT=$(curl -s "$ONTOLOGY_API/object-types/$OT_ID/records?limit=1" -H "$T" \
    | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('total', d.get('count', len(d.get('records',[])))))" 2>/dev/null || echo "?")
  echo "  $OT_ID: $COUNT records"
done

# ── 6. Create Graph Links ────────────────────────────────────────────────

echo ""
echo "[6/7] Creating knowledge graph links..."

# Poliza -> ReclamoEvento (one-to-many via policy_id)
curl -s -X POST "$ONTOLOGY_API/graph/edges" \
  -H "$H" -H "$T" \
  -d '{
    "source_object_type_id": "'"$OT_POLICIES"'",
    "target_object_type_id": "'"$OT_CLAIMS"'",
    "relation_type": "has_many",
    "join_source_field": "policy_id",
    "join_target_field": "policy_id",
    "label": "Reclamos de esta poliza"
  }' > /dev/null 2>&1 && echo "  Poliza -> ReclamoEvento: linked" || echo "  Poliza -> ReclamoEvento: (may already exist)"

# Poliza -> SolicitudMedica (one-to-many via policy_id)
curl -s -X POST "$ONTOLOGY_API/graph/edges" \
  -H "$H" -H "$T" \
  -d '{
    "source_object_type_id": "'"$OT_POLICIES"'",
    "target_object_type_id": "'"$OT_SUBMISSIONS"'",
    "relation_type": "has_many",
    "join_source_field": "policy_id",
    "join_target_field": "policy_id",
    "label": "Solicitudes de esta poliza"
  }' > /dev/null 2>&1 && echo "  Poliza -> SolicitudMedica: linked" || echo "  Poliza -> SolicitudMedica: (may already exist)"

echo "  Done."

# ── 7. Create Coverage Verification Agent ─────────────────────────────────

echo ""
echo "[7/7] Creating coverage verification agent..."

AGENT_ID=$(curl -s -X POST "$AGENT_API/agents" \
  -H "$H" -H "$T" \
  -d '{
    "name": "Verificador de Cobertura",
    "description": "Agente que verifica si un procedimiento medico esta cubierto por la poliza del asegurado. Consulta el repositorio de polizas y responde con detalle de cobertura, copago y limites.",
    "model": "claude-sonnet-4-6",
    "system_prompt": "Eres un agente verificador de cobertura de seguros medicos. Tu trabajo es determinar si un procedimiento medico esta cubierto por la poliza del asegurado.\n\nPROCESO:\n1. Cuando te pregunten sobre una solicitud medica, primero usa query_records en SolicitudMedica para obtener los detalles de la solicitud (busca por submission_id o patient_name).\n2. Con el policy_id de la solicitud, usa query_records en Poliza para obtener el contrato completo del asegurado.\n3. Revisa el campo coverage_detail_json de la poliza — este tiene el detalle exacto de que esta cubierto, el porcentaje de copago, y el limite anual por categoria.\n4. Compara la categoria del procedimiento solicitado con la cobertura de la poliza.\n5. Responde con:\n   - SI esta cubierto o NO\n   - Porcentaje de copago que paga el asegurado\n   - Limite anual disponible\n   - Monto estimado que cubre la aseguradora vs lo que paga el paciente\n   - Si hay exclusiones aplicables\n   - Estado de la poliza (vigente/vencida/cancelada)\n\nIMPORTANTE:\n- Si la poliza esta vencida o cancelada, el procedimiento NO esta cubierto independientemente del plan.\n- Si la categoria no aparece como cubierta en el JSON de cobertura, esta EXCLUIDA del plan.\n- Siempre menciona el nivel de la poliza (Basico, Estandar, Premium, Platinum).\n- Responde en espanol.\n- Se preciso con los montos y porcentajes.\n- Si te piden analizar multiples solicitudes o hacer un reporte general, usa count_records y query_records para generar estadisticas.\n\nTambien puedes:\n- Analizar tendencias en reclamos usando los datos de ReclamoEvento\n- Identificar los diagnosticos mas frecuentes\n- Calcular montos totales reclamados por categoria\n- Detectar patrones de fraude o anomalias",
    "enabled_tools": ["list_object_types", "get_object_schema", "query_records", "count_records"],
    "max_iterations": 8,
    "enabled": true
  }' | python3 -c "import sys,json; print(json.load(sys.stdin).get('id',''))")

echo "  Agent: $AGENT_ID"

# ── Done ──────────────────────────────────────────────────────────────────

echo ""
echo "============================================"
echo "  Insurance demo setup complete!"
echo "============================================"
echo ""
echo "  Tenant:      $TENANT"
echo "  Connectors:  $CONN_POLICIES, $CONN_CLAIMS, $CONN_SUBMISSIONS"
echo "  Object Types: $OT_POLICIES, $OT_CLAIMS, $OT_SUBMISSIONS"
echo "  Pipelines:   $PL_POLICIES, $PL_CLAIMS, $PL_SUBMISSIONS"
echo "  Agent:       $AGENT_ID"
echo ""
echo "  Demo queries for the agent:"
echo '    "La solicitud SUB-30005, esta cubierta?"'
echo '    "Cuantas solicitudes pendientes hay por categoria?"'
echo '    "Cuantos reclamos fueron denegados y por que?"'
echo '    "Que procedimientos NO cubre el plan Basico?"'
echo '    "Dame un resumen de la poliza POL-10050"'
echo ""
