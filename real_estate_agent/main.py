import asyncio
import os
from typing import Annotated
from dotenv import load_dotenv
from agent_framework import Agent
from agent_framework.foundry import FoundryChatClient
from azure.identity import DefaultAzureCredential

# Load environment variables
load_dotenv()

# Define tools for real estate tasks
def get_listing_info(
    location: Annotated[str, "The city or neighborhood to search for listings."],
    property_type: Annotated[str, "Type of property: house, apartment, condo, etc."] = "house"
) -> str:
    """Get information about property listings in a specific location."""
    # In a real implementation, this would call your app's API
    # For now, return mock data
    return f"Found 5 {property_type} listings in {location}. Average price: $500,000. Contact your local agent for details."

def get_market_trends(
    location: Annotated[str, "The city or area to analyze market trends."],
    timeframe: Annotated[str, "Time period: last_month, last_quarter, last_year"] = "last_quarter"
) -> str:
    """Get market trends and analysis for a specific location."""
    # Mock market data
    trends = {
        "last_month": "Market is stable with slight price increase of 2%.",
        "last_quarter": "Prices up 5%, inventory down 10%. Seller's market.",
        "last_year": "Annual growth of 8%, strong demand in {location}."
    }
    return f"Market trends for {location} ({timeframe}): {trends.get(timeframe, 'Data not available.')}"

def get_neighborhood_info(
    neighborhood: Annotated[str, "The neighborhood name to get information about."]
) -> str:
    """Get information about a specific neighborhood."""
    # Mock neighborhood data
    info = {
        "downtown": "Urban area with high walkability, diverse amenities, average commute 15 min.",
        "suburbs": "Family-friendly with good schools, parks, average commute 25 min.",
        "waterfront": "Premium location with scenic views, luxury properties, average commute 20 min."
    }
    return f"Neighborhood info for {neighborhood}: {info.get(neighborhood.lower(), 'Information not available. Please provide more details.')}"

async def main():
    # Initialize Foundry client
    client = FoundryChatClient(
        project_endpoint=os.getenv("FOUNDRY_PROJECT_ENDPOINT"),
        model=os.getenv("FOUNDRY_MODEL_DEPLOYMENT_NAME"),
        credential=DefaultAzureCredential(),
    )

    # Create the real estate agent
    async with Agent(
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
    ) as agent:
        print("Real Estate Agent is ready! Type your questions below.")
        print("Type 'quit' to exit.")

        # Create a session for multi-turn conversation
        session = agent.create_session()

        while True:
            user_input = input("\nYou: ")
            if user_input.lower() in ['quit', 'exit']:
                break

            print("Agent: ", end="", flush=True)
            stream = agent.run(user_input, session=session, stream=True)
            async for chunk in stream:
                if chunk.text:
                    print(chunk.text, end="", flush=True)
            print()
            await stream.get_final_response()  # Finalize to persist history

if __name__ == "__main__":
    asyncio.run(main())