#!/usr/bin/env bash
# Setup log shipping to a remote aggregator (Elasticsearch/CloudWatch/Splunk)
# ISO 27001 Annex A.8.15 — Logging
#
# This script installs and configures Filebeat to ship Docker logs to Elasticsearch.
# For CloudWatch, use the CloudWatch Logs agent instead.
# For Splunk, use the Splunk Universal Forwarder.
#
# Usage: ./setup-log-shipping.sh [elasticsearch|cloudwatch|splunk]
set -euo pipefail

TARGET="${1:-elasticsearch}"
NEXUS_DIR="$(cd "$(dirname "$0")/.." && pwd)"

case "$TARGET" in
elasticsearch)
    cat > /etc/filebeat/filebeat.yml << EOF
filebeat.inputs:
- type: container
  paths:
    - /var/lib/docker/containers/*/*-json.log
  processors:
    - add_docker_metadata: ~
    - decode_json_fields:
        fields: ["message"]
        target: ""
        overwrite_keys: true

output.elasticsearch:
  hosts: ["\${ELASTICSEARCH_URL:-http://localhost:9200}"]
  index: "nexus-logs-%{+yyyy.MM.dd}"
  username: "\${ELASTICSEARCH_USER:-}"
  password: "\${ELASTICSEARCH_PASS:-}"

setup.template.name: "nexus"
setup.template.pattern: "nexus-logs-*"
EOF
    echo "Filebeat config written. Start with: sudo systemctl start filebeat"
    ;;

cloudwatch)
    cat > /opt/aws/amazon-cloudwatch-agent/etc/amazon-cloudwatch-agent.json << EOF
{
  "logs": {
    "logs_collected": {
      "files": {
        "collect_list": [
          {
            "file_path": "/var/lib/docker/containers/*/*.log",
            "log_group_name": "nexus-platform",
            "log_stream_name": "{hostname}/{container_name}",
            "timezone": "UTC",
            "timestamp_format": "%Y-%m-%dT%H:%M:%S"
          }
        ]
      }
    }
  }
}
EOF
    echo "CloudWatch agent config written."
    echo "Start with: sudo /opt/aws/amazon-cloudwatch-agent/bin/amazon-cloudwatch-agent-ctl -a start"
    ;;

splunk)
    echo "For Splunk, install the Splunk Universal Forwarder and configure:"
    echo "  inputs.conf: [monitor:///var/lib/docker/containers/*/*-json.log]"
    echo "  outputs.conf: [tcpout] defaultGroup = splunk_indexers"
    ;;

*)
    echo "Unknown target: $TARGET"
    echo "Usage: $0 [elasticsearch|cloudwatch|splunk]"
    exit 1
    ;;
esac
