# maic — Deployment Guide

## SSH into the server

```bash
ssh -i ~/.ssh/maic-prod.pem ec2-user@13.221.101.212
```

The key file lives at `~/.ssh/maic-prod.pem` on your local machine.

---

## EC2 Instance

| | |
|---|---|
| **IP** | `13.221.101.212` |
| **Instance ID** | `i-02a7b2cc367418aff` |
| **Type** | `t3.large` (2 vCPU, 8GB RAM) |
| **Region** | `us-east-1` |
| **OS** | Amazon Linux 2023 |
| **App URL** | http://13.221.101.212:3000 |

---

## First-time setup (already done)

```bash
# Clone repo
git clone https://github.com/mAIc-S-A-de-C-V/nexus-new-origins.git
cd nexus-new-origins

# Create secrets file
echo "ANTHROPIC_API_KEY=your-key" > .env

# Create frontend env (baked into Vite build)
cat > frontend/.env << 'EOF'
VITE_CONNECTOR_SERVICE_URL=http://13.221.101.212:8001
VITE_PIPELINE_SERVICE_URL=http://13.221.101.212:8002
VITE_INFERENCE_SERVICE_URL=http://13.221.101.212:8003
VITE_ONTOLOGY_SERVICE_URL=http://13.221.101.212:8004
VITE_EVENT_LOG_SERVICE_URL=http://13.221.101.212:8005
VITE_AUDIT_SERVICE_URL=http://13.221.101.212:8006
VITE_CORRELATION_ENGINE_URL=http://13.221.101.212:8008
EOF

# Build and start everything
sudo DOCKER_BUILDKIT=0 docker-compose up -d --build
```

---

## Manual redeploy

```bash
ssh -i ~/.ssh/maic-prod.pem ec2-user@13.221.101.212
cd nexus-new-origins
git pull
sudo DOCKER_BUILDKIT=0 docker-compose up -d --build
```

---

## Useful commands on the server

```bash
# See all running containers
sudo docker-compose ps

# See logs for a specific service
sudo docker-compose logs -f connector-service
sudo docker-compose logs -f frontend

# Restart a single service
sudo docker-compose restart connector-service

# Stop everything
sudo docker-compose down

# Stop and wipe all data (careful — deletes DB volumes)
sudo docker-compose down -v
```

---

## Services & Ports

| Service | Port |
|---|---|
| Frontend | 3000 |
| connector-service | 8001 |
| pipeline-service | 8002 |
| inference-service | 8003 |
| ontology-service | 8004 |
| event-log-service | 8005 |
| audit-service | 8006 |
| schema-registry | 8007 |
| correlation-engine | 8008 |

---

## Auto-deploy on push to main

Handled by GitHub Actions (`.github/workflows/deploy.yml`).

Every merge to `main` automatically SSHes into the EC2 server, pulls the latest code, and rebuilds.

**Required GitHub secrets** (set in repo Settings → Secrets → Actions):

| Secret | Value |
|---|---|
| `EC2_HOST` | `13.221.101.212` |
| `EC2_USER` | `ec2-user` |
| `EC2_SSH_KEY` | Contents of `~/.ssh/maic-prod.pem` |

---

## AWS credentials (local machine)

```bash
# Profile: maic-deploy
aws configure  # us-east-1, maic-deploy user

# Check who you are
aws sts get-caller-identity
```
