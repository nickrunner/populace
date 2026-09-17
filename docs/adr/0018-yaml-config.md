# ADR-0018: Configuration is a single YAML file validated by zod

**Status:** accepted

## Decision

`populace.yaml` holds target, identity provider, model, guardrails, schedule, store path and population. Personas may be inline or `file:` references. `populace validate` parses with the core schema and connects to the target to list tools. Environment variables are referenced as `${VAR}` and substituted before parsing so bearer tokens stay out of the file.

