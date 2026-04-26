import os
from dotenv import load_dotenv
from agent_framework import Agent
from agent_framework.foundry import FoundryChatClient
from azure.identity import DefaultAzureCredential
from azure.ai.agentserver import AgentServer

# Load environment variables
load_dotenv()

def create_real_estate_agent():
    """Create and return the real estate agent."""
    # Initialize Foundry client
    client = FoundryChatClient(
        project_endpoint=os.getenv("FOUNDRY_PROJECT_ENDPOINT"),
        model=os.getenv("FOUNDRY_MODEL_DEPLOYMENT_NAME"),
        credential=DefaultAzureCredential(),
    )

    # Define tools for real estate tasks
    def get_listing_info(location: str, property_type: str = "house") -> str:
        """Get information about property listings in a specific location."""
        return f"Found 5 {property_type} listings in {location}. Average price: $500,000. Contact your local agent for details."

    def get_market_trends(location: str, timeframe: str = "last_quarter") -> str:
        """Get market trends and analysis for a specific location."""
        trends = {
            "last_month": "Market is stable with slight price increase of 2%.",
            "last_quarter": "Prices up 5%, inventory down 10%. Seller's market.",
            "last_year": "Annual growth of 8%, strong demand in {location}."
        }
        return f"Market trends for {location} ({timeframe}): {trends.get(timeframe, 'Data not available.')}"

    def get_neighborhood_info(neighborhood: str) -> str:
        """Get information about a specific neighborhood."""
        info = {
            "downtown": "Urban area with high walkability, diverse amenities, average commute 15 min.",
            "suburbs": "Family-friendly with good schools, parks, average commute 25 min.",
            "waterfront": "Premium location with scenic views, luxury properties, average commute 20 min."
        }
        return f"Neighborhood info for {neighborhood}: {info.get(neighborhood.lower(), 'Information not available. Please provide more details.')}"

    # Create the agent
    agent = Agent(
        client,
        name="RealEstateAgent",
        instructions="""
        You are a helpful real estate assistant. Help users with:
        - Finding property listings
        - Understanding market trends
        - Getting neighborhood information
        - Answering real estate questions
        - Providing guidance on buying/selling/renting properties

        Always be professional, accurate, and helpful. Use the available tools to provide specific information.
        If you don't have specific data, suggest next steps or ask for clarification.
        """,
        tools=[get_listing_info, get_market_trends, get_neighborhood_info],
    )

    return agent

# Create the agent server
agent = create_real_estate_agent()
server = AgentServer(agent)

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(server.app, host="0.0.0.0", port=8000)