# Grafana

A Flows app for Grafana. Works with self-hosted instances and Grafana Cloud.

## Blocks

- **Query Datasource**: Run a query against any Grafana datasource (Prometheus, Loki, SQL, Tempo, and others) and get the results back.
- **Alert Rule**: Create a Grafana alert rule from a flow. The rule is provisioned in Grafana and kept in sync with the block config.
- **Contact Point**: Provision a webhook contact point in Grafana that sends alerts into your flow. Attach it to a notification policy to start receiving alerts.
- **HTTP Request**: Call any Grafana API endpoint directly, for anything the other blocks don't cover.

## Setup

You'll need:

1. Your Grafana instance URL (e.g. `https://myorg.grafana.net` or `https://grafana.example.com`).
2. A service account token. In Grafana, go to Administration, then Users and access, then Service accounts. Create a service account and add a token. Copy the token right away because Grafana only shows it once.

Install the app in Flows, fill in those two fields, and you're good to go.
