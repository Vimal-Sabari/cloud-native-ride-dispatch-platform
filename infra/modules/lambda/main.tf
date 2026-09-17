# ==============================================================================
# Polyglot Lambda Infrastructure Module
# ==============================================================================
# This module will define an aws_lambda_function resource used across polyglot services:
#
# 1. Location Service (Go):
#    - Runtime: "provided.al2023" (AWS Linux 2023 custom runtime)
#    - Handler: "bootstrap"
#    - Artifact: Zipped standalone binary named "bootstrap" compiled via:
#      GOOS=linux GOARCH=amd64 CGO_ENABLED=0 go build -o bootstrap
#
# 2. Trip Service & Notification Service (TypeScript):
#    - Runtime: "nodejs20.x"
#    - Handler: "index.handler" (or service-specific handler)
#    - Artifact: Zipped bundle output generated via esbuild/tsc
#
# Both Go and TypeScript services share this exact module structure, parameterized
# through runtime, handler, and artifact_path variables.
#
# Resources will be populated in subsequent modules (Module 10 / Module 13).
# ==============================================================================
