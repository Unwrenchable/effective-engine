# Real Estate Listings AI Agent

A conversational AI agent built with Microsoft Agent Framework to assist with real estate listings and property searches.

## Features

- Search for property listings by location, price, type, etc.
- Get detailed information about specific properties
- Access market trends and data
- Multi-turn conversations with session persistence
- HTTP server for web deployment
- Integration with your existing real estate app APIs

## Setup

1. **Prerequisites**:
   - Python 3.10+
   - Microsoft Foundry project with GPT-4o model deployed
   - Azure CLI installed and authenticated
   - Your real estate app running (for API integration)

2. **Environment Setup**:
   - Create a virtual environment: `python -m venv venv`
   - Activate: `source venv/bin/activate` (Linux/Mac) or `venv\Scripts\activate` (Windows)
   - Install dependencies: `pip install -r requirements.txt`

3. **Configuration**:
   - Update `.env` with your Foundry project endpoint and model deployment name
   - Ensure Azure authentication is configured (run `az login` if needed)
   - Update `APP_API_BASE` if your app runs on a different URL/port

## Usage

### HTTP Server
Run as a web service:
```bash
python main.py
```
The agent will be available at http://localhost:8080 (or the port configured by agentdev)

### Debugging
Use VS Code's Run and Debug panel with the provided launch configurations to debug with the Agent Inspector.

### API Integration
The agent tools call your app's APIs:
- `search_listings`: GET /listings with query parameters
- `get_listing_details`: GET /listings/{id}
- `get_market_data`: GET /market with location parameter

Ensure your app is running and the routes match these expectations.

## Deployment

To deploy to Microsoft Foundry:
1. Use the Microsoft Foundry extension in VS Code
2. Run the "Microsoft Foundry: Deploy Hosted Agent" command
3. Select your project and deploy

## Next Steps

- Customize the tools to match your exact API endpoints
- Add more specialized tools (AVM, compliance checks, etc.)
- Implement tracing for monitoring
- Add evaluation for performance assessment