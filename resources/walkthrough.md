# Getting Started with LLM Endpoint Switchboard

This walkthrough will guide you through setting up the LLM Endpoint Switchboard to route your AI coding assistants to a custom LLM endpoint.

## Prerequisites

- VS Code 1.85.0 or later
- At least one supported AI coding assistant installed (Cline, Continue, etc.)
- Access to an OpenAI-compatible LLM endpoint (AIdome or similar)
- API key for your endpoint

## Step-by-Step Guide

### 1. Install the Extension

The extension should already be installed if you're reading this!

### 2. Launch Setup Wizard

1. Open Command Palette: `Ctrl+Shift+P` (Windows/Linux) or `Cmd+Shift+P` (Mac)
2. Type: `AIdome: Setup Endpoint Switchboard`
3. Press Enter

### 3. Follow the Wizard

The wizard will:

- Detect installed AI assistants
- Help you create an endpoint profile
- Configure selected assistants
- Verify the configuration works

### 4. Verify Configuration

After setup completes:

1. Run: `AIdome: Verify All Profile Routes`
2. Check that all assistants show as configured
3. Test with your AI assistant of choice

### 5. Start Coding

Your AI assistants are now configured to use your custom endpoint. Continue using them as normal!

## Next Steps

- Create additional profiles for different environments
- Explore available models with `Show Models & Providers`
- Join our community for tips and best practices

## Need Help?

- Check the [main README](../README.md) for troubleshooting
- Export diagnostics for support requests
- Visit our [documentation](https://docs.aidome.io/switchboard)
