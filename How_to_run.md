
# Typeahead System

## Overview

This project runs a small full-stack demo with:

- a React frontend on port 5173
- an Express backend on port 3001
- PostgreSQL on host port 5433
- two Redis containers on ports 6379 and 6380

## Prerequisites

Install the following before starting:

| Tool | Minimum version | Check command |
| --- | --- | --- |
| Docker Desktop | Latest | `docker --version` |
| Docker Compose | v2+ | `docker compose version` |
| Node.js | v18+ | `node --version` |

## Run With Docker

1. Open a terminal in the project folder.

```bash
cd ~/Desktop/"Typeahead System"
```

2. Make sure Docker Desktop is running.

```bash
systemctl --user start docker-desktop
docker ps
```

If `docker ps` shows a table header, Docker is ready.

3. Switch to the Docker Desktop context once on your machine.

```bash
docker context use desktop-linux
```

4. Start the full stack.

```bash
docker compose up --build
```

Use `docker compose up --build -d` if you want detached mode.

The first run pulls the base images and builds both app images. Later runs are much faster unless code has changed.

5. Wait for the containers to become healthy.

You should see the services come up in this order:

- `typeahead-redis-1` healthy
- `typeahead-redis-2` healthy
- `typeahead-postgres` healthy
- `typeahead-backend` started
- `typeahead-frontend` started

6. Open the app.

| Service | URL | What to expect |
| --- | --- | --- |
| Frontend | http://localhost:5173 | React/Vite app |
| Backend health check | http://localhost:3001/health | `{ "status": "ok" }` |
| Connection test | http://localhost:3001/test-connections | Postgres and Redis reachability |

## Stop the App

If the stack is running in the foreground, press `Ctrl+C` and then run:

```bash
docker compose down
```

If you started it in detached mode, the same command stops everything:

```bash
docker compose down
```

To remove the Postgres volume as well, use:

```bash
docker compose down --volumes
```

## Day-to-Day Workflow

```bash
# Start
docker compose up -d

# Stop
docker compose down

# View logs from all containers
docker compose logs -f

# View logs from one container
docker compose logs -f backend
```

## Notes For This Machine

- Postgres uses host port 5433 instead of 5432 because a local Postgres instance is already running on 5432.
- The containers still talk to each other internally on 5432.
- If port 6379 is already in use, a local Redis instance may be running. Stop it with `sudo systemctl stop redis` before starting the stack.