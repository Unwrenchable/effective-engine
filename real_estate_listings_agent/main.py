import os
import requests
from typing import Annotated
from dotenv import load_dotenv
from agent_framework import Agent
from agent_framework.foundry import FoundryChatClient
from azure.identity import DefaultAzureCredential
from azure.ai.agentserver.agentframework import from_agent_framework

# Load environment variables
load_dotenv(override=False)

# Define tools for real estate listings
def search_listings(
    location: Annotated[str, "The city or neighborhood to search for listings."] = "",
    property_type: Annotated[str, "Type of property: house, apartment, condo, etc."] = "",
    min_price: Annotated[int, "Minimum price"] = 0,
    max_price: Annotated[int, "Maximum price"] = 0,
    bedrooms: Annotated[int, "Number of bedrooms"] = 0
) -> str:
    """Search for property listings based on criteria."""
    try:
        base_url = os.getenv("APP_API_BASE", "http://localhost:3000")
        params = {}
        if location:
            params["location"] = location
        if property_type:
            params["type"] = property_type
        if min_price > 0:
            params["minPrice"] = min_price
        if max_price > 0:
            params["maxPrice"] = max_price
        if bedrooms > 0:
            params["bedrooms"] = bedrooms

        response = requests.get(f"{base_url}/listings", params=params, timeout=10)
        if response.status_code == 200:
            listings = response.json()
            if listings:
                return f"Found {len(listings)} listings matching your criteria. Here are the top results: " + "\n".join([f"- {listing.get('address', 'Unknown')} (${listing.get('price', 'N/A')})" for listing in listings[:5]])
            else:
                return "No listings found matching your criteria. Try adjusting your search parameters."
        else:
            return f"Unable to search listings at this time. API returned status {response.status_code}."
    except Exception as e:
        return f"Error searching listings: {str(e)}. Please try again later."

def get_listing_details(
    listing_id: Annotated[str, "The ID of the listing to get details for."]
) -> str:
    """Get detailed information about a specific listing."""
    try:
        base_url = os.getenv("APP_API_BASE", "http://localhost:3000")
        response = requests.get(f"{base_url}/listings/{listing_id}", timeout=10)
        if response.status_code == 200:
            listing = response.json()
            return f"Listing Details:\nAddress: {listing.get('address', 'N/A')}\nPrice: ${listing.get('price', 'N/A')}\nBedrooms: {listing.get('bedrooms', 'N/A')}\nBathrooms: {listing.get('bathrooms', 'N/A')}\nDescription: {listing.get('description', 'N/A')}"
        else:
            return f"Unable to get listing details. API returned status {response.status_code}."
    except Exception as e:
        return f"Error getting listing details: {str(e)}. Please try again later."

def get_market_data(
    location: Annotated[str, "The city or area to get market data for."]
) -> str:
    """Get market trends and data for a specific location."""
    try:
        base_url = os.getenv("APP_API_BASE", "http://localhost:3000")
        response = requests.get(f"{base_url}/market", params={"location": location}, timeout=10)
        if response.status_code == 200:
            market = response.json()
            return f"Market Data for {location}:\nAverage Price: ${market.get('avgPrice', 'N/A')}\nMedian Price: ${market.get('medianPrice', 'N/A')}\nDays on Market: {market.get('daysOnMarket', 'N/A')}\nInventory: {market.get('inventory', 'N/A')} listings"
        else:
            return f"Unable to get market data. API returned status {response.status_code}."
    except Exception as e:
        return f"Error getting market data: {str(e)}. Please try again later."

async def main():
    # Initialize Foundry client
    client = FoundryChatClient(
        project_endpoint=os.getenv("FOUNDRY_PROJECT_ENDPOINT"),
        model=os.getenv("FOUNDRY_MODEL_DEPLOYMENT_NAME"),
        credential=DefaultAzureCredential(),
    )

    # Create the real estate listings agent
    agent = Agent(
        client,
        name="RealEstateListingsAgent",
        instructions="""
        You are a helpful real estate agent assistant specializing in property listings. Help users with:
        - Searching for available listings based on location, price, property type, etc.
        - Getting detailed information about specific properties
        - Understanding market trends and data
        - Answering questions about real estate processes
        - Providing guidance on buying, selling, or renting properties

        Always be professional, accurate, and helpful. Use the available tools to provide specific, up-to-date information from the listings database.
        If you don't have specific data, suggest next steps or ask for clarification.
        When showing listings, include key details like address, price, and basic features.
        """,
        tools=[search_listings, get_listing_details, get_market_data],
    )

    # Run the agent as an HTTP server
    await from_agent_framework(agent).run_async()

if __name__ == "__main__":
    import asyncio
    asyncio.run(main())