# Real Estate AI Agent

A conversational AI agent built with Microsoft Agent Framework to assist with real estate tasks.

## Features

- Property listing search
- Market trend analysis
- Neighborhood information
- Multi-turn conversations with session persistence
- HTTP server for web deployment

## Setup

1. **Prerequisites**:
   - Python 3.10+
   - Microsoft Foundry project with GPT-4o model deployed
   - Azure CLI installed and authenticated

2. **Environment Setup**:
   - Create a virtual environment: `python -m venv venv`
   - Activate: `source venv/bin/activate` (Linux/Mac) or `venv\Scripts\activate` (Windows)
   - Install dependencies: `pip install -r requirements.txt`

3. **Configuration**:
   - Update `.env` with your Foundry project endpoint and model deployment name
   - Ensure Azure authentication is configured (run `az login` if needed)

## Usage

### Local Testing
Run the interactive agent:
```bash
python main.py
```

### HTTP Server
Run as a web service:
```bash
python agent_server.py
```
The agent will be available at http://localhost:8000

### Debugging
Use VS Code's Run and Debug panel with the provided launch configurations.

## API Endpoints

When running as server:
- `POST /chat` - Send messages to the agent
- `GET /health` - Health check

## Deployment

To deploy to Microsoft Foundry:
1. Use the Microsoft Foundry extension in VS Code
2. Run the "Microsoft Foundry: Deploy Hosted Agent" command
3. Select your project and deploy

## Next Steps

- Integrate with your existing real estate app APIs for real data
- Add more specialized tools (AVM, compliance checks, etc.)
- Implement tracing for monitoring
- Add evaluation for performance assessment